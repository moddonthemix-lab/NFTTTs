# NFT Trading Bot

Automated NFT flipping bot for OpenSea with a real-time React dashboard.

## Features

- **Scanner** — Continuously scans OpenSea for underpriced NFTs using a scoring algorithm
- **Auto-buy** — Purchases NFTs below floor price when profit margin is met
- **Bidding** — Places collection-wide WETH bids below floor price
- **Auto-sell** — Lists held NFTs when floor rises past your profit target
- **Manual Approval Mode** — Review every trade before it executes (default)
- **React Dashboard** — Live view of opportunities, portfolio, bids, approvals, trades, and logs
- **Wallet Management** — Import via private key, seed phrase, or create a new wallet

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo>
cd NFTTTs
npm run install:all
```

### 2. Configure

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — fill in your keys
```

Required `.env` values:
| Key | Description |
|-----|-------------|
| `OPENSEA_API_KEY` | Get from OpenSea developer portal |
| `ETH_RPC_URL` | Alchemy or Infura Ethereum mainnet URL |
| `WALLET_PRIVATE_KEY` | Your wallet private key (optional — can import via UI) |

### 3. Start the Backend

```bash
npm run dev:backend
# Server runs on http://localhost:3001
```

### 4. Start the Frontend

```bash
npm run dev:frontend
# Dashboard at http://localhost:3000
```

---

## Configuration

All bot parameters are in `backend/.env`:

| Key | Default | Description |
|-----|---------|-------------|
| `AUTO_TRADE` | `false` | `true` = auto-execute trades; `false` = manual approval |
| `MAX_BUY_PRICE_ETH` | `0.1` | Max ETH to spend per NFT |
| `MIN_PROFIT_MARGIN` | `0.15` | Min profit % to trigger a sell (0.15 = 15%) |
| `MAX_BUDGET_ETH` | `2.0` | Total ETH budget cap |
| `BID_FRACTION` | `0.85` | Bid at X% of floor price |
| `MAX_PORTFOLIO_SIZE` | `10` | Max NFTs to hold at once |
| `SCAN_INTERVAL_SECONDS` | `60` | How often to scan OpenSea |

---

## Architecture

```
backend/
  src/
    server.js          # Express + Socket.IO API server
    config.js          # Config from .env
    scanner/
      openSeaApi.js    # OpenSea API v2 wrapper
      collectionScanner.js  # Scan & rank opportunities
    analyzer/
      scorer.js        # Score NFTs, estimate profit
    trader/
      seaportTrader.js # Buy/sell/bid via Seaport v1.6
      botEngine.js     # Cron loop, approval queue
    utils/
      wallet.js        # Wallet import & signing
      database.js      # JSON file-based persistence
      logger.js        # Winston logger

frontend/
  src/
    App.js             # Router + socket state
    hooks/useSocket.js # Socket.IO state management
    pages/
      Dashboard.js     # Overview + stats + profit chart
      Scanner.js       # Live opportunity grid
      Portfolio.js     # Held NFTs + manual sell
      Approvals.js     # Approve/reject pending trades
      Bids.js          # Manage collection bids
      Trades.js        # Full trade history
      Wallet.js        # Import/create wallet
      Logs.js          # Live event log terminal
```

---

## Security Notes

- **Never commit your `.env` file** — it is gitignored
- Your private key is only held in memory; it is never written to disk by the server
- After a server restart you must re-import your private key via the UI (or set it in `.env`)
- Set `AUTO_TRADE=false` (default) to manually approve every trade
- This bot interacts with real ETH — test on a testnet first

---

## Disclaimer

This software is for educational purposes. NFT trading involves significant financial risk.
You can lose money. Use at your own risk.
