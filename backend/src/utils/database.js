const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/db.json');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const defaultDb = {
  portfolio: [],       // NFTs currently held
  trades: [],          // completed trades (buy/sell history)
  bids: [],            // active bids
  pendingApprovals: [], // trades waiting for manual approval
  watchlist: [],       // collections being watched
  stats: {
    totalBought: 0,
    totalSold: 0,
    totalProfit: 0,
    totalBids: 0,
    startedAt: new Date().toISOString(),
  },
};

function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      writeDb(defaultDb);
      return defaultDb;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    writeDb(defaultDb);
    return defaultDb;
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getPortfolio() { return readDb().portfolio; }
function getTrades() { return readDb().trades; }
function getBids() { return readDb().bids; }
function getPendingApprovals() { return readDb().pendingApprovals; }
function getStats() { return readDb().stats; }
function getWatchlist() { return readDb().watchlist; }

function addToPortfolio(nft) {
  const db = readDb();
  db.portfolio.push({ ...nft, acquiredAt: new Date().toISOString() });
  writeDb(db);
}

function removeFromPortfolio(tokenId, contractAddress) {
  const db = readDb();
  db.portfolio = db.portfolio.filter(
    (n) => !(n.tokenId === tokenId && n.contractAddress === contractAddress)
  );
  writeDb(db);
}

function addTrade(trade) {
  const db = readDb();
  db.trades.unshift({ ...trade, timestamp: new Date().toISOString() });
  // keep last 500 trades
  if (db.trades.length > 500) db.trades = db.trades.slice(0, 500);

  // update stats
  if (trade.type === 'buy') {
    db.stats.totalBought += trade.priceEth || 0;
  } else if (trade.type === 'sell') {
    db.stats.totalSold += trade.priceEth || 0;
    db.stats.totalProfit += trade.profitEth || 0;
  }
  writeDb(db);
}

function addBid(bid) {
  const db = readDb();
  // remove old bid for same nft if exists
  db.bids = db.bids.filter(
    (b) => !(b.tokenId === bid.tokenId && b.contractAddress === bid.contractAddress)
  );
  db.bids.push({ ...bid, placedAt: new Date().toISOString() });
  db.stats.totalBids += 1;
  writeDb(db);
}

function removeBid(tokenId, contractAddress) {
  const db = readDb();
  db.bids = db.bids.filter(
    (b) => !(b.tokenId === tokenId && b.contractAddress === contractAddress)
  );
  writeDb(db);
}

function removeBidByOrderHash(orderHash) {
  const db = readDb();
  db.bids = db.bids.filter((b) => b.orderHash !== orderHash);
  writeDb(db);
}

function addPendingApproval(approval) {
  const db = readDb();
  const id = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  db.pendingApprovals.push({ ...approval, id, createdAt: new Date().toISOString(), status: 'pending' });
  writeDb(db);
  return id;
}

function updateApproval(id, status) {
  const db = readDb();
  const approval = db.pendingApprovals.find((a) => a.id === id);
  if (approval) {
    approval.status = status;
    approval.resolvedAt = new Date().toISOString();
  }
  writeDb(db);
  return approval;
}

function addToWatchlist(collection) {
  const db = readDb();
  if (!db.watchlist.find((c) => c.slug === collection.slug)) {
    db.watchlist.push({ ...collection, addedAt: new Date().toISOString() });
  }
  writeDb(db);
}

function removeFromWatchlist(slug) {
  const db = readDb();
  db.watchlist = db.watchlist.filter((c) => c.slug !== slug);
  writeDb(db);
}

module.exports = {
  readDb,
  writeDb,
  getPortfolio,
  getTrades,
  getBids,
  getPendingApprovals,
  getStats,
  getWatchlist,
  addToPortfolio,
  removeFromPortfolio,
  addTrade,
  addBid,
  removeBid,
  removeBidByOrderHash,
  addPendingApproval,
  updateApproval,
  addToWatchlist,
  removeFromWatchlist,
};
