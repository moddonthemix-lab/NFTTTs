const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const api = axios.create({
  baseURL: config.opensea.apiBase,
  headers: { 'Accept': 'application/json' },
  timeout: 15000,
});

// Read the key at request time so Railway env vars are always picked up.
// This avoids the key being baked in as '' if the env isn't ready at module-load time.
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

/**
 * Fetch trending / high-volume collections.
 * OpenSea free tier caps each page at 20 results regardless of `limit`,
 * so we paginate using the `next` cursor until we have enough.
 */
async function getTrendingCollections(limit = 60) {
  const collected = [];
  const seen = new Set();
  let cursor = null;

  while (collected.length < limit) {
    try {
      const params = { chain: 'ethereum', limit: 20, order_by: 'one_day_volume' };
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
      logger.error(`OpenSea getTrendingCollections error ${status || 'network'}: ${JSON.stringify(detail)}`);
      throw new Error(`OpenSea API error ${status || 'network'}: ${JSON.stringify(detail)}`);
    }
  }

  logger.info(`getTrendingCollections: fetched ${collected.length} unique collections`);
  return collected.slice(0, limit);
}

/**
 * Search collections by name, slug, or contract address.
 * - If query looks like 0x address: resolve contract → slug → collection info
 * - Otherwise: try exact slug match, then fetch popular collections and
 *   filter by name/slug substring (OpenSea has no public name-search endpoint)
 */
async function searchCollections(query) {
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
      const contractRes = await rateLimitedCall(() => api.get(`/chain/ethereum/contract/${q}`));
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

  // Fetch up to 3 pages of popular collections and filter by name/slug
  const qLow = q.toLowerCase();
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    try {
      const params = { chain: 'ethereum', limit: 20, order_by: 'one_day_volume' };
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
async function getNFT(contractAddress, tokenId) {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get(`/chain/ethereum/contract/${contractAddress}/nfts/${tokenId}`);
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
async function getNFTsByOwner(walletAddress, limit = 50, next = null) {
  return rateLimitedCall(async () => {
    try {
      const params = { limit };
      if (next) params.next = next;
      const res = await api.get(`/chain/ethereum/account/${walletAddress}/nfts`, { params });
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
};
