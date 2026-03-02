const openSeaApi = require('./openSeaApi');
const { scoreOpportunity, estimateFlip, weiToEth } = require('../analyzer/scorer');
const config = require('../config');
const logger = require('../utils/logger');

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
    // Step 1: Get trending collections
    const collections = await openSeaApi.getTrendingCollections(60);
    logger.info(`Fetched ${collections.length} trending collections`);
    emit('scan:collections', { count: collections.length, collections: collections.slice(0, 20) });

    // Step 2: For each collection fetch real stats THEN filter.
    // The trending-collections endpoint does NOT embed stats, so we must
    // call getCollectionStats first before applying volume/floor filters.
    for (const col of collections.slice(0, 20)) {
      try {
        const slug = col.collection || col.slug;
        if (!slug) continue;

        const [stats, listings] = await Promise.all([
          openSeaApi.getCollectionStats(slug),
          openSeaApi.getCheapestListings(slug, 10),
        ]);

        if (!stats || !listings.length) continue;

        const floorPrice = stats.total?.floor_price || 0;
        const oneDayVolume = stats.total?.one_day_volume || 0;

        // Apply collection-level filters now that we have real stats
        if (oneDayVolume < config.scanner.minCollectionVolume) { logger.info(`${slug}: skipped (vol ${oneDayVolume.toFixed(2)} < ${config.scanner.minCollectionVolume})`); continue; }
        if (floorPrice < config.scanner.minFloorPrice) { logger.info(`${slug}: skipped (floor ${floorPrice} < ${config.scanner.minFloorPrice})`); continue; }
        if (floorPrice > config.scanner.maxFloorPrice) { logger.info(`${slug}: skipped (floor ${floorPrice} > ${config.scanner.maxFloorPrice})`); continue; }
        logger.info(`${slug}: floor=${floorPrice} ETH, vol=${oneDayVolume.toFixed(2)} ETH — scanning ${listings.length} listings`);

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
          const flipEstimate = estimateFlip(listingPriceEth, floorPrice);

          // Only hard-filter truly junk scores; profitability is shown in the UI
          // as a label so the user can decide — not used as a gate here.
          if (score < 10) continue;

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
            listingPriceEth,
            floorPriceEth: floorPrice,
            score,
            flipEstimate,
            oneDayVolume,
            oneDaySales: stats.total?.one_day_sales || 0,
            oneDayChange: stats.total?.one_day_change || 0,
            listing,
            scannedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.warn(`Error scanning collection ${col.collection || col.slug}: ${err.message}`);
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
    const results = listings
      .map((listing) => {
        const priceEth = weiToEth(
          listing.price?.current?.value,
          listing.price?.current?.decimals
        );
        const score = scoreOpportunity(listing, stats);
        const flipEstimate = estimateFlip(priceEth, floorPrice);
        return { listing, priceEth, score, flipEstimate };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return { collection, stats, results };
  } catch (err) {
    logger.error(`scanCollection(${slug}) failed: ${err.message}`);
    return null;
  }
}

module.exports = { scanForOpportunities, scanCollection, setEmitter };
