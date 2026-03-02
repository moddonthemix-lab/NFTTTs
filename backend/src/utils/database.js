const fs = require('fs');
const path = require('path');

// DATA_DIR env var lets Railway Volume override the path.
// Locally defaults to backend/data/. On Railway set DATA_DIR=/data (volume mount).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultDb = {
  portfolio: [],
  trades: [],
  bids: [],
  pendingApprovals: [],
  watchlist: [],   // legacy global watchlist (kept for backward compat)
  favorites: [],   // legacy global favorites (kept for backward compat)
  wallets: {},     // wallet-scoped data: { [address]: { favorites: [], watchlist: [] } }
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
    if (!fs.existsSync(DB_PATH)) { writeDb(defaultDb); return defaultDb; }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.wallets) parsed.wallets = {};
    return parsed;
  } catch {
    writeDb(defaultDb);
    return defaultDb;
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// --- Wallet bucket helper ---
function walletBucket(db, address) {
  if (!db.wallets) db.wallets = {};
  if (!db.wallets[address]) db.wallets[address] = { favorites: [], watchlist: [], whales: [] };
  if (!db.wallets[address].whales) db.wallets[address].whales = [];
  return db.wallets[address];
}

// --- Global reads (portfolio, trades, bids, etc.) ---
function getPortfolio() { return readDb().portfolio; }
function getTrades() { return readDb().trades; }
function getBids() { return readDb().bids; }
function getPendingApprovals() { return readDb().pendingApprovals; }
function getStats() { return readDb().stats; }

// --- Favorites (wallet-scoped, falls back to global if no address) ---
function getFavorites(address) {
  const db = readDb();
  if (address) return walletBucket(db, address).favorites || [];
  return db.favorites || [];
}

function addFavorite(address, opp) {
  const db = readDb();
  const bucket = address ? walletBucket(db, address) : db;
  if (!bucket.favorites) bucket.favorites = [];
  if (!bucket.favorites.find((f) => f.id === opp.id)) {
    bucket.favorites.push({ ...opp, savedAt: new Date().toISOString() });
  }
  writeDb(db);
}

function removeFavorite(address, id) {
  const db = readDb();
  const bucket = address ? walletBucket(db, address) : db;
  if (!bucket.favorites) return;
  bucket.favorites = bucket.favorites.filter((f) => f.id !== id);
  writeDb(db);
}

// --- Watchlist (wallet-scoped, falls back to global if no address) ---
function getWatchlist(address) {
  const db = readDb();
  if (address) return walletBucket(db, address).watchlist || [];
  return db.watchlist || [];
}

function addToWatchlist(address, collection) {
  const db = readDb();
  const bucket = address ? walletBucket(db, address) : db;
  if (!bucket.watchlist) bucket.watchlist = [];
  if (!bucket.watchlist.find((c) => c.slug === collection.slug)) {
    bucket.watchlist.push({ ...collection, addedAt: new Date().toISOString() });
  }
  writeDb(db);
}

function removeFromWatchlist(address, slug) {
  const db = readDb();
  const bucket = address ? walletBucket(db, address) : db;
  if (!bucket.watchlist) return;
  bucket.watchlist = bucket.watchlist.filter((c) => c.slug !== slug);
  writeDb(db);
}

// --- Whale Tracker (wallet-scoped) ---
function getWhales(address) {
  if (!address) return [];
  const db = readDb();
  return walletBucket(db, address).whales || [];
}

function addWhale(address, whale) {
  if (!address) return;
  const db = readDb();
  const bucket = walletBucket(db, address);
  if (bucket.whales.length >= 10) throw new Error('Max 10 whale wallets');
  if (!bucket.whales.find((w) => w.address.toLowerCase() === whale.address.toLowerCase())) {
    bucket.whales.push({ ...whale, addedAt: new Date().toISOString() });
  }
  writeDb(db);
}

function removeWhale(address, targetAddr) {
  if (!address) return;
  const db = readDb();
  const bucket = walletBucket(db, address);
  bucket.whales = bucket.whales.filter(
    (w) => w.address.toLowerCase() !== targetAddr.toLowerCase()
  );
  writeDb(db);
}

// --- Portfolio ---
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

// --- Trades ---
function addTrade(trade) {
  const db = readDb();
  db.trades.unshift({ ...trade, timestamp: new Date().toISOString() });
  if (db.trades.length > 500) db.trades = db.trades.slice(0, 500);
  if (trade.type === 'buy') db.stats.totalBought += trade.priceEth || 0;
  else if (trade.type === 'sell') {
    db.stats.totalSold += trade.priceEth || 0;
    db.stats.totalProfit += trade.profitEth || 0;
  }
  writeDb(db);
}

// --- Bids ---
function addBid(bid) {
  const db = readDb();
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

// --- Approvals ---
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
  if (approval) { approval.status = status; approval.resolvedAt = new Date().toISOString(); }
  writeDb(db);
  return approval;
}

module.exports = {
  readDb, writeDb,
  getPortfolio, getTrades, getBids, getPendingApprovals, getStats,
  getFavorites, addFavorite, removeFavorite,
  getWatchlist, addToWatchlist, removeFromWatchlist,
  getWhales, addWhale, removeWhale,
  addToPortfolio, removeFromPortfolio,
  addTrade,
  addBid, removeBid, removeBidByOrderHash,
  addPendingApproval, updateApproval,
};
