const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const api = axios.create({
  baseURL: config.opensea.apiBase,
  headers: { 'Accept': 'application/json' },
  timeout: 15000,
});

// Read the key at request time so Railway env vars are always picked up.
api.interceptors.request.use((reqConfig) => {
  const key = process.env.OPENSEA_API_KEY || config.opensea.apiKey;
  if (key) reqConfig.headers['X-API-KEY'] = key;
  return reqConfig;
});

// Startup diagnostic — shows in Railway logs
const _keyPreview = (process.env.OPENSEA_API_KEY || '').slice(0, 6);
logger.info(`OpenSea API key: ${_keyPreview ? `${_keyPreview}… (loaded)` : 'NOT SET — add OPENSEA_API_KEY in Railway Variables'}`);

// Simple rate-limit helper: max 4 req/sec for free tier
let lastCallTime = 0;
async function rateLimitedCall(fn) {
  const now = Date.now();
  const gap = now - lastCallTime;
  if (gap < 250) await new Promise((r) => setTimeout(r, 250 - gap));
  lastCallTime = Date.now();
  return fn();
}

// --- ETH/USD price (Binance primary, CoinGecko fallback, cached 5 min) ---
let _ethPriceUsd = null;
let _ethPriceAt = 0;

async function getEthPriceUsd() {
  const now = Date.now();
  if (_ethPriceUsd && now - _ethPriceAt < 5 * 60 * 1000) return _ethPriceUsd;

  // Try multiple sources in order, return as soon as one succeeds.

  // 1. Binance — no key, very reliable globally
  try {
    const r = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT', { timeout: 4000 });
    const price = parseFloat(r.data?.price);
    if (price > 0) { _ethPriceUsd = price; _ethPriceAt = now; return _ethPriceUsd; }
  } catch { /* try next */ }

  // 2. Coinbase — public endpoint, no key
  try {
    const r = await axios.get('https://api.coinbase.com/v2/prices/ETH-USD/spot', { timeout: 4000 });
    const price = parseFloat(r.data?.data?.amount);
    if (price > 0) { _ethPriceUsd = price; _ethPriceAt = now; return _ethPriceUsd; }
  } catch { /* try next */ }

  // 3. CryptoCompare — generous free tier
  try {
    const r = await axios.get('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD', { timeout: 4000 });
    const price = r.data?.USD;
    if (price > 0) { _ethPriceUsd = price; _ethPriceAt = now; return _ethPriceUsd; }
  } catch { /* try next */ }

  // 4. CoinGecko — lowest priority (strict rate limits on free tier)
  try {
    const r = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', { timeout: 5000 });
    const price = r.data?.ethereum?.usd;
    if (price > 0) { _ethPriceUsd = price; _ethPriceAt = now; }
  } catch { /* keep stale value */ }

  return _ethPriceUsd;
}

/**
 * Fetch trending / high-volume collections.
 * chain: 'ethereum' (default) or 'base'
 * OpenSea free tier caps each page at 20 results regardless of `limit`,
 * so we paginate using the `next` cursor until we have enough.
 */
async function getTrendingCollections(limit = 60, chain = 'ethereum') {
  const collected = [];
  const seen = new Set();
  let cursor = null;

  while (collected.length < limit) {
    try {
      const params = { chain, limit: 20, order_by: 'one_day_volume' };
      if (cursor) params.next = cursor;
      const res = await rateLimitedCall(() => api.get('/collections', { params }));
      const items = res.data.collections || [];
      for (const c of items) {
        const slug = c.collection || c.slug;
        if (slug && !seen.has(slug)) { seen.add(slug); collected.push(c); }
      }
      cursor = res.data.next || null;
      if (!cursor || items.length === 0) break;
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.errors?.[0] || err.response?.data?.detail || err.response?.data || err.message;
      logger.error(`OpenSea getTrendingCollections(${chain}) error ${status || 'network'}: ${JSON.stringify(detail)}`);
      throw new Error(`OpenSea API error ${status || 'network'}: ${JSON.stringify(detail)}`);
    }
  }

  logger.info(`getTrendingCollections: fetched ${collected.length} unique collections`);
  return collected.slice(0, limit);
}

/**
 * Search collections by name, slug, or contract address.
 * chain: 'ethereum' (default) or 'base'
 */
async function searchCollections(query, chain = 'ethereum') {
  const q = (query || '').trim();
  if (!q) return [];
  const results = [];
  const seen = new Set();

  const addCol = (c) => {
    const slug = c.collection || c.slug;
    if (slug && !seen.has(slug)) { seen.add(slug); results.push(c); }
  };

  // Contract address lookup
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
    try {
      const contractRes = await rateLimitedCall(() => api.get(`/chain/${chain}/contract/${q}`));
      const slug = contractRes.data?.collection;
      if (slug) {
        const colRes = await rateLimitedCall(() => api.get(`/collections/${slug}`));
        if (colRes.data) addCol(colRes.data);
      }
    } catch (err) {
      logger.warn(`searchCollections contract lookup failed: ${err.message}`);
    }
    return results;
  }

  // Try exact slug match first
  const slugGuess = q.toLowerCase().replace(/\s+/g, '-');
  try {
    const res = await rateLimitedCall(() => api.get(`/collections/${slugGuess}`));
    if (res.data?.collection) addCol(res.data);
  } catch { /* not found — continue */ }

  // Fetch up to 3 pages of popular collections on the selected chain and filter by name/slug
  const qLow = q.toLowerCase();
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    try {
      const params = { chain, limit: 20, order_by: 'one_day_volume' };
      if (cursor) params.next = cursor;
      const res = await rateLimitedCall(() => api.get('/collections', { params }));
      for (const c of res.data.collections || []) {
        const slug = c.collection || c.slug || '';
        const name = (c.name || '').toLowerCase();
        if (name.includes(qLow) || slug.toLowerCase().includes(qLow)) addCol(c);
      }
      cursor = res.data.next || null;
      if (!cursor) break;
    } catch { break; }
  }

  return results.slice(0, 20);
}

