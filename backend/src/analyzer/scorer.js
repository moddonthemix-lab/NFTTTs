const config = require('../config');

/**
 * Score an NFT opportunity on a scale of 0–100.
 * Higher = better flip opportunity.
 *
 * Key fix: discount is measured vs average SALE price, not floor.
 * Floor is the cheapest ask — a listing AT floor has zero discount vs floor.
 * Average sale price is what buyers are actually paying (always above floor),
 * so a listing at floor is genuinely discounted vs that benchmark.
 */
function scoreOpportunity(listing, collectionStats) {
  if (!listing || !collectionStats) return 0;

  const floorPrice = collectionStats.total?.floor_price || 0;
  const listingPriceEth = weiToEth(listing.price?.current?.value, listing.price?.current?.decimals);
  const oneDayInterval = collectionStats.intervals?.find((i) => i.interval === 'one_day') || {};
  const sevenDayInterval = collectionStats.intervals?.find((i) => i.interval === 'seven_day') || {};
  const oneDayVolume = oneDayInterval.volume || 0;
  const oneDaySales = oneDayInterval.sales || 0;
  const oneDayChange = oneDayInterval.volume_change || 0;
  const numOwners = collectionStats.total?.num_owners || 0;
  const totalSupply = collectionStats.total?.total_supply || 1;

  if (listingPriceEth === 0 || floorPrice === 0) return 0;

  // Reference = what buyers are actually paying.
  // Prefer 1-day avg, fall back to 7-day avg, last resort floor.
  const avgSalePrice =
    oneDayInterval.average_price ||
    sevenDayInterval.average_price ||
    floorPrice;

  let score = 0;

  // 1. Discount vs avg sale price (max 40 pts)
  // e.g. listing at floor (0.5 ETH) while avg sale is 0.65 ETH → 23% below avg → ~46 pts (capped 40)
  const discount = (avgSalePrice - listingPriceEth) / avgSalePrice;
  if (discount > 0) {
    score += Math.min(40, discount * 200); // 20% below avg sale = 40 pts
  }

  // 2. 24h volume strength (max 20 pts)
  if (oneDayVolume > 0) {
    score += Math.min(20, Math.log10(oneDayVolume + 1) * 8);
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
 * Estimate flip profitability.
 *
 * targetSellEth = the realistic exit price.
 * - For buy decisions: pass avg sale price (what buyers are paying).
 * - For sell decisions on held NFTs: pass your intended list price (floor × 0.98).
 * Never pass raw floor price — selling at floor nets a ~7.5% loss after fees.
 */
function estimateFlip(buyPriceEth, targetSellEth, marketplaceFeePct = 2.5, royaltyPct = 5) {
  const totalFeePct = (marketplaceFeePct + royaltyPct) / 100;
  const sellPriceNet = targetSellEth * (1 - totalFeePct);
  const profitEth = sellPriceNet - buyPriceEth;
  const profitPct = (profitEth / buyPriceEth) * 100;
  return {
    buyPriceEth,
    targetSellEth,
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
