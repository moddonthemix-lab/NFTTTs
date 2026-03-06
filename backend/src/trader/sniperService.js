/**
 * Sniper Service — persistent background NFT price sniper.
 *
 * Survives server restarts: active snipers are stored in the DB and
 * re-armed automatically on process start.
 *
 * Architecture:
 *  - Each armed sniper gets its own repeating polling timer.
 *  - On every tick: fetch cheapest listings for the collection via OpenSea.
 *  - If any listing falls within the price range, buy it with gas override.
 *  - Fills are recorded; when quantity is reached the sniper is marked 'filled'.
 *  - A sniper can be cancelled at any time, which clears its timer.
 */

const { ethers } = require('ethers');
const openSeaApi  = require('../scanner/openSeaApi');
const { buyNFT }  = require('./seaportTrader');
const db          = require('../utils/database');
const logger      = require('../utils/logger');
const { weiToEth } = require('../analyzer/scorer');

// ─── Gas speed configs ────────────────────────────────────────────────────────
// priorityGwei = miner tip (maxPriorityFeePerGas)
// Larger tip = higher chance of next-block inclusion
const GAS_SPEEDS = {
  slow:   { label: 'Slow',   desc: 'Low gas — may lag in congestion',         pollMs: 30000, priorityGwei: 0.5  },
  normal: { label: 'Normal', desc: 'Standard — usually confirms within 1 min', pollMs: 10000, priorityGwei: 1.5  },
  fast:   { label: 'Fast',   desc: 'Higher tip — fast next-few-block confirm', pollMs: 5000,  priorityGwei: 4.0  },
  turbo:  { label: 'Turbo',  desc: 'Max tip — targets next block',             pollMs: 2000,  priorityGwei: 15.0 },
};

function gasOverrideFor(speed) {
  const cfg = GAS_SPEEDS[speed] || GAS_SPEEDS.normal;
  return {
    maxPriorityFeePerGas: ethers.parseUnits(cfg.priorityGwei.toString(), 'gwei'),
  };
}

// ─── State ────────────────────────────────────────────────────────────────────
let _emitter = null;          // socket.io instance
const _timers = new Map();    // sniperId → timeout handle
const _buying = new Set();    // sniperId → currently executing a buy (lock)

function setEmitter(io) { _emitter = io; }
function emit(event, data) { if (_emitter) _emitter.emit(event, data); }

// ─── Core polling tick ────────────────────────────────────────────────────────
async function _tick(sniper) {
  // Re-read from DB — might have been cancelled or filled since last tick
  const live = db.getSnipers().find((s) => s.id === sniper.id);
  if (!live || live.status !== 'active') return;
  if (_buying.has(sniper.id)) { _schedule(sniper); return; }  // buy in flight — skip

  try {
    live.lastCheckedAt = new Date().toISOString();
    db.updateSniper(sniper.id, { lastCheckedAt: live.lastCheckedAt });

    const listings = await openSeaApi.getCheapestListings(sniper.collectionSlug, 10);
    for (const listing of listings) {
      const priceEth = weiToEth(listing.price?.current?.value, listing.price?.current?.decimals);
      if (!priceEth) continue;

      if (priceEth >= live.minPriceEth && priceEth <= live.maxPriceEth) {
        logger.info(`[sniper] ${live.id} HIT: ${live.collectionSlug} @ ${priceEth} ETH (range ${live.minPriceEth}–${live.maxPriceEth})`);
        _buying.add(live.id);
        try {
          const result = await buyNFT(listing, gasOverrideFor(live.gasSpeed));
          const fill = { txHash: result.txHash, priceEth };
          const updated = db.addSniperFill(live.id, fill);
          emit('sniper:fill', { id: live.id, ...fill, status: updated?.status });
          logger.info(`[sniper] ${live.id} filled @ ${priceEth} ETH — tx ${result.txHash}`);

          if (updated?.status === 'filled') {
            // All quantity bought — disarm
            _clearTimer(live.id);
            emit('sniper:done', { id: live.id, collectionSlug: live.collectionSlug });
            logger.info(`[sniper] ${live.id} fully done (${updated.quantityFilled}/${live.quantity})`);
            _buying.delete(live.id);
            return;
          }
        } catch (buyErr) {
          logger.error(`[sniper] ${live.id} buy failed: ${buyErr.message}`);
          emit('sniper:error', { id: live.id, error: buyErr.message });
          // Don't cancel — keep polling; the listing may reappear or price may drop again
        }
        _buying.delete(live.id);
        break; // Only attempt one buy per tick
      }
    }
  } catch (err) {
    logger.warn(`[sniper] ${live.id} poll error: ${err.message}`);
    _buying.delete(live.id);
  }

  _schedule(sniper);
}

// ─── Timer helpers ────────────────────────────────────────────────────────────
function _clearTimer(id) {
  const t = _timers.get(id);
  if (t) { clearTimeout(t); _timers.delete(id); }
}

function _schedule(sniper) {
  _clearTimer(sniper.id);
  const pollMs = (GAS_SPEEDS[sniper.gasSpeed] || GAS_SPEEDS.normal).pollMs;
  _timers.set(sniper.id, setTimeout(() => _tick(sniper), pollMs));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Arm a sniper — starts polling immediately then on its interval. */
function arm(sniper) {
  _clearTimer(sniper.id);
  logger.info(`[sniper] Arming ${sniper.id}: ${sniper.collectionSlug} ${sniper.minPriceEth}–${sniper.maxPriceEth} ETH ×${sniper.quantity} (${sniper.gasSpeed})`);
  // First tick fires immediately (0ms) so user sees fast initial response
  _timers.set(sniper.id, setTimeout(() => _tick(sniper), 0));
}

/** Cancel a sniper — stops polling, updates DB. */
function cancel(id) {
  _clearTimer(id);
  _buying.delete(id);
  db.updateSniper(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
  emit('sniper:cancelled', { id });
  logger.info(`[sniper] Cancelled ${id}`);
}

/** Called once on server start — re-arms any snipers that were active before restart. */
function start() {
  const active = db.getSnipers().filter((s) => s.status === 'active');
  logger.info(`[sniper] Service starting — resuming ${active.length} active sniper(s)`);
  active.forEach((s) => arm(s));
}

module.exports = { start, setEmitter, arm, cancel, GAS_SPEEDS };
