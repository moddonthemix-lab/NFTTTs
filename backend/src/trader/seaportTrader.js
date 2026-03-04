const { ethers } = require('ethers');
const axios = require('axios');
const walletUtils = require('../utils/wallet');
const config = require('../config');
const logger = require('../utils/logger');

const TX_CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

// Seaport v1.6 is deployed at the same address on all supported chains (CREATE2)
const SEAPORT_ADDRESS = '0x0000000000000068F116a894984e2DB1123eB395';
// OpenSea conduit — Seaport pulls tokens through this, not directly.
// WETH approval must target the conduit, not Seaport itself.
const OS_CONDUIT_ADDRESS = '0x1E0049783F008A0085193E00003D00cd54003c71';

// Per-chain config
const CHAIN_CONFIG = {
  ethereum: {
    chainId: 1,
    seaportAddress: SEAPORT_ADDRESS,
    conduitAddress: OS_CONDUIT_ADDRESS,
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  base: {
    chainId: 8453,
    seaportAddress: SEAPORT_ADDRESS,
    conduitAddress: OS_CONDUIT_ADDRESS,
    wethAddress: '0x4200000000000000000000000000000000000006',
  },
};

function chainCfg(chain) {
  return CHAIN_CONFIG[chain] || CHAIN_CONFIG.ethereum;
}

function seaportDomain(chain) {
  const cfg = chainCfg(chain);
  return { name: 'Seaport', version: '1.6', chainId: cfg.chainId, verifyingContract: cfg.seaportAddress };
}

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

// Wraps axios so 4xx/5xx errors include the actual OpenSea response body.
async function osPost(url, data, cfg) {
  try {
    return await axios.post(url, data, cfg);
  } catch (err) {
    if (err.response) {
      const body = JSON.stringify(err.response.data);
      throw new Error(`OpenSea ${err.response.status} from ${url.split('/').pop()}: ${body}`);
    }
    throw err;
  }
}

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

async function ensureWETH(wallet, amountWei, chain = 'ethereum') {
  const { wethAddress } = chainCfg(chain);
  const weth = new ethers.Contract(wethAddress, WETH_ABI, wallet);
  const wethBalance = await weth.balanceOf(wallet.address);
  if (wethBalance >= amountWei) {
    logger.info(`WETH OK: ${ethers.formatEther(wethBalance)} available`);
    return;
  }

  const needed = amountWei - wethBalance;
  const ethBalance = await wallet.provider.getBalance(wallet.address);
  if (ethBalance < needed) {
    throw new Error(
      `Insufficient ETH on ${chain} to wrap into WETH.\n` +
      `  Wallet:       ${wallet.address}\n` +
      `  ETH balance:  ${ethers.formatEther(ethBalance)} ETH\n` +
      `  WETH balance: ${ethers.formatEther(wethBalance)} WETH\n` +
      `  Need to wrap: ${ethers.formatEther(needed)} ETH\n` +
      `  → Bridge or deposit ETH to this wallet on ${chain} first.`
    );
  }

  logger.info(`[${chain}] Wrapping ${ethers.formatEther(needed)} ETH -> WETH`);
  const tx = await weth.deposit({ value: needed });
  await waitForConfirmation(tx);
  logger.info('WETH wrap confirmed');
}

async function approveWETH(wallet, amountWei, chain = 'ethereum') {
  const { wethAddress, conduitAddress } = chainCfg(chain);
  const weth = new ethers.Contract(wethAddress, WETH_ABI, wallet);
  const allowance = await weth.allowance(wallet.address, conduitAddress);
  if (allowance < amountWei) {
    logger.info(`[${chain}] Approving OpenSea conduit to spend WETH (one-time gas cost)...`);
    const tx = await weth.approve(conduitAddress, ethers.MaxUint256);
    await waitForConfirmation(tx);
    logger.info('Conduit WETH approval confirmed');
  } else {
    logger.info('Conduit WETH allowance already sufficient');
  }
}

// ─── Buy ─────────────────────────────────────────────────────────────────────

async function buyNFT(listing) {
  const chain = listing.chain || 'ethereum';
  const wallet = walletUtils.getWalletForChain(chain);
  if (!wallet) throw new Error('No wallet connected. Import a wallet first.');

  logger.info(`[${chain}] Buying NFT: order ${listing.order_hash}`);

  const res = await axios.post(
    `${config.opensea.apiBase}/listings/fulfillment_data`,
    {
      listing: {
        hash: listing.order_hash,
        chain,
        protocol_address: chainCfg(chain).seaportAddress,
      },
      fulfiller: { address: wallet.address },
    },
    { headers: osHeaders() }
  );

  const txParams = res.data?.fulfillment_data?.transaction;
  if (!txParams) {
    throw new Error(`OpenSea did not return fulfillment tx. Response: ${JSON.stringify(res.data)}`);
  }

  logger.info(`Fulfillment tx: to=${txParams.to}, value=${txParams.value}, gas=${txParams.gas}`);

  // OpenSea sometimes returns decoded parameters instead of raw hex calldata.
  // When input_data is an object we must ABI-encode it as fulfillBasicOrder ourselves.
  let calldata;
  if (typeof txParams.input_data === 'string') {
    calldata = txParams.input_data;
  } else if (txParams.input_data?.parameters) {
    const iface = new ethers.Interface([
      'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) payable returns (bool)',
    ]);
    calldata = iface.encodeFunctionData('fulfillBasicOrder', [txParams.input_data.parameters]);
    logger.info('Encoded fulfillBasicOrder calldata from decoded parameters');
  } else {
    throw new Error(`Unsupported input_data format: ${JSON.stringify(txParams.input_data).slice(0, 200)}`);
  }

  const tx = await wallet.sendTransaction({
    to: txParams.to,
    data: calldata,
    value: BigInt(txParams.value || '0'),
    gasLimit: BigInt(txParams.gas || '300000'),
  });

  logger.info(`Buy TX sent: ${tx.hash}`);
  const receipt = await waitForConfirmation(tx);
  logger.info(`Buy confirmed: ${receipt.hash} (block ${receipt.blockNumber})`);

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
}

// ─── Bid (collection offer) ───────────────────────────────────────────────────

// OpenSea conduit key — same on all chains
const OS_CONDUIT_KEY    = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000';
// OpenSea protocol fee recipient — same on all chains (100 bps = 1%)
const OS_FEE_RECIPIENT  = '0x0000a26b00c1F0DF003000390027140000fAa719';
const OS_FEE_BASIS_PTS  = 100n; // 1%

const SEAPORT_ABI = [
  'function getCounter(address offerer) view returns (uint256)',
];

/**
 * Place a collection offer on OpenSea using Seaport v1.6.
 *
 * Flow:
 *  1. Wrap ETH -> WETH if balance insufficient (on-chain, costs gas)
 *  2. Approve Seaport to spend WETH — one-time per wallet (on-chain, costs gas)
 *  3. POST /offers/build  -> OpenSea returns partialParameters (zone, zoneHash,
 *     consideration criteria) + encodedTokenIds
 *  4. Fetch offerer counter from Seaport contract (view call, no gas)
 *  5. Assemble full Seaport OrderComponents and sign with EIP-712
 *  6. POST /offers with signed order -> bid is live on OpenSea
 */
async function placeBid(collectionSlug, offerAmountEth, expirationHours = 24, chain = 'ethereum') {
  const wallet = walletUtils.getWalletForChain(chain);
  if (!wallet) throw new Error('No wallet connected.');

  const { wethAddress, seaportAddress } = chainCfg(chain);
  logger.info(`[${chain}] Placing bid: ${collectionSlug} @ ${offerAmountEth} ETH (${expirationHours}h)`);

  const offerAmountWei = ethers.parseEther(offerAmountEth.toString());

  await ensureWETH(wallet, offerAmountWei, chain);
  await approveWETH(wallet, offerAmountWei, chain);

  const now        = Math.floor(Date.now() / 1000);
  const expiration = now + expirationHours * 3600;

  // Step 1: ask OpenSea for the zone / criteria consideration for this collection
  logger.info('Calling /offers/build...');
  const buildRes = await osPost(
    `${config.opensea.apiBase}/offers/build`,
    {
      criteria:         { collection: { slug: collectionSlug } },
      protocol_address: seaportAddress,
      quantity:         1,
      offer_protected:  false,
      offerer:          wallet.address,
    },
    { headers: osHeaders() }
  );

  // OpenSea v2 returns { partialParameters: { zone, zoneHash, consideration }, encodedTokenIds }
  const partial = buildRes.data?.partialParameters;
  if (!partial?.zone || !Array.isArray(partial?.consideration)) {
    throw new Error(`/offers/build unexpected response: ${JSON.stringify(buildRes.data)}`);
  }
  const encodedTokenIds = buildRes.data?.encodedTokenIds ?? '';
  logger.info(`Got partial params: zone=${partial.zone}, ${partial.consideration.length} consideration item(s)`);

  // Step 2: fetch offerer's current Seaport counter (needed for EIP-712 signature)
  const seaport = new ethers.Contract(seaportAddress, SEAPORT_ABI, wallet.provider);
  const counter = await seaport.getCounter(wallet.address);
  logger.info(`Seaport counter: ${counter}`);

  // Step 3: assemble the full Seaport OrderComponents
  const salt    = ethers.toBigInt(ethers.randomBytes(32)).toString();
  // Fetch all required fees for this collection (OS protocol fee + creator royalties)
  let rawFees = [];
  try {
    const feeRes = await axios.get(
      `${config.opensea.apiBase}/collections/${collectionSlug}`,
      { headers: osHeaders() }
    );
    rawFees = feeRes.data?.fees ?? [];
  } catch (e) {
    logger.warn(`Could not fetch collection fees, using OS default: ${e.message}`);
    rawFees = [{ fee: 1, recipient: OS_FEE_RECIPIENT, required: true }];  // 1% fallback
  }

  const feeItems = rawFees
    .filter(f => f.required)
    .map(f => {
      // OpenSea's fee field is a PERCENTAGE (e.g. 1 = 1%, 2.5 = 2.5%), not basis points.
      // Convert: multiply by 100 to get bps, then divide by 10000.
      const bps    = Math.round(f.fee * 100);
      const feeAmt = (offerAmountWei * BigInt(bps) / 10000n).toString();
      return {
        itemType:             1,
        token:                wethAddress,
        identifierOrCriteria: '0',
        startAmount:          feeAmt,
        endAmount:            feeAmt,
        recipient:            f.recipient,
      };
    });

  logger.info(`Fees: ${feeItems.map(f => `${f.recipient.slice(0,8)}… ${(Number(f.startAmount)/1e18).toFixed(6)} WETH`).join(', ')}`);

  const consideration = [...partial.consideration, ...feeItems];
  const params = {
    offerer:    wallet.address,
    zone:       partial.zone,
    offer: [
      {
        itemType:             1,   // ERC20
        token:                wethAddress,
        identifierOrCriteria: '0',
        startAmount:          offerAmountWei.toString(),
        endAmount:            offerAmountWei.toString(),
      },
    ],
    consideration,
    orderType:                        2,   // FULL_RESTRICTED
    startTime:                        now.toString(),
    endTime:                          expiration.toString(),
    zoneHash:                         partial.zoneHash,
    salt,
    conduitKey:                       OS_CONDUIT_KEY,
    totalOriginalConsiderationItems:  consideration.length,
    counter:                          counter.toString(),
  };

  logger.info(`Signing: ${ethers.formatEther(offerAmountWei)} WETH, counter=${counter}, endTime=${expiration}`);

  const signature = await wallet.signTypedData(seaportDomain(chain), SEAPORT_ORDER_TYPES, params);
  logger.info(`Signed: ${signature.slice(0, 22)}...`);

  // Step 4: submit to OpenSea
  logger.info('Submitting to /offers...');
  const submitRes = await osPost(
    `${config.opensea.apiBase}/offers`,
    {
      criteria:          { collection: { slug: collectionSlug } },
      encoded_token_ids: encodedTokenIds,
      protocol_address:  seaportAddress,
      protocol_data:     { parameters: params, signature },
    },
    { headers: osHeaders() }
  );

  if (submitRes.data?.errors?.length) {
    throw new Error(`OpenSea rejected offer: ${JSON.stringify(submitRes.data.errors)}`);
  }

  const orderHash = submitRes.data?.order_hash || submitRes.data?.order?.order_hash;
  logger.info(`Bid live on ${collectionSlug}: order ${orderHash}`);

  return { orderHash, collectionSlug, offerAmountEth, expirationHours, chain };
}

// ─── Sell (create listing) ────────────────────────────────────────────────────

async function sellNFT(contractAddress, tokenId, priceEth, expirationHours = 72, chain = 'ethereum') {
  const wallet = walletUtils.getWalletForChain(chain);
  if (!wallet) throw new Error('No wallet connected.');

  const { seaportAddress } = chainCfg(chain);
  logger.info(`[${chain}] Listing ${contractAddress}/${tokenId} for ${priceEth} ETH`);

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
    protocol_address: seaportAddress,
  };

  const buildRes = await axios.post(
    `${config.opensea.apiBase}/listings/build`,
    buildPayload,
    { headers: osHeaders() }
  );

  if (!buildRes.data) throw new Error('Empty response from /listings/build');
  const orderData = buildRes.data;

  // OpenSea may return ready-made EIP-712 fields or just parameters — handle both
  const domain      = orderData.domain   || seaportDomain(chain);
  const orderParams = orderData.value    || orderData.parameters || orderData;
  const rawTypes    = orderData.types    || SEAPORT_ORDER_TYPES;
  // ethers v6 handles domain separately — strip EIP712Domain if present in types
  const types = Object.fromEntries(Object.entries(rawTypes).filter(([k]) => k !== 'EIP712Domain'));

  const signature = await wallet.signTypedData(domain, types, orderParams);

  const submitRes = await axios.post(
    `${config.opensea.apiBase}/listings`,
    {
      parameters: orderData.parameters || orderParams,
      protocol_address: seaportAddress,
      signature,
    },
    { headers: osHeaders() }
  );

  const orderHash = submitRes.data?.order_hash;
  logger.info(`Listed token ${tokenId}: order ${orderHash}`);

  return { orderHash, contractAddress, tokenId, priceEth };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

async function cancelOrder(orderHash, chain = 'ethereum') {
  const wallet = walletUtils.getWalletForChain(chain);
  if (!wallet) throw new Error('No wallet connected.');

  const res = await axios.post(
    `${config.opensea.apiBase}/orders/chain/${chain}/seaport/${orderHash}/cancel`,
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
    baseBalanceEth: null,
    baseWethBalanceEth: null,
    baseSeaportAllowance: null,
    baseRpcConfigured: !!config.wallet.baseRpcUrl,
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

  const MIN_ETH_FOR_GAS = 0.001;
  const { wethAddress: ethWeth, seaportAddress } = chainCfg('ethereum');

  try {
    const ethBal = await wallet.provider.getBalance(wallet.address);
    out.ethBalanceEth = parseFloat(ethers.formatEther(ethBal)).toFixed(6);
    out.rpcConnected = true;

    if (parseFloat(out.ethBalanceEth) < MIN_ETH_FOR_GAS) {
      out.errors.push(
        `ETH balance too low (${out.ethBalanceEth} ETH). Need at least ${MIN_ETH_FOR_GAS} ETH for gas. Add ETH to ${wallet.address}`
      );
    }

    const weth = new ethers.Contract(ethWeth, WETH_ABI, wallet.provider);
    const wethBal = await weth.balanceOf(wallet.address);
    out.wethBalanceEth = parseFloat(ethers.formatEther(wethBal)).toFixed(6);

    const allowance = await weth.allowance(wallet.address, seaportAddress);
    out.seaportAllowance = allowance >= ethers.parseEther('1000')
      ? 'unlimited'
      : `${parseFloat(ethers.formatEther(allowance)).toFixed(4)} WETH`;
  } catch (err) {
    out.errors.push(`RPC error (check ETH_RPC_URL): ${err.message}`);
  }

  // Base chain diagnostics (only if BASE_RPC_URL is configured)
  if (config.wallet.baseRpcUrl) {
    try {
      const baseWallet = walletUtils.getWalletForChain('base');
      const { wethAddress: baseWeth } = chainCfg('base');
      const baseBal = await baseWallet.provider.getBalance(wallet.address);
      out.baseBalanceEth = parseFloat(ethers.formatEther(baseBal)).toFixed(6);
      const bweth = new ethers.Contract(baseWeth, WETH_ABI, baseWallet.provider);
      const bwethBal = await bweth.balanceOf(wallet.address);
      out.baseWethBalanceEth = parseFloat(ethers.formatEther(bwethBal)).toFixed(6);
      const bAllowance = await bweth.allowance(wallet.address, seaportAddress);
      out.baseSeaportAllowance = bAllowance >= ethers.parseEther('1000')
        ? 'unlimited'
        : `${parseFloat(ethers.formatEther(bAllowance)).toFixed(4)} WETH`;
    } catch (err) {
      out.errors.push(`Base RPC error (check BASE_RPC_URL): ${err.message}`);
    }
  }

  try {
    await axios.get(`${config.opensea.apiBase}/collections?limit=1`, { headers: { 'X-API-KEY': config.opensea.apiKey } });
    out.apiKeyValid = true;
  } catch (err) {
    out.errors.push(`OpenSea API key: HTTP ${err.response?.status} — ${err.response?.data?.detail || err.message}`);
  }

  out.ready = out.rpcConnected && out.apiKeyValid && parseFloat(out.ethBalanceEth || 0) >= MIN_ETH_FOR_GAS && out.errors.length === 0;
  return out;
}

const ERC721_ABI = [
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved) external',
];

/**
 * Accept the best existing offer on a specific NFT.
 * This sells the NFT immediately for WETH to whoever placed the highest offer.
 */
async function acceptBestOffer(contractAddress, tokenId, collectionSlug, chain = 'ethereum') {
  const wallet = walletUtils.getWalletForChain(chain);
  if (!wallet) throw new Error('No wallet connected.');

  const { seaportAddress, conduitAddress } = chainCfg(chain);
  logger.info(`[${chain}] Accepting best offer for ${contractAddress}/${tokenId}`);

  // Step 1: fetch the best offer for this specific token
  const offerRes = await axios.get(
    `${config.opensea.apiBase}/offers/collection/${collectionSlug}/nfts/${tokenId}/best`,
    { headers: osHeaders() }
  );
  const offer = offerRes.data?.offers?.[0];
  if (!offer) throw new Error('No offers found for this NFT on OpenSea');

  const offerPriceEth = parseFloat(ethers.formatEther(offer.current_price || '0'));
  logger.info(`Best offer: ${offerPriceEth} ETH (order ${offer.order_hash})`);

  // Step 2: ensure conduit is approved to transfer our NFT
  const erc721 = new ethers.Contract(contractAddress, ERC721_ABI, wallet);
  const isApproved = await erc721.isApprovedForAll(wallet.address, conduitAddress);
  if (!isApproved) {
    logger.info(`Approving OpenSea conduit to transfer NFTs from ${contractAddress}...`);
    const approveTx = await erc721.setApprovalForAll(conduitAddress, true);
    await waitForConfirmation(approveTx);
    logger.info('NFT conduit approval confirmed');
  }

  // Step 3: get fulfillment transaction from OpenSea
  const fulfillRes = await osPost(
    `${config.opensea.apiBase}/offers/fulfillment_data`,
    {
      offer: {
        hash: offer.order_hash,
        chain,
        protocol_address: seaportAddress,
      },
      fulfiller: { address: wallet.address },
    },
    { headers: osHeaders() }
  );

  const txParams = fulfillRes.data?.fulfillment_data?.transaction;
  if (!txParams) throw new Error(`OpenSea did not return fulfillment tx: ${JSON.stringify(fulfillRes.data)}`);

  // Step 4: send the transaction (same encoding pattern as buyNFT)
  let calldata;
  if (typeof txParams.input_data === 'string') {
    calldata = txParams.input_data;
  } else if (txParams.input_data?.parameters) {
    const iface = new ethers.Interface([
      'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) payable returns (bool)',
    ]);
    calldata = iface.encodeFunctionData('fulfillBasicOrder', [txParams.input_data.parameters]);
  } else {
    throw new Error(`Unsupported input_data format: ${JSON.stringify(txParams.input_data).slice(0, 200)}`);
  }

  const tx = await wallet.sendTransaction({
    to: txParams.to,
    data: calldata,
    value: BigInt(txParams.value || '0'),
    gasLimit: BigInt(txParams.gas || '300000'),
  });

  logger.info(`Accept-offer TX sent: ${tx.hash}`);
  const receipt = await waitForConfirmation(tx);
  logger.info(`Accept-offer confirmed: ${receipt.hash} (block ${receipt.blockNumber})`);

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, offerPriceEth };
}

module.exports = { buyNFT, placeBid, sellNFT, acceptBestOffer, cancelOrder, getDiagnostics };
