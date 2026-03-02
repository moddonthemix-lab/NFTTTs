const { ethers } = require('ethers');
const axios = require('axios');
const walletUtils = require('../utils/wallet');
const config = require('../config');
const logger = require('../utils/logger');

// Seaport v1.6 contract address (mainnet)
const SEAPORT_ADDRESS = '0x0000000000000068F116a894984e2DB1123eB395';

// WETH address on mainnet (used for bidding)
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

const WETH_ABI = [
  'function deposit() external payable',
  'function withdraw(uint256 wad) external',
  'function approve(address guy, uint256 wad) external returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
];

/**
 * Fulfill a buy-now listing from OpenSea using Seaport.
 * The listing object comes directly from the OpenSea API.
 */
async function buyNFT(listing) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected. Import a wallet first.');

  logger.info(`Attempting to buy NFT: ${listing.order_hash}`);

  // Fetch fulfillment data from OpenSea
  const fulfillData = await getFulfillmentData(listing, wallet.address);

  const txParams = fulfillData.fulfillment_data?.transaction;
  if (!txParams) throw new Error('OpenSea did not return fulfillment transaction data');

  const tx = await wallet.sendTransaction({
    to: txParams.to,
    data: txParams.input_data,
    value: BigInt(txParams.value || '0'),
    gasLimit: BigInt(txParams.gas || '300000'),
  });

  logger.info(`Buy TX sent: ${tx.hash}`);
  const receipt = await tx.wait();
  logger.info(`Buy TX confirmed: ${receipt.hash} (block ${receipt.blockNumber})`);

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Create a collection offer (bid) via OpenSea API using WETH
 */
async function placeBid(collectionSlug, offerAmountEth, expirationHours = 24) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected.');

  logger.info(`Placing bid on ${collectionSlug} for ${offerAmountEth} ETH`);

  const offerAmountWei = ethers.parseEther(offerAmountEth.toString());

  // Ensure we have enough WETH
  await ensureWETH(wallet, offerAmountWei);

  // Approve Seaport to use WETH if needed
  await approveWETH(wallet, offerAmountWei);

  // Build offer payload for OpenSea API
  const expiration = Math.floor(Date.now() / 1000) + expirationHours * 3600;

  const payload = {
    criteria: {
      collection: { slug: collectionSlug },
    },
    protocol_address: SEAPORT_ADDRESS,
    quantity: 1,
    offer_protected: false,
    offerer: wallet.address,
    consideration: [
      {
        item_type: 1, // ERC20
        token: WETH_ADDRESS,
        identifier_or_criteria: '0',
        start_amount: offerAmountWei.toString(),
        end_amount: offerAmountWei.toString(),
        recipient: wallet.address,
      },
    ],
    expiration_time: expiration.toString(),
  };

  // Get offer to sign from OpenSea
  const buildRes = await axios.post(
    `${config.opensea.apiBase}/offers/build`,
    payload,
    { headers: { 'X-API-KEY': config.opensea.apiKey } }
  );

  const partialOrder = buildRes.data?.partial_order;
  if (!partialOrder) throw new Error('Failed to build offer from OpenSea');

  // Sign the order
  const domain = partialOrder.parameters?.zone
    ? {
        name: 'Seaport',
        version: '1.6',
        chainId: 1,
        verifyingContract: SEAPORT_ADDRESS,
      }
    : { name: 'Seaport', version: '1.6', chainId: 1, verifyingContract: SEAPORT_ADDRESS };

  const signature = await wallet.signTypedData(
    domain,
    partialOrder.types,
    partialOrder.value
  );

  // Submit signed offer to OpenSea
  const submitRes = await axios.post(
    `${config.opensea.apiBase}/offers`,
    { ...buildRes.data, signature },
    { headers: { 'X-API-KEY': config.opensea.apiKey } }
  );

  const orderId = submitRes.data?.order_hash || submitRes.data?.order?.order_hash;
  logger.info(`Bid placed on ${collectionSlug}: order ${orderId}`);

  return {
    orderHash: orderId,
    collectionSlug,
    offerAmountEth,
    expirationHours,
  };
}

/**
 * Create a listing to sell an NFT at a given price
 */
