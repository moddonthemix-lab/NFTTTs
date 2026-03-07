const openSeaApi = require('./openSeaApi');
const { scoreOpportunity, estimateFlip, weiToEth, dealGrade, liquidityScore } = require('../analyzer/scorer');
const config = require('../config');
const logger = require('../utils/logger');
const db = require('../utils/database');
const walletUtils = require('../utils/wallet');

let _emitter = null;

function setEmitter(emitter) {
  _emitter = emitter;
}

function emit(event, data) {
  if (_emitter) _emitter.emit(event, data);
}

/**
 * Run a full scan cycle:
 * 1. Fetch trending collections
 * 2. Filter by volume/price criteria
 * 3. Pull cheapest listings from each
 * 4. Score and rank opportunities
 */
async function scanForOpportunities() {
  logger.info('Starting NFT opportunity scan...');
  emit('scan:started', { timestamp: new Date().toISOString() });

  // Warn if the API key looks missing, but still attempt the scan
  if (!config.opensea.apiKey) {
    logger.warn('OPENSEA_API_KEY is not set — scan will likely fail. Add it in Railway → Variables and redeploy.');
  }

  const opportunities = [];

  try {
    // Step 1: Fetch trending from both Ethereum and Base in parallel.
    // ETH: top 40, Base: top 20 (Base has fewer active collections).
    const [ethCollections, baseCollections] = await Promise.allSettled([
      openSeaApi.getTrendingCollections(40, 'ethereum'),
      openSeaApi.getTrendingCollections(20, 'base'),
    ]);

    const ethList = ethCollections.status === 'fulfilled' ? ethCollections.value : [];
    const baseList = baseCollections.status === 'fulfilled' ? baseCollections.value : [];

    logger.info(`Fetched ${ethList.length} ETH + ${baseList.length} Base trending collections`);
    const allCollections = [...ethList, ...baseList];
    emit('scan:collections', { count: allCollections.length, collections: allCollections.slice(0, 20) });

    // Step 2: Build the full list of slugs to scan.
    // - Top 40 ETH + top 20 Base trending collections
    // - All watchlisted collections (always included, bypass volume filter)
    const watchlist = db.getWatchlist(walletUtils.getWalletAddress());
    const watchlistSlugs = new Set(watchlist.map((w) => w.slug));

    const trendingSlugs = [
      ...ethList.map((c) => ({ slug: c.collection || c.slug, col: c, isWatchlisted: false, chain: 'ethereum' })),
      ...baseList.map((c) => ({ slug: c.collection || c.slug, col: c, isWatchlisted: false, chain: 'base' })),
    ].filter((e) => e.slug);

    // Add watchlist entries not already in trending
    const scannedSlugs = new Set(trendingSlugs.map((e) => e.slug));
    for (const w of watchlist) {
      if (!scannedSlugs.has(w.slug)) {
        trendingSlugs.push({ slug: w.slug, col: { name: w.name, image_url: w.imageUrl }, isWatchlisted: true, chain: w.chain || 'ethereum' });
      }
    }
    // Mark trending entries that are also watchlisted
    for (const entry of trendingSlugs) {
      if (watchlistSlugs.has(entry.slug)) entry.isWatchlisted = true;
    }

    if (watchlist.length > 0) {
      logger.info(`Watchlist: ${watchlist.map((w) => w.slug).join(', ')}`);
    }

    for (const { slug, col, isWatchlisted, chain } of trendingSlugs) {
      try {
        const [stats, listings, fees] = await Promise.all([
          openSeaApi.getCollectionStats(slug),
          openSeaApi.getCheapestListings(slug, 10),
          openSeaApi.getCollectionFees(slug),
        ]);

        if (!stats || !listings.length) continue;

        const floorPrice = stats.total?.floor_price || 0;
        const oneDayInterval = stats.intervals?.find((i) => i.interval === 'one_day') || {};
        const sevenDayInterval = stats.intervals?.find((i) => i.interval === 'seven_day') || {};
        const oneHourInterval = stats.intervals?.find((i) => i.interval === 'one_hour') || {};
        const oneDayVolume = oneDayInterval.volume || 0;
        const totalSupply = stats.total?.count || col?.total_supply || null;
        const numOwners   = stats.total?.num_owners || null;
        // Realistic exit = avg sale price (what buyers pay), not floor (cheapest ask)
        const avgSalePrice =
          oneDayInterval.average_price ||
          sevenDayInterval.average_price ||
          floorPrice;
        const liquidity = liquidityScore(stats);
        const oneHourChange = oneHourInterval.volume_change || 0;

        // Filter: skip dead collections with no activity.
        // Volume OR sales count must clear the bar — cheap collections have tiny ETH volume
        // but can have lots of sales (e.g. 100 sales × $0.50 = $50 ≈ 0.02 ETH volume).
        const oneDaySalesCount = oneDayInterval.sales || 0;
        const hasActivity = oneDayVolume >= config.scanner.minCollectionVolume || oneDaySalesCount >= 5;
        if (!isWatchlisted && !hasActivity) { logger.info(`${slug}: skipped (vol ${oneDayVolume.toFixed(4)} ETH, ${oneDaySalesCount} sales — no activity)`); continue; }
        if (floorPrice > 0 && floorPrice < config.scanner.minFloorPrice) { logger.info(`${slug}: skipped (floor ${floorPrice} < ${config.scanner.minFloorPrice})`); continue; }
        if (floorPrice > config.scanner.maxFloorPrice) { logger.info(`${slug}: skipped (floor ${floorPrice} > ${config.scanner.maxFloorPrice})`); continue; }
        logger.info(`${slug} [${chain}]${isWatchlisted ? ' [watchlist]' : ''}: floor=${floorPrice} ETH, vol=${oneDayVolume.toFixed(2)} ETH — scanning ${listings.length} listings`);

        // Deduplicate by tokenId — keep only the cheapest listing per token
        const seenTokens = new Map();
        for (const listing of listings) {
          const listingPriceEth = weiToEth(
            listing.price?.current?.value,
            listing.price?.current?.decimals
          );

          if (listingPriceEth <= 0 || listingPriceEth > config.trading.maxBuyPriceEth) {
            if (listingPriceEth > 0) logger.info(`${slug}: listing ${listingPriceEth.toFixed(4)} ETH rejected (maxBuyPrice=${config.trading.maxBuyPriceEth} ETH)`);
            continue;
          }

          const score = scoreOpportunity(listing, stats);
          const marketplaceFee = fees?.marketplaceFee ?? 2.5;
          const royaltyFee = fees?.royaltyFee ?? 5.0;
          const flipEstimate = estimateFlip(listingPriceEth, avgSalePrice, marketplaceFee, royaltyFee);

          if (score < (chain === 'base' ? 1 : 10)) continue;

          const tokenId = listing.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria
            || listing.order_hash?.slice(0, 8);

          const contractAddress =
            listing.protocol_data?.parameters?.offer?.[0]?.token
            || col.contracts?.[0]?.address
            || '';

          const opp = {
            id: listing.order_hash || `${slug}_${tokenId}`,
            collectionSlug: slug,
            collectionName: col.name || slug,
            collectionImage: col.image_url || '',
            contractAddress,
            tokenId,
            chain: chain || 'ethereum',
            listingPriceEth,
            floorPriceEth: floorPrice,
            avgSalePriceEth: avgSalePrice,
            score,
            dealGrade: dealGrade(score),
            liquidity,
            flipEstimate,
            oneDayVolume,
            oneDaySales: oneDayInterval.sales || 0,
            oneDayChange: oneDayInterval.volume_change || null,
            oneHourChange: oneHourInterval.volume_change || null,
            totalSupply,
            numOwners,
            isWatchlisted,
            listing,
            scannedAt: new Date().toISOString(),
          };

          const existing = seenTokens.get(tokenId);
          if (!existing || listingPriceEth < existing.listingPriceEth) {
            seenTokens.set(tokenId, opp);
          }
        }

        for (const opp of seenTokens.values()) {
          opportunities.push(opp);
        }
      } catch (err) {
        logger.warn(`Error scanning collection ${slug}: ${err.message}`);
      }
    }

    // Step 3: Sort by score desc
    opportunities.sort((a, b) => b.score - a.score);

    logger.info(`Scan complete. Found ${opportunities.length} opportunities.`);
    emit('scan:opportunities', { count: opportunities.length, opportunities });

    return opportunities;
  } catch (err) {
    logger.error(`Scan failed: ${err.message}`);
    emit('scan:error', { message: err.message });
    return [];
  }
}

