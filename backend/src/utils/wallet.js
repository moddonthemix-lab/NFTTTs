const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('../config');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const WALLET_FILE = path.join(DATA_DIR, 'wallet.json');

let _provider = null;
let _wallet = null;

/**
 * Initialize provider from config RPC URL
 */
function getProvider() {
  if (!_provider) {
    if (!config.wallet.rpcUrl) {
      throw new Error('ETH_RPC_URL is not set in .env');
    }
    _provider = new ethers.JsonRpcProvider(config.wallet.rpcUrl);
  }
  return _provider;
}

/**
 * Load wallet from private key string.
 * Credentials are saved to the data volume so the wallet auto-loads after restarts.
 */
function loadFromPrivateKey(privateKey) {
  try {
    const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const provider = getProvider();
    _wallet = new ethers.Wallet(key, provider);
    saveWalletMeta({ address: _wallet.address, source: 'privateKey', privateKey: key });
    logger.info(`Wallet loaded: ${_wallet.address}`);
    return { address: _wallet.address };
  } catch (err) {
    throw new Error(`Invalid private key: ${err.message}`);
  }
}

/**
 * Load wallet from mnemonic / seed phrase.
 * Credentials are saved to the data volume so the wallet auto-loads after restarts.
 */
function loadFromMnemonic(mnemonic, derivationPath = "m/44'/60'/0'/0/0") {
  try {
    const provider = getProvider();
    const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonic.trim(), null, derivationPath);
    _wallet = hdWallet.connect(provider);
    saveWalletMeta({ address: _wallet.address, source: 'mnemonic', mnemonic: mnemonic.trim(), derivationPath });
    logger.info(`Wallet loaded from mnemonic: ${_wallet.address}`);
    return { address: _wallet.address };
  } catch (err) {
    throw new Error(`Invalid mnemonic: ${err.message}`);
  }
}

/**
 * Create a brand new random wallet
 */
function createNewWallet() {
  const provider = getProvider();
  const newWallet = ethers.Wallet.createRandom().connect(provider);
  _wallet = newWallet;
  const info = {
    address: newWallet.address,
    privateKey: newWallet.privateKey,
    mnemonic: newWallet.mnemonic?.phrase,
    source: 'generated',
  };
  // Save credentials so it auto-loads on restart
  saveWalletMeta({ address: newWallet.address, source: 'generated', privateKey: newWallet.privateKey });
  logger.info(`New wallet created: ${newWallet.address}`);
  // Return full info once — user must save the private key/mnemonic
  return info;
}

/**
 * Load wallet on startup.
 * Priority: env var > saved wallet.json credentials > address-only (needs reimport)
 */
function loadFromConfig() {
  if (config.wallet.privateKey) {
    return loadFromPrivateKey(config.wallet.privateKey);
  }
  if (fs.existsSync(WALLET_FILE)) {
    try {
      const meta = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
      if (meta.privateKey) {
        logger.info(`Auto-loading saved wallet: ${meta.address}`);
        return loadFromPrivateKey(meta.privateKey);
      }
      if (meta.mnemonic) {
        logger.info(`Auto-loading saved wallet from mnemonic: ${meta.address}`);
        return loadFromMnemonic(meta.mnemonic, meta.derivationPath);
      }
      // Address only (legacy) — needs re-import
      logger.warn(`Wallet address on file: ${meta.address} — re-import private key to sign transactions`);
      return { address: meta.address, needsReimport: true };
    } catch {
      return null;
    }
  }
  return null;
}

function saveWalletMeta(meta) {
  const dir = path.dirname(WALLET_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(meta, null, 2));
}

/**
 * Clear saved wallet credentials and disconnect in-memory wallet.
 */
function forgetWallet() {
  if (fs.existsSync(WALLET_FILE)) fs.unlinkSync(WALLET_FILE);
  _wallet = null;
  logger.info('Wallet cleared');
}

function getWallet() {
  return _wallet;
}

function getWalletAddress() {
  return _wallet?.address || null;
}

async function getBalance() {
  if (!_wallet) return null;
  try {
    const balance = await _wallet.provider.getBalance(_wallet.address);
    return parseFloat(ethers.formatEther(balance));
  } catch (err) {
    logger.error(`Failed to fetch balance: ${err.message}`);
    return null;
  }
}

async function getWalletInfo() {
  const address = getWalletAddress();
  if (!address) return { connected: false };
  const balance = await getBalance();
  // Check if credentials are saved (survives restart)
  const isSaved = fs.existsSync(WALLET_FILE) && (() => {
    try {
      const m = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
      return !!(m.privateKey || m.mnemonic);
    } catch { return false; }
  })();
  return {
    connected: true,
    address,
    balanceEth: balance,
    needsReimport: !_wallet?.signingKey,
    isSaved,
  };
}

function isConnected() {
  return _wallet !== null && !!_wallet.signingKey;
}

module.exports = {
  loadFromPrivateKey,
  loadFromMnemonic,
  createNewWallet,
  loadFromConfig,
  forgetWallet,
  getProvider,
  getWallet,
  getWalletAddress,
  getBalance,
  getWalletInfo,
  isConnected,
};
