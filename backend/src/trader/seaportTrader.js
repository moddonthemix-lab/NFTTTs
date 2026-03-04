const { ethers } = require('ethers');
const axios = require('axios');
const walletUtils = require('../utils/wallet');
const config = require('../config');
const logger = require('../utils/logger');

// Seaport v1.6 contract address (mainnet)
const SEAPORT_ADDRESS = '0x0000000000000068F116a894984e2DB1123eB395';

// WETH on mainnet
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const TX_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

// Seaport v1.6 EIP-712 domain — fixed, never changes
const SEAPORT_DOMAIN = {
  name: 'Seaport',
  version: '1.6',
  chainId: 1,
  verifyingContract: SEAPORT_ADDRESS,
};

// Seaport v1.6 EIP-712 types — fixed for all orders (NOT returned by the OpenSea API)
const SEAPORT_ORDER_TYPES = {
  OrderComponents: [
    { name: 'offerer',                       type: 'address'             },
    { name: 'zone',                          type: 'address'             },
    { name: 'offer',                         type: 'OfferItem[]'         },
    { name: 'consideration',                 type: 'ConsiderationItem[]' },
    { name: 'orderType',                     type: 'uint8'               },
    { name: 'startTime',                     type: 'uint256'             },
    { name: 'endTime',                       type: 'uint256'             },
    { name: 'zoneHash',                      type: 'bytes32'             },
    { name: 'salt',                          type: 'uint256'             },
    { name: 'conduitKey',                    type: 'bytes32'             },
    { name: 'counter',                       type: 'uint256'             },
  ],
  OfferItem: [
    { name: 'itemType',             type: 'uint8'   },
    { name: 'token',                type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount',          type: 'uint256' },
    { name: 'endAmount',            type: 'uint256' },
  ],
  ConsiderationItem: [
    { name: 'itemType',             type: 'uint8'   },
    { name: 'token',                type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount',          type: 'uint256' },
    { name: 'endAmount',            type: 'uint256' },
    { name: 'recipient',            type: 'address' },
  ],
};

const WETH_ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 wad) external',
  'function approve(address guy, uint256 wad) external returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
];