/**
 * Detailed scan of a single collection — includes best offer, rarity for top 5
 */
async function scanCollection(slug, chain = 'ethereum') {
  try {
    const [collection, stats, listings, bestOfferEth, fees] = await Promise.all([
      openSeaApi.getCollection(slug),
      openSeaApi.getCollectionStats(slug),
      openSeaApi.getCheapestListings(slug, 30),
      openSeaApi.getCollectionBestOffer(slug).catch(() => null),
      openSeaApi.getCollectionFees(slug),
    ]);

    if (!stats) return null;

    const floorPrice = stats.total?.floor_price || 0;
    const oneDayInt = stats.intervals?.find((i) => i.interval === 'one_day') || {};
    const sevenDayInt = stats.intervals?.find((i) => i.interval === 'seven_day') || {};
    const avgSalePrice = oneDayInt.average_price || sevenDayInt.average_price || floorPrice;
    const liquidity = liquidityScore(stats);

    const rawMapped = listings
      .map((listing) => {
        const priceEth = weiToEth(listing.price?.current?.value, listing.price?.current?.decimals);
        const score = scoreOpportunity(listing, stats);
        const mFee = fees?.marketplaceFee ?? 2.5;
        const rFee = fees?.royaltyFee ?? 5.0;
        const flipEstimate = estimateFlip(priceEth, avgSalePrice, mFee, rFee);
        const contractAddress = listing.protocol_data?.parameters?.offer?.[0]?.token || '';
        const tokenId = listing.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria || '';
        return { listing, priceEth, score, dealGrade: dealGrade(score), flipEstimate, contractAddress, tokenId };
      })
      .filter((r) => r.priceEth > 0);

    // Deduplicate by tokenId — keep cheapest listing per token
    const tokenMap = new Map();
    for (const r of rawMapped) {
      const key = r.tokenId || r.listing.order_hash;
      const existing = tokenMap.get(key);
      if (!existing || r.priceEth < existing.priceEth) tokenMap.set(key, r);
    }
    const mapped = Array.from(tokenMap.values()).sort((a, b) => b.score - a.score);

    // Fetch actual NFT image + rarity for top 20 (one API call each — images load progressively)
    const toEnrich = mapped.slice(0, 20);
    const rest = mapped.slice(20);
    const enriched = await Promise.all(
      toEnrich.map(async (r) => {
        if (!r.contractAddress || !r.tokenId) return r;
        const nft = await openSeaApi.getNFT(r.contractAddress, r.tokenId, chain).catch(() => null);
        if (!nft) return r;
        const rarity = nft.rarity;
        const isRare = rarity?.rank && rarity?.max_rank
          ? rarity.rank <= Math.max(1, Math.round(rarity.max_rank * 0.10))
          : false;
        return {
          ...r,
          nftImageUrl: nft.display_image_url || nft.image_url || null,
          rarityRank: rarity?.rank || null,
          rarityTotal: rarity?.max_rank || null,
          isRare,
        };
      })
    );

    return { collection, stats, bestOfferEth, liquidity, results: [...enriched, ...rest] };
  } catch (err) {
    logger.error(`scanCollection(${slug}) failed: ${err.message}`);
    return null;
  }
}

module.exports = { scanForOpportunities, scanCollection, setEmitter };
