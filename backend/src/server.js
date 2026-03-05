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
const openSeaApi = require('./scanner/openSeaApi');
const { getEthPriceUsd } = openSeaApi;
const botEngine = require('./trader/botEngine');
const { buyNFT, placeBid, sellNFT, acceptBestOffer, cancelOrder, getDiagnostics } = require('./trader/seaportTrader');
const { weiToEth } = require('./analyzer/scorer');

const isProd = process.env.NODE_ENV === 'production';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';

// --- Express Setup ---
const app = express();
app.use(cors({
  origin: isProd ? true : config.server.frontendUrl,
  credentials: true,
}));
app.use(express.json());

// --- Auth Middleware ---
// /api/health is always open (Railway health checks + frontend auth probe)
// Everything else under /api requires the password when one is configured.
function requireAuth(req, res, next) {
  if (!DASHBOARD_PASSWORD) return next();
  if (req.path === '/health') return next();
  const auth = req.headers['authorization'];
  if (!auth || auth !== `Bearer ${DASHBOARD_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
app.use('/api', requireAuth);

// Ensure logs dir exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// --- HTTP + Socket.IO ---
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: isProd ? true : config.server.frontendUrl,
    methods: ['GET', 'POST'],
  },
});

// --- Socket.IO Auth ---
io.use((socket, next) => {
  if (!DASHBOARD_PASSWORD) return next();
  const token = socket.handshake.auth?.token;
  if (token !== DASHBOARD_PASSWORD) return next(new Error('Unauthorized'));
  next();
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
  'trade:buy', 'trade:sell', 'trade:bid', 'trade:bid_filled', 'trade:list', 'trade:error',
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

// --- ETH/USD price ---
app.get('/api/ethprice', async (req, res) => {
  const usd = await getEthPriceUsd();
  res.json({ usd });
});

// --- Wallet ---
app.get('/api/wallet', async (req, res) => {
  try {
    const info = await walletUtils.getWalletInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wallet/balance', async (req, res) => {
  try {
    const chain = req.query.chain || 'ethereum';
    const balanceEth = await walletUtils.getBalanceForChain(chain);
    res.json({ chain, balanceEth });
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

app.delete('/api/wallet', (req, res) => {
  walletUtils.forgetWallet();
  io.emit('wallet:disconnected', {});
  res.json({ success: true });
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

app.get('/api/bot/diagnostics', async (req, res) => {
  try {
    const result = await getDiagnostics();
    res.json(result);
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

// Lightweight NFT image lookup — one call per card when a collection is expanded
app.get('/api/scanner/nft-image/:chain/:contract/:tokenId', async (req, res) => {
  try {
    const { chain, contract, tokenId } = req.params;
    const nft = await openSeaApi.getNFT(contract, tokenId, chain);
    res.json({ imageUrl: nft?.display_image_url || nft?.image_url || null });
  } catch {
    res.json({ imageUrl: null });
  }
});

// Lightweight best-offer lookup — one call per collection on first expand
app.get('/api/scanner/best-offer/:slug', async (req, res) => {
  try {
    const offer = await openSeaApi.getCollectionBestOffer(req.params.slug);
    res.json({ bestOfferEth: offer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick collection info for bid preview — name, image, floor, volume, best offer, fees
app.get('/api/scanner/info/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const [col, stats, bestOffer, fees] = await Promise.all([
      openSeaApi.getCollection(slug),
      openSeaApi.getCollectionStats(slug),
      openSeaApi.getCollectionBestOffer(slug),
      openSeaApi.getCollectionFees(slug).catch(() => null),
    ]);
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    res.json({
      name: col.name || slug,
      imageUrl: col.image_url || null,
      description: col.description || null,
      floorPriceEth: stats?.total?.floor_price || null,
      volume24hEth: stats?.intervals?.find((i) => i.interval === 'one_day')?.volume || null,
      numOwners: stats?.total?.num_owners || null,
      totalSupply: stats?.total?.count || null,
      bestOfferEth: bestOffer,
      fees: fees ? {
        marketplaceFee: fees.marketplaceFee,
        royaltyFee: fees.royaltyFee,
        enforcedRoyaltyFee: fees.enforcedRoyaltyFee,
        optionalRoyaltyFee: fees.optionalRoyaltyFee,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scanner/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const chain = req.query.chain || 'ethereum';
    if (!q) return res.status(400).json({ error: 'q is required' });
    const collections = await openSeaApi.searchCollections(q, chain);
    res.json({ collections });
  } catch (err) {
    // Surface the actual OpenSea API error response if available
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ error: detail });
  }
});

// --- Portfolio ---
app.get('/api/portfolio', (req, res) => {
  res.json(db.getPortfolio());
});

// Sync wallet NFTs into portfolio — fetches on-chain holdings and merges with DB
app.post('/api/portfolio/sync', async (req, res) => {
  try {
    if (!walletUtils.isConnected()) return res.status(400).json({ error: 'Wallet not connected' });
    const wallet = walletUtils.getWallet();
    const chain = req.body?.chain || 'ethereum';
    const { nfts } = await openSeaApi.getNFTsByOwner(wallet.address, 200, null, chain);
    if (!nfts || !nfts.length) return res.json({ added: 0, portfolio: db.getPortfolio() });

    const existing = db.getPortfolio();
    const existingKeys = new Set(existing.map((n) => `${n.contractAddress?.toLowerCase()}-${n.tokenId}`));

    let added = 0;
    for (const nft of nfts) {
      const key = `${nft.contract?.toLowerCase()}-${nft.identifier}`;
      if (existingKeys.has(key)) continue;
      db.addToPortfolio({
        tokenId: nft.identifier,
        contractAddress: nft.contract,
        collectionSlug: nft.collection,
        collectionName: nft.name || nft.collection,
        collectionImage: nft.display_image_url || nft.image_url || null,
        buyPriceEth: 0,
        acquiredVia: 'wallet_sync',
        chain,
      });
      existingKeys.add(key);
      added++;
    }

    res.json({ added, portfolio: db.getPortfolio() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const { collectionSlug, offerAmountEth, expirationHours, chain = 'ethereum' } = req.body;
    if (!collectionSlug || !offerAmountEth) {
      return res.status(400).json({ error: 'collectionSlug and offerAmountEth are required' });
    }
    const result = await placeBid(collectionSlug, offerAmountEth, expirationHours, chain);
    db.addBid({ collectionSlug, offerAmountEth, orderHash: result.orderHash, chain });
    io.emit('trade:bid', result);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bids/:orderHash', async (req, res) => {
  try {
    const chain = req.query.chain || 'ethereum';
    await cancelOrder(req.params.orderHash, chain);
    db.removeBidByOrderHash(req.params.orderHash);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force-remove a bid from DB without calling the blockchain cancel.
// Use when a bid is expired/unfunded and you just want to clean up the list.
app.delete('/api/bids/:orderHash/remove', (req, res) => {
  db.removeBidByOrderHash(req.params.orderHash);
  res.json({ success: true });
});

app.post('/api/bids/:orderHash/fill', async (req, res) => {
  try {
    const { orderHash } = req.params;
    const bids = db.getBids();
    const bid = bids.find((b) => b.orderHash === orderHash);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });

    // Try to find the actual NFT token received in the wallet for this collection
    let tokenId = null;
    let contractAddress = null;
    if (walletUtils.isConnected()) {
      try {
        const wallet = walletUtils.getWallet();
        const { nfts } = await openSeaApi.getNFTsByOwner(wallet.address, 50, null, bid.chain || 'ethereum');
        const portfolioKeys = new Set(db.getPortfolio().map((n) => `${n.contractAddress?.toLowerCase()}-${n.tokenId}`));
        const match = nfts.find(
          (n) => n.collection === bid.collectionSlug && !portfolioKeys.has(`${n.contract?.toLowerCase()}-${n.identifier}`)
        );
        if (match) { tokenId = match.identifier; contractAddress = match.contract; }
      } catch { /* best-effort */ }
    }

    const trade = {
      type: 'buy', collectionSlug: bid.collectionSlug, collectionName: bid.collectionSlug,
      tokenId, contractAddress, priceEth: parseFloat(bid.offerAmountEth || 0), source: 'bid_fill', orderHash,
    };
    const portfolioEntry = {
      collectionSlug: bid.collectionSlug, collectionName: bid.collectionSlug,
      tokenId, contractAddress, buyPriceEth: parseFloat(bid.offerAmountEth || 0),
      chain: bid.chain || 'ethereum', acquiredVia: 'bid_fill',
    };
    db.removeBidByOrderHash(orderHash);
    db.addTrade(trade);
    db.addToPortfolio(portfolioEntry);
    io.emit('trade:bid_filled', { ...bid, trade, portfolioEntry });
    res.json({ success: true, tokenId, contractAddress });
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

// --- Favorites (wallet-scoped) ---
const wa = () => walletUtils.getWalletAddress(); // current wallet address or null

app.get('/api/favorites', (req, res) => res.json(db.getFavorites(wa())));

app.post('/api/favorites', (req, res) => {
  const opp = req.body;
  if (!opp || !opp.id) return res.status(400).json({ error: 'opportunity object with id required' });
  db.addFavorite(wa(), opp);
  res.json({ success: true });
});

app.delete('/api/favorites/:id', (req, res) => {
  db.removeFavorite(wa(), decodeURIComponent(req.params.id));
  res.json({ success: true });
});

// --- Snipe Floor (buy single cheapest listing) ---
app.post('/api/trade/snipe/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const listings = await openSeaApi.getCheapestListings(slug, 1);
    if (!listings.length) return res.status(404).json({ error: 'No listings found for this collection' });
    const listing = listings[0];
    const priceEth = weiToEth(listing.price?.current?.value, listing.price?.current?.decimals);
    logger.info(`Snipe: ${slug} @ ${priceEth} ETH, order=${listing.order_hash}, chain=${listing.chain}`);
    const result = await buyNFT(listing);
    db.addTrade({ type: 'buy', collectionSlug: slug, priceEth, txHash: result.txHash, source: 'snipe' });
    io.emit('trade:buy', { ...result, collectionSlug: slug, priceEth, source: 'snipe' });
    res.json({ success: true, ...result, priceEth, listing });
  } catch (err) {
    logger.error(`Snipe failed [${slug}]: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --- Sweep Floor (buy N cheapest listings) ---
app.post('/api/trade/sweep', async (req, res) => {
  const { slug, count = 1, maxPriceEth } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug is required' });
  const cap = Math.min(Math.max(1, parseInt(count) || 1), 100);
  try {
    const listings = await openSeaApi.getCheapestListings(slug, cap * 2); // fetch extra in case some are filtered
    const eligible = listings.filter((l) => {
      const price = weiToEth(l.price?.current?.value, l.price?.current?.decimals);
      return price > 0 && (!maxPriceEth || price <= parseFloat(maxPriceEth));
    }).slice(0, cap);
    if (!eligible.length) return res.status(404).json({ error: 'No eligible listings found within price limit' });

    const results = [];
    for (const listing of eligible) {
      const priceEth = weiToEth(listing.price?.current?.value, listing.price?.current?.decimals);
      try {
        const buyResult = await buyNFT(listing);
        db.addTrade({ type: 'buy', collectionSlug: slug, priceEth, txHash: buyResult.txHash, source: 'sweep' });
        io.emit('trade:buy', { ...buyResult, collectionSlug: slug, priceEth, source: 'sweep' });
        results.push({ success: true, priceEth, txHash: buyResult.txHash });
      } catch (err) {
        results.push({ success: false, priceEth, error: err.message });
      }
    }
    res.json({ results, bought: results.filter((r) => r.success).length, attempted: eligible.length });
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
    const { contractAddress, tokenId, priceEth, chain = 'ethereum' } = req.body;
    if (!contractAddress || !tokenId || !priceEth) {
      return res.status(400).json({ error: 'contractAddress, tokenId, priceEth required' });
    }
    const portfolioItem = db.getPortfolio().find(
      (n) => n.contractAddress?.toLowerCase() === contractAddress.toLowerCase() && n.tokenId === tokenId
    );
    const result = await sellNFT(contractAddress, tokenId, priceEth, 72, chain);
    const listPrice = parseFloat(priceEth);
    db.addTrade({
      type: 'list',
      contractAddress,
      tokenId,
      collectionSlug: portfolioItem?.collectionSlug,
      collectionName: portfolioItem?.collectionName,
      priceEth: listPrice,
      orderHash: result.orderHash,
      chain,
    });
    db.updatePortfolioListing(contractAddress, tokenId, {
      listed: true,
      listingPriceEth: listPrice,
      listingOrderHash: result.orderHash,
      listedAt: new Date().toISOString(),
    });
    io.emit('trade:list', { contractAddress, tokenId, collectionSlug: portfolioItem?.collectionSlug, priceEth: listPrice, orderHash: result.orderHash });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trade/accept-offer', async (req, res) => {
  try {
    const { contractAddress, tokenId, collectionSlug, chain = 'ethereum' } = req.body;
    if (!contractAddress || !tokenId || !collectionSlug) {
      return res.status(400).json({ error: 'contractAddress, tokenId, collectionSlug required' });
    }
    const result = await acceptBestOffer(contractAddress, tokenId, collectionSlug, chain);
    // Remove from portfolio and record as sell trade
    db.removeFromPortfolio(tokenId, contractAddress);
    db.addTrade({ type: 'sell', collectionSlug, contractAddress, tokenId, priceEth: result.offerPriceEth, txHash: result.txHash, source: 'accept_offer' });
    io.emit('trade:sell', { collectionSlug, contractAddress, tokenId, priceEth: result.offerPriceEth, txHash: result.txHash });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch the best offer price for a specific NFT (for display in Portfolio)
app.get('/api/portfolio/:contractAddress/:tokenId/best-offer', async (req, res) => {
  try {
    const { contractAddress, tokenId } = req.params;
    const { slug, chain = 'ethereum' } = req.query;
    if (!slug) return res.status(400).json({ error: 'slug query param required' });
    const offerRes = await openSeaApi.getOffers(slug, tokenId);
    const best = offerRes?.[0];
    const priceEth = best?.current_price
      ? parseFloat(require('ethers').formatEther(best.current_price))
      : null;
    res.json({ priceEth, orderHash: best?.order_hash || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Stats ---
app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

// --- Watchlist (wallet-scoped) ---
app.get('/api/watchlist', (req, res) => res.json(db.getWatchlist(wa())));

app.post('/api/watchlist', (req, res) => {
  const { slug, name, imageUrl } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  db.addToWatchlist(wa(), { slug, name, imageUrl });
  res.json({ success: true });
});

app.delete('/api/watchlist/:slug', (req, res) => {
  db.removeFromWatchlist(wa(), req.params.slug);
  res.json({ success: true });
});

// --- Whale Tracker ---
app.get('/api/whales', (req, res) => res.json(db.getWhales(wa())));

app.post('/api/whales', (req, res) => {
  const { address, label } = req.body;
  if (!address) return res.status(400).json({ error: 'address required' });
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'invalid Ethereum address' });
  try {
    db.addWhale(wa(), { address, label: label || '' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/whales/:address', (req, res) => {
  db.removeWhale(wa(), req.params.address);
  res.json({ success: true });
});

// Fetch NFT holdings for a tracked wallet — groups by collection + estimates value
// ?full=true  → paginate all NFTs (up to 2000), enrich all collections  [slow]
// default     → first 3 pages (150 NFTs), enrich top 10 by count        [fast]
app.get('/api/whales/:address/nfts', async (req, res) => {
  try {
    const { address } = req.params;
    const fullScan = req.query.full === 'true';
    const PAGE_LIMIT = fullScan ? 40 : 3;
    const ENRICH_LIMIT = fullScan ? 50 : 10;

    const colMap = new Map();
    let totalNfts = 0;
    let nextCursor = null;
    let truncated = false;
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const { nfts, next } = await openSeaApi.getNFTsByOwner(address, 50, nextCursor);
      totalNfts += nfts.length;
      for (const nft of nfts) {
        const slug = nft.collection || 'unknown';
        if (!colMap.has(slug)) colMap.set(slug, { slug, name: slug, image: null, count: 0, floorPriceEth: null });
        colMap.get(slug).count++;
      }
      nextCursor = next;
      if (!next) break;
      if (page === PAGE_LIMIT - 1 && next) truncated = true;
    }

    // Sort by count — top collections first
    const collections = Array.from(colMap.values()).sort((a, b) => b.count - a.count);

    // Enrich top N collections with name, image, and floor price
    for (let i = 0; i < Math.min(collections.length, ENRICH_LIMIT); i++) {
      const col = collections[i];
      const [info, stats] = await Promise.allSettled([
        openSeaApi.getCollection(col.slug),
        openSeaApi.getCollectionStats(col.slug),
      ]);
      if (info.status === 'fulfilled' && info.value) {
        col.name = info.value.name || col.slug;
        if (info.value.image_url) col.image = info.value.image_url;
      }
      if (stats.status === 'fulfilled' && stats.value) {
        col.floorPriceEth = stats.value.total?.floor_price || null;
      }
      col.nfts = new Array(col.count); // frontend expects col.nfts.length
    }
    // Non-enriched collections still need nfts array
    for (let i = ENRICH_LIMIT; i < collections.length; i++) {
      collections[i].nfts = new Array(collections[i].count);
    }

    const netValueEth = collections.reduce((sum, c) => {
      return sum + (c.floorPriceEth ? c.count * c.floorPriceEth : 0);
    }, 0);

    res.json({ address, totalNfts, truncated, fullScan, netValueEth, collections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Health ---
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  authRequired: !!DASHBOARD_PASSWORD,
  timestamp: new Date().toISOString(),
}));

// --- Serve React frontend in production ---
if (isProd) {
  const frontendBuild = path.join(__dirname, '../../frontend/build');
  if (fs.existsSync(frontendBuild)) {
    app.use(express.static(frontendBuild));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
        res.sendFile(path.join(frontendBuild, 'index.html'));
      }
    });
    logger.info('Serving React frontend from build/');
  }
}

// --- Start server ---
// Railway injects PORT automatically; fallback to config for local dev
const PORT = process.env.PORT || config.server.port;
httpServer.listen(PORT, () => {
  logger.info(`NFT Claw Machine server running on port ${PORT}`);

  // Auto-load wallet from config if key is set
  const loaded = walletUtils.loadFromConfig();
  if (loaded) {
    logger.info(`Wallet loaded: ${loaded.address}`);
  }

  // Standalone bid fill monitor — runs every 90s whether or not the bot is active.
  // Skipped when the bot is running (it already calls manageBids internally).
  setInterval(async () => {
    try {
      if (!botEngine.isBotRunning() && walletUtils.isConnected() && db.getBids().length > 0) {
        logger.info('Bid monitor: checking for fills...');
        await botEngine.manageBids();
      }
    } catch (err) {
      logger.warn(`Bid monitor error: ${err.message}`);
    }
  }, 90_000);
});

module.exports = { app, io };
