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

// 429 retry with exponential backoff (up to 4 retries: 1s, 4s, 9s, 16s)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const cfg = error.config;
    if (status === 429) {
      cfg._retryCount = (cfg._retryCount || 0) + 1;
      if (cfg._retryCount <= 4) {
        const retryAfterMs = parseInt(error.response.headers?.['retry-after'] || '0') * 1000;
        const backoffMs = retryAfterMs || Math.min(cfg._retryCount * cfg._retryCount * 1000, 16000);
        logger.warn(`OpenSea 429 rate limit — retry ${cfg._retryCount}/4 in ${Math.round(backoffMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, backoffMs));
        return api(cfg);
      }
    }
    return Promise.reject(error);
  }
);

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

/**
 * Get real marketplace fee + creator royalty for a collection.
 * Cached per slug for 1 hour — fees rarely change.
 * Returns { marketplaceFee, royaltyFee } as percentages (e.g. 2.5, 5.0).
 * Falls back to null on error (caller should use defaults).
 */
const _feesCache = new Map();
const FEES_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCollectionFees(slug) {
  const cached = _feesCache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < FEES_CACHE_TTL) return cached.fees;

  try {
    const col = await getCollection(slug);
    const rawFees = col?.fees || [];
    // OpenSea reduced their marketplace fee to 1% in early 2024 — hardcode it.
    // All entries in col.fees are creator royalties.
    // required=true  → on-chain enforced, cannot be waived
    // required=false → optional, creator preference only
    // OpenSea fee values: plain percentage (5.0 = 5%), basis points (500 = 5%), or decimal (0.05 = 5%)
    const normFee = (v) => {
      if (!v || isNaN(v)) return 0;
      if (v >= 100) return v / 100;  // basis points: 500 → 5.0
      if (v >= 1)   return v;        // percentage:   5.0 → 5.0, 1.0 → 1.0
      return v * 100;                // decimal:      0.05 → 5.0
    };

    // Deduplicate entries by recipient — some collections repeat the same address
    // multiple times (once per EIP-2981 path), which would otherwise double-count the fee
    const seenRecipients = new Set();
    const dedupedFees = rawFees.filter((f) => {
      const r = (f.recipient || '').toLowerCase();
      if (!r) return true;              // no recipient → always keep
      if (seenRecipients.has(r)) return false;
      seenRecipients.add(r);
      return true;
    });

    logger.debug(`[fees] ${slug}: ${dedupedFees.length} fee entries (${rawFees.length} raw): ${JSON.stringify(dedupedFees)}`);

    const marketplaceFee = 1.0;
    const enforcedRoyaltyFee = Math.min(
      dedupedFees.filter((f) => f.required).reduce((sum, f) => sum + normFee(Number(f.fee)), 0),
      15
    );
    const optionalRoyaltyFee = Math.min(
      dedupedFees.filter((f) => !f.required).reduce((sum, f) => sum + normFee(Number(f.fee)), 0),
      15
    );
    const royaltyFee = Math.min(enforcedRoyaltyFee + optionalRoyaltyFee, 15);
    const fees = { marketplaceFee, royaltyFee, enforcedRoyaltyFee, optionalRoyaltyFee };
    _feesCache.set(slug, { fees, fetchedAt: Date.now() });
    return fees;
  } catch {
    return null;
  }
}

function clearFeesCache() {
  _feesCache.clear();
}

/**
 * Parse an OpenSea URL or bare slug into a collection slug.
 * Handles:
 *   - https://opensea.io/collection/boredapeyachtclub
 *   - https://opensea.io/collection/boredapeyachtclub/drop
 *   - boredapeyachtclub  (bare slug)
 */
function parseSlug(input) {
  const s = (input || '').trim();
  const m = s.match(/opensea\.io\/collection\/([^/?#]+)/);
  if (m) return m[1].toLowerCase();
  // bare slug or unknown URL — just return cleaned string
  return s.toLowerCase().replace(/^https?:\/\/[^/]+\/?/, '').replace(/^collection\//, '').split(/[/?#]/)[0];
}

/**
 * Fetch drop phases for a collection and check wallet eligibility per phase.
 * walletAddress is optional — when provided, each phase gets an `eligible` field.
 * Returns { drop, phases } where phases is an array enriched with:
 *   - eligible: true | false | null (null = public phase or unknown)
 *   - mintPriceEth: number
 *   - status: 'upcoming' | 'active' | 'ended'
 */
async function getDropInfo(slugOrUrl, walletAddress = null, chain = 'ethereum') {
  const slug = parseSlug(slugOrUrl);
  if (!slug) throw new Error('Invalid collection slug or URL');

  const drop = await rateLimitedCall(async () => {
    const res = await api.get(`/drops/${slug}`).catch((err) => {
      if (err.response?.status === 404) throw new Error(`Collection "${slug}" not found on OpenSea`);
      throw err;
    });
    return res.data;
  });

  const rawPhases = drop.drop_stages || drop.phases || drop.drop_phases || [];
  const now = Date.now();

  const phases = await Promise.all(rawPhases.map(async (phase) => {
    const startMs = phase.start_date ? new Date(phase.start_date).getTime() : null;
    const endMs   = phase.end_date   ? new Date(phase.end_date).getTime()   : null;
    const status  = endMs && endMs < now
      ? 'ended'
      : startMs && startMs > now
        ? 'upcoming'
        : 'active';

    // mint_price can be in wei (string/number) or already in ETH (small float)
    let mintPriceEth = 0;
    if (phase.mint_price != null) {
      const raw = String(phase.mint_price);
      // if it looks like a large integer (wei) convert it
      mintPriceEth = raw.length >= 10
        ? parseFloat((BigInt(raw) * BigInt(1e6) / BigInt('1000000000000000000')).toString()) / 1e6
        : parseFloat(raw) || 0;
    }

    let eligible = phase.is_public ? true : null;

    // Check allowlist eligibility for gated phases
    if (!phase.is_public && walletAddress && status !== 'ended') {
      try {
        const r = await rateLimitedCall(() =>
          api.get(`/drops/${slug}/phases/${phase.stage}/allowlist`, {
            params: { wallet_address: walletAddress },
          })
        );
        eligible = r.data?.is_eligible ?? (r.data?.entries?.length > 0) ?? null;
      } catch {
        eligible = null; // unknown — API doesn't support it or phase has no allowlist endpoint
      }
    }

    return {
      stage:               phase.stage,
      title:               phase.title || phase.stage || 'Phase',
      startDate:           phase.start_date || null,
      endDate:             phase.end_date   || null,
      mintPriceEth,
      maxPerWallet:        phase.max_tokens_per_address || null,
      isPublic:            !!phase.is_public,
      allowlistEntries:    phase.allowlist_entries || null,
      status,
      eligible,
    };
  }));

  return {
    slug,
    name:            drop.name || slug,
    contractAddress: drop.primary_contract || drop.contract || null,
    contractType:    drop.contract_type || 'ERC721',
    chain:           drop.chain || chain,
    imageUrl:        drop.image_url || null,
    totalSupply:     drop.total_supply || null,
    phases,
  };
}

module.exports = {
  parseSlug,
  getDropInfo,
  clearFeesCache,
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
  getCollectionFees,
  getEthPriceUsd,
};
