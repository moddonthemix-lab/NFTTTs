const openSeaApi = require('./openSeaApi');
const { scoreOpportunity, estimateFlip, weiToEth } = require('../analyzer/scorer');
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
        const [stats, listings] = await Promise.all([
          openSeaApi.getCollectionStats(slug),
          openSeaApi.getCheapestListings(slug, 10),
        ]);

        if (!stats || !listings.length) continue;

        const floorPrice = stats.total?.floor_price || 0;
        const oneDayInterval = stats.intervals?.find((i) => i.interval === 'one_day') || {};
        const sevenDayInterval = stats.intervals?.find((i) => i.interval === 'seven_day') || {};
        const oneDayVolume = oneDayInterval.volume || 0;
        // Realistic exit = avg sale price (what buyers pay), not floor (cheapest ask)
        const avgSalePrice =
          oneDayInterval.average_price ||
          sevenDayInterval.average_price ||
          floorPrice;

        // Base and watchlisted collections bypass ETH-mainnet-tuned filters.
        // Base is a younger chain: lower volumes and much lower floor prices.
        if (!isWatchlisted && chain !== 'base' && oneDayVolume < config.scanner.minCollectionVolume) { logger.info(`${slug}: skipped (vol ${oneDayVolume.toFixed(2)} < ${config.scanner.minCollectionVolume})`); continue; }
        if (chain !== 'base' && floorPrice < config.scanner.minFloorPrice) { logger.info(`${slug}: skipped (floor ${floorPrice} < ${config.scanner.minFloorPrice})`); continue; }
        if (chain !== 'base' && floorPrice > config.scanner.maxFloorPrice) { logger.info(`${slug}: skipped (floor ${floorPrice} > ${config.scanner.maxFloorPrice})`); continue; }
        logger.info(`${slug} [${chain}]${isWatchlisted ? ' [watchlist]' : ''}: floor=${floorPrice} ETH, vol=${oneDayVolume.toFixed(2)} ETH — scanning ${listings.length} listings`);

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
          const flipEstimate = estimateFlip(listingPriceEth, avgSalePrice);

          // Base scores naturally lower (less volume/sales data) — use a lower threshold
          if (score < (chain === 'base' ? 1 : 10)) continue;

          const tokenId = listing.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria
            || listing.order_hash?.slice(0, 8);

          const contractAddress =
            listing.protocol_data?.parameters?.offer?.[0]?.token
            || col.contracts?.[0]?.address
            || '';

          opportunities.push({
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
            flipEstimate,
            oneDayVolume,
            oneDaySales: oneDayInterval.sales || 0,
            oneDayChange: oneDayInterval.volume_change || 0,
            isWatchlisted,
            listing,
            scannedAt: new Date().toISOString(),
          });
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
 * Detailed scan of a single collection
 */
async function scanCollection(slug) {
  try {
    const [collection, stats, listings] = await Promise.all([
      openSeaApi.getCollection(slug),
      openSeaApi.getCollectionStats(slug),
      openSeaApi.getCheapestListings(slug, 30),
    ]);

    if (!stats) return null;

    const floorPrice = stats.total?.floor_price || 0;
    const oneDayInt = stats.intervals?.find((i) => i.interval === 'one_day') || {};
    const sevenDayInt = stats.intervals?.find((i) => i.interval === 'seven_day') || {};
    const avgSalePrice = oneDayInt.average_price || sevenDayInt.average_price || floorPrice;
    const results = listings
      .map((listing) => {
        const priceEth = weiToEth(
          listing.price?.current?.value,
          listing.price?.current?.decimals
        );
        const score = scoreOpportunity(listing, stats);
        const flipEstimate = estimateFlip(priceEth, avgSalePrice);
        return { listing, priceEth, score, flipEstimate };
      })
      .filter((r) => r.priceEth > 0)  // only remove unparseable listings, show all scores
      .sort((a, b) => b.score - a.score);

    return { collection, stats, results };
  } catch (err) {
    logger.error(`scanCollection(${slug}) failed: ${err.message}`);
    return null;
  }
}

module.exports = { scanForOpportunities, scanCollection, setEmitter };
