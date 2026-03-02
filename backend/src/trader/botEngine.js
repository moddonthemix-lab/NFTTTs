const cron = require('node-cron');
const { scanForOpportunities } = require('../scanner/collectionScanner');
const { buyNFT, placeBid, sellNFT } = require('./seaportTrader');
const { estimateFlip, calcBidPrice } = require('../analyzer/scorer');
const db = require('../utils/database');
const walletUtils = require('../utils/wallet');
const config = require('../config');
const logger = require('../utils/logger');

let _emitter = null;
let _running = false;
let _cronJob = null;

function setEmitter(emitter) {
  _emitter = emitter;
}

function emit(event, data) {
  if (_emitter) _emitter.emit(event, data);
}

/**
 * Start the trading bot cron loop
 */
function startBot() {
  if (_running) {
    logger.warn('Bot is already running');
    return false;
  }
  _running = true;
  const interval = `*/${config.scanner.intervalSeconds} * * * * *`;
  const safeInterval = config.scanner.intervalSeconds < 60
    ? `*/${config.scanner.intervalSeconds} * * * * *`
    : `*/${Math.floor(config.scanner.intervalSeconds / 60)} * * * *`;

  _cronJob = cron.schedule(safeInterval, () => runCycle(), { runOnInit: true });
  logger.info('Bot started');
  emit('bot:started', { autoTrade: config.autoTrade });
  return true;
}

function stopBot() {
  if (!_running) return false;
  _running = false;
  if (_cronJob) {
    _cronJob.stop();
    _cronJob = null;
  }
  logger.info('Bot stopped');
  emit('bot:stopped', {});
  return true;
}

function isBotRunning() {
  return _running;
}

/**
 * Main cycle: scan → evaluate → act
 */
async function runCycle() {
  logger.info('=== Bot cycle starting ===');
  emit('bot:cycle', { timestamp: new Date().toISOString() });

  try {
    // Check wallet
    if (!walletUtils.isConnected()) {
      logger.warn('No wallet connected — skipping trade cycle');
      emit('bot:warn', { message: 'No wallet connected. Import a wallet to enable trading.' });
      return;
    }

    const balanceEth = await walletUtils.getBalance();
    emit('bot:balance', { balanceEth });

    if (balanceEth < 0.01) {
      logger.warn(`Low balance: ${balanceEth} ETH`);
      emit('bot:warn', { message: `Wallet balance is very low: ${balanceEth} ETH` });
    }

    // Check portfolio size cap
    const portfolio = db.getPortfolio();
    const atCap = portfolio.length >= config.trading.maxPortfolioSize;

    // --- SELL: check if any held NFTs are ready to sell ---
    await evaluateSells(portfolio, balanceEth);

    // --- BID management: cancel stale bids ---
    await manageBids();

    if (atCap) {
      logger.info(`Portfolio at cap (${portfolio.length}/${config.trading.maxPortfolioSize}), skipping buys`);
      return;
    }

    if (balanceEth > config.trading.maxBudgetEth) {
      logger.warn(`Balance exceeds budget cap — trading paused`);
      return;
    }

    // --- SCAN for new opportunities ---
    const opportunities = await scanForOpportunities();

    for (const opp of opportunities.slice(0, 5)) {
      if (opp.score < 50) continue; // only top opportunities
      if (opp.listingPriceEth > balanceEth * 0.5) continue; // don't spend more than 50% balance on one NFT
      if (opp.listingPriceEth > config.trading.maxBuyPriceEth) continue;

      if (config.autoTrade) {
        // Auto mode: execute immediately
        await executeBuy(opp);
      } else {
        // Manual mode: queue for approval
        queueForApproval(opp);
      }

      // Also place a bid slightly below floor on interesting collections
      if (opp.score >= 70) {
        const bidPrice = calcBidPrice(opp.floorPriceEth);
        if (config.autoTrade) {
          await executeBid(opp.collectionSlug, bidPrice);
        } else {
          queueBidForApproval(opp.collectionSlug, bidPrice);
        }
      }
    }
  } catch (err) {
    logger.error(`Bot cycle error: ${err.message}`);
    emit('bot:error', { message: err.message });
  }

  logger.info('=== Bot cycle complete ===');
}

async function evaluateSells(portfolio, currentBalanceEth) {
  for (const nft of portfolio) {
    try {
      // Re-check current floor price
      const { getCollectionStats } = require('../scanner/openSeaApi');
      const stats = await getCollectionStats(nft.collectionSlug);
      if (!stats) continue;

      const currentFloor = stats.total?.floor_price || 0;
      const buyPrice = nft.buyPriceEth || 0;
      const flip = estimateFlip(buyPrice, currentFloor);

      if (flip.isProfitable && flip.profitPct >= config.trading.minProfitMargin * 100) {
        const sellPrice = parseFloat((currentFloor * 0.98).toFixed(6)); // undercut floor slightly for fast sell
        if (config.autoTrade) {
          await executeSell(nft, sellPrice, flip.profitEth);
        } else {
          queueSellForApproval(nft, sellPrice, flip);
        }
      }
    } catch (err) {
      logger.warn(`evaluateSells error for ${nft.tokenId}: ${err.message}`);
    }
  }
}

async function manageBids() {
  const bids = db.getBids();
  const now = Date.now();
  for (const bid of bids) {
    const ageHours = (now - new Date(bid.placedAt).getTime()) / 3600000;
    if (ageHours > 23) {
      // Refresh bid
      db.removeBid(bid.tokenId, bid.contractAddress);
      logger.info(`Removed stale bid on ${bid.collectionSlug}`);
    }
  }
}

// --- Execution helpers ---

