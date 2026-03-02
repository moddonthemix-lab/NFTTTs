import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const api = axios.create({ baseURL: `${BASE}/api` });

export const walletApi = {
  getInfo: () => api.get('/wallet').then((r) => r.data),
  importPrivateKey: (privateKey) => api.post('/wallet/import/privatekey', { privateKey }).then((r) => r.data),
  importMnemonic: (mnemonic, derivationPath) => api.post('/wallet/import/mnemonic', { mnemonic, derivationPath }).then((r) => r.data),
  createNew: () => api.post('/wallet/create').then((r) => r.data),
};

export const botApi = {
  start: () => api.post('/bot/start').then((r) => r.data),
  stop: () => api.post('/bot/stop').then((r) => r.data),
  status: () => api.get('/bot/status').then((r) => r.data),
  scan: () => api.post('/bot/scan').then((r) => r.data),
};

export const scannerApi = {
  scanCollection: (slug) => api.get(`/scanner/collection/${slug}`).then((r) => r.data),
};

export const portfolioApi = {
  get: () => api.get('/portfolio').then((r) => r.data),
};

export const tradesApi = {
  get: (limit = 100) => api.get('/trades', { params: { limit } }).then((r) => r.data),
  buy: (listing) => api.post('/trade/buy', { listing }).then((r) => r.data),
  sell: (contractAddress, tokenId, priceEth) => api.post('/trade/sell', { contractAddress, tokenId, priceEth }).then((r) => r.data),
};

export const bidsApi = {
  get: () => api.get('/bids').then((r) => r.data),
  place: (collectionSlug, offerAmountEth, expirationHours = 24) =>
    api.post('/bids/place', { collectionSlug, offerAmountEth, expirationHours }).then((r) => r.data),
  cancel: (orderHash) => api.delete(`/bids/${orderHash}`).then((r) => r.data),
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

export default api;