async function sellNFT(contractAddress, tokenId, priceEth, expirationHours = 72) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected.');

  logger.info(`Listing NFT ${contractAddress}/${tokenId} for ${priceEth} ETH`);

  const priceWei = ethers.parseEther(priceEth.toString());
  const expiration = Math.floor(Date.now() / 1000) + expirationHours * 3600;

  // Build listing payload
  const payload = {
    parameters: {
      offerer: wallet.address,
      offer: [
        {
          itemType: 2, // ERC721
          token: contractAddress,
          identifierOrCriteria: tokenId.toString(),
          startAmount: '1',
          endAmount: '1',
        },
      ],
      consideration: [
        {
          itemType: 0, // ETH
          token: ethers.ZeroAddress,
          identifierOrCriteria: '0',
          startAmount: priceWei.toString(),
          endAmount: priceWei.toString(),
          recipient: wallet.address,
        },
      ],
      startTime: Math.floor(Date.now() / 1000).toString(),
      endTime: expiration.toString(),
      orderType: 0, // FULL_OPEN
      zone: ethers.ZeroAddress,
      zoneHash: ethers.ZeroHash,
      salt: ethers.hexlify(ethers.randomBytes(32)),
      conduitKey: ethers.ZeroHash,
      totalOriginalConsiderationItems: '1',
    },
    protocol_address: SEAPORT_ADDRESS,
  };

  // Build via OpenSea
  const buildRes = await axios.post(
    `${config.opensea.apiBase}/listings/build`,
    payload,
    { headers: { 'X-API-KEY': config.opensea.apiKey } }
  );

  if (!buildRes.data) throw new Error('Failed to build listing');

  const orderData = buildRes.data;

  // Sign
  const signature = await wallet.signTypedData(
    orderData.domain,
    orderData.types,
    orderData.value
  );

  // Submit listing
  const submitRes = await axios.post(
    `${config.opensea.apiBase}/listings`,
    { ...orderData, signature },
    { headers: { 'X-API-KEY': config.opensea.apiKey } }
  );

  const orderHash = submitRes.data?.order_hash;
  logger.info(`Listed NFT ${tokenId} for sale: order ${orderHash}`);

  return { orderHash, contractAddress, tokenId, priceEth };
}

/**
 * Cancel an order (bid or listing)
 */
async function cancelOrder(orderHash) {
  const wallet = walletUtils.getWallet();
  if (!wallet) throw new Error('No wallet connected.');

  const res = await axios.post(
    `${config.opensea.apiBase}/orders/chain/ethereum/seaport/${orderHash}/cancel`,
    {},
    { headers: { 'X-API-KEY': config.opensea.apiKey, 'Content-Type': 'application/json' } }
  );

  logger.info(`Order ${orderHash} cancellation requested`);
  return res.data;
}

// ------- Helpers -------

async function getFulfillmentData(listing, fulfillerAddress) {
  const res = await axios.post(
    `${config.opensea.apiBase}/listings/fulfillment_data`,
    {
      listing: {
        hash: listing.order_hash,
        chain: 'ethereum',
        protocol_address: SEAPORT_ADDRESS,
      },
      fulfiller: { address: fulfillerAddress },
    },
    { headers: { 'X-API-KEY': config.opensea.apiKey } }
  );
  return res.data;
}

async function ensureWETH(wallet, amountWei) {
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
  const balance = await weth.balanceOf(wallet.address);
  if (balance < amountWei) {
    const needed = amountWei - balance;
    logger.info(`Wrapping ${ethers.formatEther(needed)} ETH to WETH for bid`);
    const tx = await weth.deposit({ value: needed });
    await tx.wait();
    logger.info('WETH wrap confirmed');
  }
}

async function approveWETH(wallet, amountWei) {
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);
  const allowance = await weth.allowance(wallet.address, SEAPORT_ADDRESS);
  if (allowance < amountWei) {
    logger.info('Approving WETH for Seaport...');
    const tx = await weth.approve(SEAPORT_ADDRESS, ethers.MaxUint256);
    await tx.wait();
    logger.info('WETH approved for Seaport');
  }
}

module.exports = { buyNFT, placeBid, sellNFT, cancelOrder };
