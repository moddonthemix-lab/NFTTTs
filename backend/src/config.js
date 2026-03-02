require('dotenv').config();

const config = {
  opensea: {
    apiKey: process.env.OPENSEA_API_KEY || '',
    apiBase: process.env.OPENSEA_API_BASE || 'https://api.opensea.io/api/v2',
  },
  wallet: {
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    rpcUrl: process.env.ETH_RPC_URL || '',
  },
  trading: {
    maxBuyPriceEth: parseFloat(process.env.MAX_BUY_PRICE_ETH || '0.005'),
    minProfitMargin: parseFloat(process.env.MIN_PROFIT_MARGIN || '0.005'),
    maxBudgetEth: parseFloat(process.env.MAX_BUDGET_ETH || '0.01'),
    bidFraction: parseFloat(process.env.BID_FRACTION || '0.85'),
    maxPortfolioSize: parseInt(process.env.MAX_PORTFOLIO_SIZE || '10'),
  },
  scanner: {
    intervalSeconds: parseInt(process.env.SCAN_INTERVAL_SECONDS || '60'),
    minCollectionVolume: parseFloat(process.env.MIN_COLLECTION_VOLUME || '5'),
    minFloorPrice: parseFloat(process.env.MIN_FLOOR_PRICE || '0.001'),
    maxFloorPrice: parseFloat(process.env.MAX_FLOOR_PRICE || '0.005'),
  },
  server: {
    port: parseInt(process.env.PORT || '3001'),
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
  autoTrade: process.env.AUTO_TRADE === 'true',
};

module.exports = config;
