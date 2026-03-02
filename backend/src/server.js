require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const walletUtils = require('./utils/wallet');
const db = require('./utils/database');
const { scanForOpportunities, scanCollection, setEmitter: setScanEmitter } = require('./scanner/collectionScanner');
const botEngine = require('./trader/botEngine');
const { buyNFT, placeBid, sellNFT, cancelOrder } = require('./trader/seaportTrader');

// --- Express Setup ---
const app = express();
app.use(cors({ origin: config.server.frontendUrl, credentials: true }));
app.use(express.json());

// Ensure logs dir exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// --- HTTP + Socket.IO ---
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: config.server.frontendUrl, methods: ['GET', 'POST'] },
});

// Wire emitters
const EventEmitter = require('events');
const botEmitter = new EventEmitter();
botEmitter.setMaxListeners(20);

setScanEmitter(botEmitter);
botEngine.setEmitter(botEmitter);

// Forward all bot events to connected sockets
botEmitter.onAny?.((event, data) => {
  io.emit(event, data);
});

// Fallback for Node versions without onAny
const BOT_EVENTS = [
  'scan:started', 'scan:collections', 'scan:opportunities', 'scan:error',
  'bot:started', 'bot:stopped', 'bot:cycle', 'bot:balance', 'bot:warn', 'bot:error',
  'trade:buy', 'trade:sell', 'trade:bid', 'trade:error',
  'approval:queued', 'approval:resolved',
];
BOT_EVENTS.forEach((evt) => {
  botEmitter.on(evt, (data) => io.emit(evt, data));
});

// --- Socket.IO connection ---
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  // Send current state on connect
  (async () => {
    const walletInfo = await walletUtils.getWalletInfo();
    socket.emit('init', {
      walletInfo,
      botRunning: botEngine.isBotRunning(),
      portfolio: db.getPortfolio(),
      trades: db.getTrades().slice(0, 50),
      bids: db.getBids(),
      pendingApprovals: db.getPendingApprovals().filter((a) => a.status === 'pending'),
      stats: db.getStats(),
      config: {
        autoTrade: config.autoTrade,
        maxBuyPriceEth: config.trading.maxBuyPriceEth,
        minProfitMargin: config.trading.minProfitMargin,
        maxPortfolioSize: config.trading.maxPortfolioSize,
        bidFraction: config.trading.bidFraction,
      },
    });
  })();

  socket.on('disconnect', () => logger.info(`Client disconnected: ${socket.id}`));
});

// ============================================================
// REST API Routes
// ============================================================

// --- Wallet ---
app.get('/api/wallet', async (req, res) => {
  try {
    const info = await walletUtils.getWalletInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wallet/import/privatekey', async (req, res) => {
  try {
    const { privateKey } = req.body;
    if (!privateKey) return res.status(400).json({ error: 'privateKey is required' });
    const result = walletUtils.loadFromPrivateKey(privateKey);
    const info = await walletUtils.getWalletInfo();
    io.emit('wallet:connected', info);
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/wallet/import/mnemonic', async (req, res) => {
  try {
    const { mnemonic, derivationPath } = req.body;
    if (!mnemonic) return res.status(400).json({ error: 'mnemonic is required' });
    walletUtils.loadFromMnemonic(mnemonic, derivationPath);
    const info = await walletUtils.getWalletInfo();
    io.emit('wallet:connected', info);
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/wallet/create', async (req, res) => {
  try {
    const result = walletUtils.createNewWallet();
    const info = await walletUtils.getWalletInfo();
    io.emit('wallet:connected', info);
    // Return full info including private key ONE TIME ONLY
    res.json({ success: true, ...result, warning: 'Save your private key and mnemonic — they will not be shown again!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Bot Control ---
app.post('/api/bot/start', (req, res) => {
  const started = botEngine.startBot();
  res.json({ running: botEngine.isBotRunning(), started });
});

app.post('/api/bot/stop', (req, res) => {
  const stopped = botEngine.stopBot();
  res.json({ running: botEngine.isBotRunning(), stopped });
});

app.get('/api/bot/status', async (req, res) => {
  const walletInfo = await walletUtils.getWalletInfo();
  res.json({
    running: botEngine.isBotRunning(),
    autoTrade: config.autoTrade,
    walletInfo,
    stats: db.getStats(),
  });
});

app.post('/api/bot/scan', async (req, res) => {
  try {
    const opportunities = await scanForOpportunities();
    res.json({ count: opportunities.length, opportunities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Scanner ---
app.get('/api/scanner/collection/:slug', async (req, res) => {
  try {
    const result = await scanCollection(req.params.slug);
    if (!result) return res.status(404).json({ error: 'Collection not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Portfolio ---
app.get('/api/portfolio', (req, res) => {
  res.json(db.getPortfolio());
});

// --- Trades ---
app.get('/api/trades', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(db.getTrades().slice(0, limit));
});

// --- Bids ---
app.get('/api/bids', (req, res) => {
  res.json(db.getBids());
});

app.post('/api/bids/place', async (req, res) => {
  try {
    const { collectionSlug, offerAmountEth, expirationHours } = req.body;
    if (!collectionSlug || !offerAmountEth) {
      return res.status(400).json({ error: 'collectionSlug and offerAmountEth are required' });
    }
    const result = await placeBid(collectionSlug, offerAmountEth, expirationHours);
    db.addBid({ collectionSlug, offerAmountEth, orderHash: result.orderHash });
    io.emit('trade:bid', result);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bids/:orderHash', async (req, res) => {
  try {
    await cancelOrder(req.params.orderHash);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Approvals ---
app.get('/api/approvals', (req, res) => {
  res.json(db.getPendingApprovals());
});

app.post('/api/approvals/:id/approve', async (req, res) => {
  try {
    const result = await botEngine.approveAction(req.params.id);
    res.json({ success: true, approval: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approvals/:id/reject', (req, res) => {
  try {
    const result = botEngine.rejectAction(req.params.id);
    res.json({ success: true, approval: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Manual Trade ---
app.post('/api/trade/buy', async (req, res) => {
  try {
    const { listing } = req.body;
    if (!listing) return res.status(400).json({ error: 'listing is required' });
    const result = await buyNFT(listing);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trade/sell', async (req, res) => {
  try {
    const { contractAddress, tokenId, priceEth } = req.body;
    if (!contractAddress || !tokenId || !priceEth) {
      return res.status(400).json({ error: 'contractAddress, tokenId, priceEth required' });
    }
    const result = await sellNFT(contractAddress, tokenId, priceEth);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Stats ---
app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

// --- Watchlist ---
app.get('/api/watchlist', (req, res) => res.json(db.getWatchlist()));

app.post('/api/watchlist', (req, res) => {
  const { slug, name, imageUrl } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  db.addToWatchlist({ slug, name, imageUrl });
  res.json({ success: true });
});

app.delete('/api/watchlist/:slug', (req, res) => {
  db.removeFromWatchlist(req.params.slug);
  res.json({ success: true });
});

// --- Health ---
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// --- Start server ---
const PORT = config.server.port;
httpServer.listen(PORT, () => {
  logger.info(`NFT Trading Bot server running on port ${PORT}`);

  // Auto-load wallet from config if key is set
  const loaded = walletUtils.loadFromConfig();
  if (loaded) {
    logger.info(`Wallet loaded: ${loaded.address}`);
  }
});

module.exports = { app, io };