const osHeaders = () => ({ 'X-API-KEY': config.opensea.apiKey, 'Content-Type': 'application/json' });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForConfirmation(tx) {
  const receipt = await Promise.race([
    tx.wait(1),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TX ${tx.hash} not confirmed within 5 minutes`)), TX_CONFIRM_TIMEOUT_MS)
    ),
  ]);
  if (receipt.status === 0) throw new Error(`Transaction ${tx.hash} reverted on-chain`);
  return receipt;
}

async function ensureWETH(wallet, amountWei) {
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
  const balance = await weth.balanceOf(wallet.address);
  if (balance < amountWei) {
    const needed = amountWei - balance;
    logger.info(`Wrapping ${ethers.formatEther(needed)} ETH -> WETH`);
    const tx = await weth.deposit({ value: needed });
    await waitForConfirmation(tx);
    logger.info('WETH wrap confirmed');
  } else {
    logger.info(`WETH OK: ${ethers.formatEther(balance)} available`);
  }
}

async function approveWETH(wallet, amountWei) {
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
  const allowance = await weth.allowance(wallet.address, SEAPORT_ADDRESS);
  if (allowance < amountWei) {
    logger.info('Approving Seaport to spend WETH (one-time gas cost)...');
    const tx = await weth.approve(SEAPORT_ADDRESS, ethers.MaxUint256);
    await waitForConfirmation(tx);
    logger.info('Seaport WETH approval confirmed');
  } else {
    logger.info('Seaport WETH allowance already sufficient');
  }
}

// ─── Buy ─────────────────────────────────────────────────────────────────────

async function buyNFT(listing) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected. Import a wallet first.');

  logger.info(`Buying NFT: order ${listing.order_hash}`);

  const res = await axios.post(
    `${config.opensea.apiBase}/listings/fulfillment_data`,
    {
      listing: {
        hash: listing.order_hash,
        chain: listing.chain || 'ethereum',
        protocol_address: SEAPORT_ADDRESS,
      },
      fulfiller: { address: wallet.address },
    },
    { headers: osHeaders() }
  );

  const txParams = res.data?.fulfillment_data?.transaction;
  if (!txParams) {
    throw new Error(`OpenSea did not return fulfillment tx. Response: ${JSON.stringify(res.data)}`);
  }

  const tx = await wallet.sendTransaction({
    to: txParams.to,
    data: txParams.input_data,
    value: BigInt(txParams.value || '0'),
    gasLimit: BigInt(txParams.gas || '300000'),
  });

  logger.info(`Buy TX sent: ${tx.hash}`);
  const receipt = await waitForConfirmation(tx);
  logger.info(`Buy confirmed: ${receipt.hash} (block ${receipt.blockNumber})`);

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
}

// ─── Bid (collection offer) ───────────────────────────────────────────────────

/**
 * Place a collection offer on OpenSea using Seaport v1.6.
 *
 * Flow:
 *  1. Wrap ETH -> WETH if balance insufficient (on-chain, costs gas)
 *  2. Approve Seaport to spend WETH — one-time per wallet (on-chain, costs gas)
 *  3. POST /offers/build  -> OpenSea returns order parameters
 *  4. Sign with hardcoded Seaport EIP-712 types (no gas — just signing)
 *  5. POST /offers with signed parameters -> bid is live on OpenSea
 *
 * NOTE: OpenSea's /offers/build response contains `partial_order.parameters`
 * but does NOT include EIP-712 types or a `value` field — those are hardcoded
 * above as SEAPORT_ORDER_TYPES.
 */
async function placeBid(collectionSlug, offerAmountEth, expirationHours = 24) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected.');

  logger.info(`Placing bid: ${collectionSlug} @ ${offerAmountEth} ETH (${expirationHours}h)`);

  const offerAmountWei = ethers.parseEther(offerAmountEth.toString());

  await ensureWETH(wallet, offerAmountWei);
  await approveWETH(wallet, offerAmountWei);

  const expiration = Math.floor(Date.now() / 1000) + expirationHours * 3600;

  const buildPayload = {
    criteria: { collection: { slug: collectionSlug } },
    protocol_address: SEAPORT_ADDRESS,
    quantity: 1,
    offer_protected: false,
    offerer: wallet.address,
    consideration: [
      {
        item_type: 1,                         // ERC20 = WETH
        token: WETH_ADDRESS,
        identifier_or_criteria: '0',
        start_amount: offerAmountWei.toString(),
        end_amount: offerAmountWei.toString(),
        recipient: wallet.address,
      },
    ],
    expiration_time: expiration.toString(),
  };

  logger.info('Calling /offers/build...');
  const buildRes = await axios.post(
    `${config.opensea.apiBase}/offers/build`,
    buildPayload,
    { headers: osHeaders() }
  );

  const partialOrder = buildRes.data?.partial_order;
  if (!partialOrder?.parameters) {
    throw new Error(`/offers/build missing parameters. Got: ${JSON.stringify(buildRes.data)}`);
  }
  logger.info('Got order parameters, signing...');

  const signature = await wallet.signTypedData(
    SEAPORT_DOMAIN,
    SEAPORT_ORDER_TYPES,
    partialOrder.parameters
  );
  logger.info(`Signed: ${signature.slice(0, 22)}...`);

  logger.info('Submitting to /offers...');
  const submitRes = await axios.post(
    `${config.opensea.apiBase}/offers`,
    {
      criteria: { collection: { slug: collectionSlug } },
      protocol_address: SEAPORT_ADDRESS,
      protocol_data: {
        parameters: partialOrder.parameters,
        signature,
      },
    },
    { headers: osHeaders() }
  );

  const orderHash = submitRes.data?.order_hash || submitRes.data?.order?.order_hash;
  logger.info(`Bid live on ${collectionSlug}: order ${orderHash}`);

  return { orderHash, collectionSlug, offerAmountEth, expirationHours };
}

// ─── Sell (create listing) ────────────────────────────────────────────────────

async function sellNFT(contractAddress, tokenId, priceEth, expirationHours = 72) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected.');

  logger.info(`Listing ${contractAddress}/${tokenId} for ${priceEth} ETH`);

  const priceWei = ethers.parseEther(priceEth.toString());
  const now = Math.floor(Date.now() / 1000);

  const buildPayload = {
    parameters: {
      offerer: wallet.address,
      offer: [
        {
          itemType: 2,                                // ERC721
          token: contractAddress,
          identifierOrCriteria: tokenId.toString(),
          startAmount: '1',
          endAmount: '1',
        },
      ],
      consideration: [
        {
          itemType: 0,                                // native ETH
          token: ethers.ZeroAddress,
          identifierOrCriteria: '0',
          startAmount: priceWei.toString(),
          endAmount: priceWei.toString(),
          recipient: wallet.address,
        },
      ],
      startTime: now.toString(),
      endTime: (now + expirationHours * 3600).toString(),
      orderType: 0,                                   // FULL_OPEN
      zone: ethers.ZeroAddress,
      zoneHash: ethers.ZeroHash,
      salt: ethers.hexlify(ethers.randomBytes(32)),
      conduitKey: ethers.ZeroHash,
      totalOriginalConsiderationItems: '1',
    },
    protocol_address: SEAPORT_ADDRESS,
  };

  const buildRes = await axios.post(
    `${config.opensea.apiBase}/listings/build`,
    buildPayload,
    { headers: osHeaders() }
  );

  if (!buildRes.data) throw new Error('Empty response from /listings/build');
  const orderData = buildRes.data;

  // OpenSea may return ready-made EIP-712 fields or just parameters — handle both
  const domain      = orderData.domain   || SEAPORT_DOMAIN;
  const orderParams = orderData.value    || orderData.parameters || orderData;
  const rawTypes    = orderData.types    || SEAPORT_ORDER_TYPES;
  // ethers v6 handles domain separately — strip EIP712Domain if present in types
  const types = Object.fromEntries(Object.entries(rawTypes).filter(([k]) => k !== 'EIP712Domain'));

  const signature = await wallet.signTypedData(domain, types, orderParams);

  const submitRes = await axios.post(
    `${config.opensea.apiBase}/listings`,
    {
      parameters: orderData.parameters || orderParams,
      protocol_address: SEAPORT_ADDRESS,
      signature,
    },
    { headers: osHeaders() }
  );

  const orderHash = submitRes.data?.order_hash;
  logger.info(`Listed token ${tokenId}: order ${orderHash}`);

  return { orderHash, contractAddress, tokenId, priceEth };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

async function cancelOrder(orderHash) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected.');

  const res = await axios.post(
    `${config.opensea.apiBase}/orders/chain/ethereum/seaport/${orderHash}/cancel`,
    {},
    { headers: osHeaders() }
  );

  logger.info(`Cancel requested: ${orderHash}`);
  return res.data;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Check all prerequisites for trading.
 * Called by GET /api/bot/diagnostics so the UI can show exactly what is missing.
 */
async function getDiagnostics() {
  const out = {
    walletAddress: null,
    ethBalanceEth: null,
    wethBalanceEth: null,
    seaportAllowance: null,   // 'unlimited' | '<n> ETH'
    rpcConnected: false,
    apiKeyValid: false,
    errors: [],
    ready: false,
  };

  const wallet = walletUtils.getWallet();
  if (!wallet) {
    out.errors.push('No wallet connected — import a private key or mnemonic first');
    return out;
  }

  out.walletAddress = wallet.address;

  try {
    const ethBal = await wallet.provider.getBalance(wallet.address);
    out.ethBalanceEth = parseFloat(ethers.formatEther(ethBal)).toFixed(6);
    out.rpcConnected = true;

    const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet.provider);
    const wethBal = await weth.balanceOf(wallet.address);
    out.wethBalanceEth = parseFloat(ethers.formatEther(wethBal)).toFixed(6);

    const allowance = await weth.allowance(wallet.address, SEAPORT_ADDRESS);
    out.seaportAllowance = allowance >= ethers.parseEther('1000')
      ? 'unlimited'
      : `${parseFloat(ethers.formatEther(allowance)).toFixed(4)} WETH`;
  } catch (err) {
    out.errors.push(`RPC error (check ETH_RPC_URL): ${err.message}`);
  }

  try {
    await axios.get(`${config.opensea.apiBase}/collections?limit=1`, { headers: { 'X-API-KEY': config.opensea.apiKey } });
    out.apiKeyValid = true;
  } catch (err) {
    out.errors.push(`OpenSea API key: HTTP ${err.response?.status} — ${err.response?.data?.detail || err.message}`);
  }

  out.ready = out.rpcConnected && out.apiKeyValid && parseFloat(out.ethBalanceEth || 0) > 0;
  return out;
}

module.exports = { buyNFT, placeBid, sellNFT, cancelOrder, getDiagnostics };
