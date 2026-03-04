import axios from 'axios';

// In production the frontend is served by the same Express server (same origin).
// In local dev, point to the separate backend dev port.
const BASE = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

const api = axios.create({ baseURL: `${BASE}/api` });

// Attach stored password to every request
api.interceptors.request.use((config) => {
  const pw = sessionStorage.getItem('nftbot_auth');
  if (pw) config.headers['Authorization'] = `Bearer ${pw}`;
  return config;
});

export const walletApi = {
  getInfo: () => api.get('/wallet').then((r) => r.data),
  importPrivateKey: (privateKey) => api.post('/wallet/import/privatekey', { privateKey }).then((r) => r.data),
  importMnemonic: (mnemonic, derivationPath) => api.post('/wallet/import/mnemonic', { mnemonic, derivationPath }).then((r) => r.data),
  createNew: () => api.post('/wallet/create').then((r) => r.data),
  forget: () => api.delete('/wallet').then((r) => r.data),
};

export const ethPriceApi = {
  get: () => api.get('/ethprice').then((r) => r.data),
};

export const botApi = {
  start: () => api.post('/bot/start').then((r) => r.data),
  stop: () => api.post('/bot/stop').then((r) => r.data),
  status: () => api.get('/bot/status').then((r) => r.data),
  scan: () => api.post('/bot/scan').then((r) => r.data),
  diagnostics: () => api.get('/bot/diagnostics').then((r) => r.data),
};

export const scannerApi = {
  scanCollection: (slug) => api.get(`/scanner/collection/${slug}`).then((r) => r.data),
  search: (q, chain = 'ethereum') => api.get('/scanner/search', { params: { q, chain } }).then((r) => r.data),
  getBestOffer: (slug) => api.get(`/scanner/best-offer/${slug}`).then((r) => r.data.bestOfferEth),
  getNFTImage: (chain, contract, tokenId) => api.get(`/scanner/nft-image/${chain}/${contract}/${tokenId}`).then((r) => r.data.imageUrl).catch(() => null),
};

export const portfolioApi = {
  get: () => api.get('/portfolio').then((r) => r.data),
};

export const tradesApi = {
  get: (limit = 100) => api.get('/trades', { params: { limit } }).then((r) => r.data),
  buy: (listing) => api.post('/trade/buy', { listing }).then((r) => r.data),
  sell: (contractAddress, tokenId, priceEth) => api.post('/trade/sell', { contractAddress, tokenId, priceEth }).then((r) => r.data),
  snipe: (slug) => api.post(`/trade/snipe/${slug}`).then((r) => r.data),
  sweep: (slug, count, maxPriceEth) => api.post('/trade/sweep', { slug, count, maxPriceEth }).then((r) => r.data),
};

export const favoritesApi = {
  get: () => api.get('/favorites').then((r) => r.data),
  add: (opp) => api.post('/favorites', opp).then((r) => r.data),
  remove: (id) => api.delete(`/favorites/${encodeURIComponent(id)}`).then((r) => r.data),
};

export const bidsApi = {
  get: () => api.get('/bids').then((r) => r.data),
  place: (collectionSlug, offerAmountEth, expirationHours = 24, chain = 'ethereum') =>
    api.post('/bids/place', { collectionSlug, offerAmountEth, expirationHours, chain }).then((r) => r.data),
  cancel: (orderHash, chain = 'ethereum') => api.delete(`/bids/${orderHash}?chain=${chain}`).then((r) => r.data),
};

export const approvalsApi = {
  get: () => api.get('/approvals').then((r) => r.data),
  approve: (id) => api.post(`/approvals/${id}/approve`).then((r) => r.data),
  reject: (id) => api.post(`/approvals/${id}/reject`).then((r) => r.data),
};

export const statsApi = {
  get: () => api.get('/stats').then((r) => r.data),
};

export const watchlistApi = {
  get: () => api.get('/watchlist').then((r) => r.data),
  add: (slug, name, imageUrl) => api.post('/watchlist', { slug, name, imageUrl }).then((r) => r.data),
  remove: (slug) => api.delete(`/watchlist/${slug}`).then((r) => r.data),
};

export const whaleApi = {
  get: () => api.get('/whales').then((r) => r.data),
  add: (address, label) => api.post('/whales', { address, label }).then((r) => r.data),
  remove: (address) => api.delete(`/whales/${address}`).then((r) => r.data),
  getNfts: (address) => api.get(`/whales/${address}/nfts`).then((r) => r.data),
};

export default api;
