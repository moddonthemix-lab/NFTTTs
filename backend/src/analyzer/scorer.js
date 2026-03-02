const config = require('../config');

/**
 * Score an NFT opportunity on a scale of 0–100.
 * Higher = better flip opportunity.
 */
function scoreOpportunity(listing, collectionStats) {
  if (!listing || !collectionStats) return 0;

  const floorPrice = collectionStats.total?.floor_price || 0;
  const listingPriceEth = weiToEth(listing.price?.current?.value, listing.price?.current?.decimals);
  const oneDayVolume = collectionStats.total?.one_day_volume || 0;
  const oneDaySales = collectionStats.total?.one_day_sales || 0;
  const oneDayChange = collectionStats.total?.one_day_change || 0;
  const numOwners = collectionStats.total?.num_owners || 0;
  const totalSupply = collectionStats.total?.total_supply || 1;

  if (listingPriceEth === 0 || floorPrice === 0) return 0;

  let score = 0;

  // 1. Price discount vs floor (max 40 pts)
  const discount = (floorPrice - listingPriceEth) / floorPrice;
  if (discount > 0) {
    score += Math.min(40, discount * 200); // 20% discount = 40 pts
  }

  // 2. 24h volume strength (max 20 pts)
  if (oneDayVolume > 0) {
    const volScore = Math.min(20, Math.log10(oneDayVolume + 1) * 8);
    score += volScore;
  }

  // 3. Price momentum (24h change) (max 15 pts)
  if (oneDayChange > 0) {
    score += Math.min(15, oneDayChange * 50);
  }

  // 4. Sales velocity (max 15 pts)
  if (oneDaySales > 0) {
    score += Math.min(15, Math.log10(oneDaySales + 1) * 10);
  }

  // 5. Decentralization (owner ratio) (max 10 pts)
  const ownerRatio = numOwners / totalSupply;
  if (ownerRatio > 0.3) {
    score += Math.min(10, ownerRatio * 15);
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Calculate estimated profit for a potential flip
 */
function estimateFlip(buyPriceEth, floorPriceEth, marketplaceFeePct = 2.5, royaltyPct = 5) {
  const totalFeePct = (marketplaceFeePct + royaltyPct) / 100;
  const sellPriceNet = floorPriceEth * (1 - totalFeePct);
  const profitEth = sellPriceNet - buyPriceEth;
  const profitPct = (profitEth / buyPriceEth) * 100;
  return {
    buyPriceEth,
    targetSellEth: floorPriceEth,
    netSellEth: parseFloat(sellPriceNet.toFixed(6)),
    profitEth: parseFloat(profitEth.toFixed(6)),
    profitPct: parseFloat(profitPct.toFixed(2)),
    isProfitable: profitPct >= config.trading.minProfitMargin * 100,
  };
}

/**
 * Determine bid price for a collection
 */
function calcBidPrice(floorPriceEth) {
  return parseFloat((floorPriceEth * config.trading.bidFraction).toFixed(6));
}

/**
 * Convert wei string to ETH float
 */
function weiToEth(value, decimals = 18) {
  if (!value) return 0;
  try {
    const divisor = Math.pow(10, decimals || 18);
    return parseFloat((BigInt(value) * BigInt(1e6) / BigInt(divisor)).toString()) / 1e6;
  } catch {
    return 0;
  }
}

module.exports = { scoreOpportunity, estimateFlip, calcBidPrice, weiToEth };
