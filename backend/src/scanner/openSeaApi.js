const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const api = axios.create({
  baseURL: config.opensea.apiBase,
  headers: {
    'X-API-KEY': config.opensea.apiKey,
    'Accept': 'application/json',
  },
  timeout: 15000,
});

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
 * Fetch trending / high-volume collections
 */
async function getTrendingCollections(limit = 50) {
  return rateLimitedCall(async () => {
    try {
      const res = await api.get('/collections', {
        params: {
          chain: 'ethereum',
          limit,
          order_by: 'one_day_volume',
        },
      });
      return res.data.collections || [];
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.errors?.[0] || err.response?.data?.detail || err.response?.data || err.message;
      logger.error(`OpenSea getTrendingCollections error ${status || 'network'}: ${JSON.stringify(detail)}`);
      // Re-throw with a descriptive message so the scanner can surface it
      throw new Error(`OpenSea API error ${status || 'network'}: ${JSON.stringify(detail)}`);
    }
  });
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
  getCollectionStats,
  getCheapestListings,
  getNFT,
  getNFTsByOwner,
  getOffers,
  getBestListing,
  getCollection,
};