async function executeBuy(opportunity) {
  try {
    logger.info(`Buying: ${opportunity.collectionName} #${opportunity.tokenId} @ ${opportunity.listingPriceEth} ETH`);
    const result = await buyNFT(opportunity.listing);
    db.addToPortfolio({
      ...opportunity,
      buyPriceEth: opportunity.listingPriceEth,
      buyTxHash: result.txHash,
    });
    db.addTrade({
      type: 'buy',
      collectionSlug: opportunity.collectionSlug,
      collectionName: opportunity.collectionName,
      tokenId: opportunity.tokenId,
      contractAddress: opportunity.contractAddress,
      priceEth: opportunity.listingPriceEth,
      txHash: result.txHash,
    });
    emit('trade:buy', { ...opportunity, txHash: result.txHash });
    logger.info(`Buy successful: ${result.txHash}`);
  } catch (err) {
    logger.error(`Buy failed for ${opportunity.tokenId}: ${err.message}`);
    emit('trade:error', { action: 'buy', opportunity, error: err.message });
  }
}

async function executeSell(nft, priceEth, profitEth) {
  try {
    logger.info(`Selling: ${nft.collectionName} #${nft.tokenId} @ ${priceEth} ETH`);
    const result = await sellNFT(nft.contractAddress, nft.tokenId, priceEth);
    db.removeFromPortfolio(nft.tokenId, nft.contractAddress);
    db.addTrade({
      type: 'sell',
      collectionSlug: nft.collectionSlug,
      collectionName: nft.collectionName,
      tokenId: nft.tokenId,
      contractAddress: nft.contractAddress,
      priceEth,
      profitEth,
      orderHash: result.orderHash,
    });
    emit('trade:sell', { ...nft, priceEth, profitEth });
    logger.info(`Sell listed: order ${result.orderHash}`);
  } catch (err) {
    logger.error(`Sell failed for ${nft.tokenId}: ${err.message}`);
    emit('trade:error', { action: 'sell', nft, error: err.message });
  }
}

async function executeBid(collectionSlug, bidPriceEth) {
  try {
    logger.info(`Placing bid on ${collectionSlug} @ ${bidPriceEth} ETH`);
    const result = await placeBid(collectionSlug, bidPriceEth);
    db.addBid({
      collectionSlug,
      offerAmountEth: bidPriceEth,
      orderHash: result.orderHash,
    });
    emit('trade:bid', result);
  } catch (err) {
    logger.error(`Bid failed for ${collectionSlug}: ${err.message}`);
    emit('trade:error', { action: 'bid', collectionSlug, error: err.message });
  }
}

function queueForApproval(opportunity) {
  const existing = db.getPendingApprovals().find(
    (a) => a.opportunityId === opportunity.id && a.status === 'pending'
  );
  if (existing) return;

  const id = db.addPendingApproval({
    action: 'buy',
    opportunityId: opportunity.id,
    collectionSlug: opportunity.collectionSlug,
    collectionName: opportunity.collectionName,
    tokenId: opportunity.tokenId,
    contractAddress: opportunity.contractAddress,
    priceEth: opportunity.listingPriceEth,
    floorPriceEth: opportunity.floorPriceEth,
    score: opportunity.score,
    flipEstimate: opportunity.flipEstimate,
    listing: opportunity.listing,
  });
  logger.info(`Queued buy for approval: ${opportunity.collectionName} #${opportunity.tokenId}`);
  emit('approval:queued', { id, action: 'buy', opportunity });
}

function queueBidForApproval(collectionSlug, bidPriceEth) {
  const id = db.addPendingApproval({
    action: 'bid',
    collectionSlug,
    bidPriceEth,
  });
  emit('approval:queued', { id, action: 'bid', collectionSlug, bidPriceEth });
}

function queueSellForApproval(nft, priceEth, flip) {
  const id = db.addPendingApproval({
    action: 'sell',
    tokenId: nft.tokenId,
    contractAddress: nft.contractAddress,
    collectionSlug: nft.collectionSlug,
    collectionName: nft.collectionName,
    priceEth,
    buyPriceEth: nft.buyPriceEth,
    flip,
  });
  emit('approval:queued', { id, action: 'sell', nft, priceEth, flip });
}

/**
 * Manually approve a pending action
 */
async function approveAction(approvalId) {
  const approval = db.updateApproval(approvalId, 'approved');
  if (!approval) throw new Error(`Approval ${approvalId} not found`);

  emit('approval:resolved', { id: approvalId, status: 'approved' });

  if (approval.action === 'buy') {
    const opp = {
      collectionSlug: approval.collectionSlug,
      collectionName: approval.collectionName,
      tokenId: approval.tokenId,
      contractAddress: approval.contractAddress,
      listingPriceEth: approval.priceEth,
      listing: approval.listing,
    };
    await executeBuy(opp);
  } else if (approval.action === 'sell') {
    const nft = {
      tokenId: approval.tokenId,
      contractAddress: approval.contractAddress,
      collectionSlug: approval.collectionSlug,
      collectionName: approval.collectionName,
      buyPriceEth: approval.buyPriceEth,
    };
    await executeSell(nft, approval.priceEth, approval.flip?.profitEth || 0);
  } else if (approval.action === 'bid') {
    await executeBid(approval.collectionSlug, approval.bidPriceEth);
  }

  return approval;
}

function rejectAction(approvalId) {
  const approval = db.updateApproval(approvalId, 'rejected');
  emit('approval:resolved', { id: approvalId, status: 'rejected' });
  return approval;
}

module.exports = {
  startBot,
  stopBot,
  isBotRunning,
  runCycle,
  approveAction,
  rejectAction,
  setEmitter,
};