/**
 * Get collection stats (floor price, volume, etc.)
 */
async function getCollectionStats(slug) {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get(`/collections/${slug}/stats`);
      return res.data;
    } catch (err) {
      logger.error(`OpenSea getCollectionStats(${slug}) error: ${err.message}`);
      return null;
    }
  });
}

/**
 * Get cheapest listings for a collection
 */
async function getCheapestListings(slug, limit = 20) {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get('/listings/collection/' + slug + '/best', {
        params: { limit },
      });
      return res.data.listings || [];
    } catch (err) {
      logger.error(`OpenSea getCheapestListings(${slug}) error: ${err.message}`);
      return [];
    }
  });
}

/**
 * Get a single NFT's details
 */
async function getNFT(contractAddress, tokenId, chain = 'ethereum') {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get(`/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`);
      return res.data.nft || null;
    } catch (err) {
      logger.error(`OpenSea getNFT error: ${err.message}`);
      return null;
    }
  });
}

/**
 * Get NFTs owned by a wallet address
 */
async function getNFTsByOwner(walletAddress, limit = 50, next = null, chain = 'ethereum') {
  return rateLimitedCall(async () => {
    try {
      const params = { limit };
      if (next) params.next = next;
      const res = await api.get(`/chain/${chain}/account/${walletAddress}/nfts`, { params });
      return { nfts: res.data.nfts || [], next: res.data.next || null };
    } catch (err) {
      logger.error(`OpenSea getNFTsByOwner error: ${err.message}`);
      return { nfts: [], next: null };
    }
  });
}

/**
 * Get active offers/bids on an NFT
 */
async function getOffers(slug, tokenId) {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get(`/offers/collection/${slug}/nfts/${tokenId}/best`);
      return res.data.offers || [];
    } catch (err) {
      logger.error(`OpenSea getOffers error: ${err.message}`);
      return [];
    }
  });
}

/**
 * Get the best listing price for a specific NFT
 */
async function getBestListing(slug, tokenId) {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get(`/listings/collection/${slug}/nfts/${tokenId}/best`);
      return res.data.listings?.[0] || null;
    } catch (err) {
      logger.error(`OpenSea getBestListing error: ${err.message}`);
      return null;
    }
  });
}

/**
 * Best collection offer (highest floor bid — what you can sell any NFT for right now).
 * Returns the price in ETH, or null if no offers exist.
 */
async function getCollectionBestOffer(slug) {
  try {
    const res = await rateLimitedCall(() =>
      api.get(`/offers/collection/${slug}`, {
        params: { limit: 1, order_by: 'eth_price', order_direction: 'desc' },
      })
    );
    const offer = res.data?.offers?.[0];
    if (!offer) return null;
    // Collection offers pay in WETH — price lives in the offer[0].startAmount
    const startAmount = offer.protocol_data?.parameters?.offer?.[0]?.startAmount;
    if (!startAmount) return null;
    const eth = parseFloat((BigInt(startAmount) * BigInt(1e6) / BigInt('1000000000000000000')).toString()) / 1e6;
    return eth > 0 ? eth : null;
  } catch {
    return null;
  }
}

/**
 * Get rarity data for a single NFT (deep scan only — 1 extra API call per token).
 * Returns { rank, max_rank } or null.
 */
async function getNFTRarity(contractAddress, tokenId, chain = 'ethereum') {
  try {
    const res = await rateLimitedCall(() =>
      api.get(`/chain/${chain}/contract/${contractAddress}/nfts/${tokenId}`)
    );
    const rarity = res.data?.nft?.rarity;
    if (!rarity?.rank) return null;
    return { rank: rarity.rank, maxRank: rarity.max_rank || rarity.total_supply };
  } catch {
    return null;
  }
}

/**
 * Get collection info
 */
async function getCollection(slug) {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get(`/collections/${slug}`);
      return res.data;
    } catch (err) {
      logger.error(`OpenSea getCollection(${slug}) error: ${err.message}`);
      return null;
    }
  });
}

module.exports = {
  getTrendingCollections,
  searchCollections,
  getCollectionStats,
  getCheapestListings,
  getNFT,
  getNFTsByOwner,
  getOffers,
  getBestListing,
  getCollection,
  getCollectionBestOffer,
  getNFTRarity,
  getEthPriceUsd,
};
