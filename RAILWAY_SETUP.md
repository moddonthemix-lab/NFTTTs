# Deploy to Railway

## One-time setup (~5 minutes)

### 1. Push this repo to GitHub
Make sure your code is pushed to GitHub (Railway deploys from GitHub).

### 2. Create a Railway project
1. Go to https://railway.app and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select this repository
4. Railway auto-detects the `railway.json` and runs `npm run build:all`

### 3. Set Environment Variables
In Railway dashboard → your service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `OPENSEA_API_KEY` | Your OpenSea API key |
| `ETH_RPC_URL` | Your Alchemy/Infura mainnet URL |
| `WALLET_PRIVATE_KEY` | Your wallet private key *(or leave blank and import via UI)* |
| `NODE_ENV` | `production` |
| `MAX_BUY_PRICE_ETH` | e.g. `0.1` |
| `MIN_PROFIT_MARGIN` | e.g. `0.15` |
| `MAX_BUDGET_ETH` | e.g. `2.0` |
| `BID_FRACTION` | e.g. `0.85` |
| `AUTO_TRADE` | `false` *(recommended to start)* |
| `SCAN_INTERVAL_SECONDS` | `60` |

> **You do NOT need to set `PORT`** — Railway injects it automatically.
> **You do NOT need to set `FRONTEND_URL`** — the backend serves the frontend directly.

### 4. Deploy
Railway will build and deploy automatically. You'll get a public URL like:
```
https://nft-bot-abc123.railway.app
```

Open that URL — your full dashboard is live.

---

## Getting API Keys

### OpenSea API Key
1. Go to https://docs.opensea.io/reference/api-keys
2. Sign in and request an API key
3. Free tier: 4 requests/second (the bot respects this limit)

### Alchemy RPC URL (free)
1. Go to https://alchemy.com and create a free account
2. Create a new app → Network: **Ethereum Mainnet**
3. Copy the HTTPS URL — looks like:
   `https://eth-mainnet.g.alchemy.com/v2/your-key-here`

---

## Redeploying after changes
Railway auto-deploys on every push to your main branch.
Just `git push` and Railway rebuilds.

---

## Local development
```bash
# Terminal 1 — backend
cd backend && npm install && npm run dev

# Terminal 2 — frontend
cd frontend && npm install && npm start
```
Frontend: http://localhost:3000
Backend: http://localhost:3001
