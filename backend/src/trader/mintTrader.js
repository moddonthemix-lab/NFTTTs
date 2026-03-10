const { ethers } = require('ethers');
const walletUtils = require('../utils/wallet');
const logger = require('../utils/logger');

// Try these mint signatures in order — covers the vast majority of real contracts
const MINT_SIGNATURES = [
  // ── Standard ERC721 patterns ──────────────────────────────────────────────
  { fn: 'function mint(uint256 quantity) payable',                  args: (qty, addr) => [BigInt(qty)] },
  { fn: 'function mint(uint256 amount) payable',                    args: (qty, addr) => [BigInt(qty)] },
  { fn: 'function publicMint(uint256 quantity) payable',            args: (qty, addr) => [BigInt(qty)] },
  { fn: 'function mintPublic(uint256 quantity) payable',            args: (qty, addr) => [BigInt(qty)] },
  { fn: 'function mint(address to, uint256 quantity) payable',      args: (qty, addr) => [addr, BigInt(qty)] },
  { fn: 'function mint(address to, uint256 amount) payable',        args: (qty, addr) => [addr, BigInt(qty)] },
  { fn: 'function safeMint(address to, uint256 quantity) payable',  args: (qty, addr) => [addr, BigInt(qty)] },
  { fn: 'function safeMint(address to) payable',                    args: (qty, addr) => [addr] },
  { fn: 'function mint() payable',                                  args: () => [] },
  { fn: 'function freeMint(uint256 quantity)',                       args: (qty) => [BigInt(qty)] },
  { fn: 'function freeMint()',                                       args: () => [] },

  // ── Claim / allowlist patterns (no proof — public phase) ─────────────────
  { fn: 'function claim(uint256 quantity) payable',                 args: (qty) => [BigInt(qty)] },
  { fn: 'function claim(uint256 amount) payable',                   args: (qty) => [BigInt(qty)] },
  { fn: 'function publicClaim(uint256 quantity) payable',           args: (qty) => [BigInt(qty)] },
  { fn: 'function claimPublic(uint256 quantity) payable',           args: (qty) => [BigInt(qty)] },

  // ── Thirdweb ERC721Drop — public phase (no allowlist proof) ──────────────
  // claim(address receiver, uint256 quantity, address currency, uint256 pricePerToken, (bytes32[],uint256,uint256,address) allowlistProof, bytes data)
  {
    fn: 'function claim(address _receiver, uint256 _quantity, address _currency, uint256 _pricePerToken, (bytes32[] proof, uint256 quantityLimitPerWallet, uint256 pricePerToken, address currency) _allowlistProof, bytes _data) payable',
    args: (qty, addr, priceWei) => [
      addr,
      BigInt(qty),
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH sentinel
      priceWei,
      { proof: [], quantityLimitPerWallet: BigInt(0), pricePerToken: BigInt(2) ** BigInt(256) - BigInt(1), currency: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
      '0x',
    ],
  },

  // ── Manifold ERC721 / ERC1155 public mint ────────────────────────────────
  { fn: 'function mint(uint256 instanceId, uint32 mintCount) payable', args: (qty) => [BigInt(0), qty] },
  { fn: 'function mintBatch(address to, uint16 count) payable',        args: (qty, addr) => [addr, qty] },

  // ── Zora minter (fixed price) ─────────────────────────────────────────────
  // mintWithRewards(address minter, uint256 tokenId, uint256 quantity, bytes minterArgs, address mintReferral)
  {
    fn: 'function mintWithRewards(address minter, uint256 tokenId, uint256 quantity, bytes minterArguments, address mintReferral) payable',
    args: (qty, addr) => [addr, BigInt(0), BigInt(qty), '0x', '0x0000000000000000000000000000000000000000'],
  },

  // ── Generic fallbacks ─────────────────────────────────────────────────────
  { fn: 'function purchase(uint256 quantity) payable',               args: (qty) => [BigInt(qty)] },
  { fn: 'function buy(uint256 quantity) payable',                    args: (qty) => [BigInt(qty)] },
];

/**
 * Attempt to mint NFTs from a contract.
 * Tries common mint signatures in order until one succeeds.
 *
 * @param {string} contractAddress  - NFT contract to mint from
 * @param {number} quantity         - Number of NFTs to mint (default 1)
 * @param {number} pricePerNftEth   - ETH price per mint (default 0 for free mints)
 * @param {string} chain            - 'ethereum' or 'base'
 * @param {string} customCalldata   - Raw hex calldata override (optional)
 */
async function mintNFT(contractAddress, quantity = 1, pricePerNftEth = 0, chain = 'ethereum', customCalldata = null) {
  const wallet = walletUtils.getWalletForChain(chain);
  if (!wallet) throw new Error('No wallet connected');

  const totalEth = pricePerNftEth * quantity;
  const valueWei = ethers.parseEther(totalEth.toFixed(18));
  const priceWei = ethers.parseEther(pricePerNftEth.toFixed(18));
  logger.info(`[mint][${chain}] Attempting to mint ${quantity}x from ${contractAddress} (${pricePerNftEth} ETH each, total ${totalEth.toFixed(6)} ETH)`);

  // Custom calldata path — user knows exactly what to call
  if (customCalldata) {
    if (!/^0x[0-9a-fA-F]*$/.test(customCalldata)) throw new Error('Custom calldata must be a hex string starting with 0x');
    const tx = await wallet.sendTransaction({ to: contractAddress, data: customCalldata, value: valueWei });
    logger.info(`[mint] Custom calldata tx sent: ${tx.hash}`);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, contractAddress, quantity, pricePerNftEth, chain };
  }

  // Try each known signature
  let lastErr = null;
  for (const { fn, args } of MINT_SIGNATURES) {
    try {
      const contract = new ethers.Contract(contractAddress, [fn], wallet);
      const fnName = fn.match(/function (\w+)/)[1];
      const callArgs = args(quantity, wallet.address, priceWei);
      logger.info(`[mint] Trying ${fnName}(${callArgs.map(a => typeof a === 'object' && a !== null && !Array.isArray(a) ? '[struct]' : String(a)).join(', ')})`);
      const tx = await contract[fnName](...callArgs, { value: valueWei });
      logger.info(`[mint] TX sent: ${tx.hash} — waiting for confirmation...`);
      const receipt = await tx.wait();
      logger.info(`[mint] Confirmed in block ${receipt.blockNumber}`);
      return { txHash: receipt.hash, contractAddress, quantity, pricePerNftEth, chain };
    } catch (err) {
      // Hard stop: user rejected or contract reverted with a reason — don't try other sigs
      if (err.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user');
      if (err.code === 'CALL_EXCEPTION' && err.reason) {
        throw new Error(`Mint reverted: ${err.reason}`);
      }
      // Otherwise this signature isn't right — try the next
      lastErr = err;
      logger.debug(`[mint] ${fn} failed (trying next): ${err.message?.slice(0, 80)}`);
    }
  }

  throw new Error(
    `No compatible mint function found on ${contractAddress}. ` +
    `Try providing the contract's calldata directly. Last error: ${lastErr?.message?.slice(0, 120)}`
  );
}

const ERC721_ABI = [
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
];
const ERC1155_ABI = [
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
];
const ERC1155_INTERFACE = '0xd9b67a26';

/**
 * Transfer an NFT (ERC-721 or ERC-1155) from the configured wallet to a recipient.
 *
 * @param {string} contractAddress  - NFT contract
 * @param {string} tokenId          - Token ID (string or number)
 * @param {string} toAddress        - Recipient wallet address
 * @param {string} chain            - 'ethereum' | 'base'
 * @returns {{ txHash: string, contractAddress, tokenId, to: string }}
 */
async function sendNFT(contractAddress, tokenId, toAddress, chain = 'ethereum') {
  const wallet = walletUtils.getWalletForChain(chain);
  if (!wallet) throw new Error('No wallet connected');
  if (!ethers.isAddress(toAddress)) throw new Error('Invalid recipient address');

  // Detect ERC-1155 vs ERC-721
  let is1155 = false;
  try {
    const probe = new ethers.Contract(contractAddress, ERC721_ABI, wallet);
    is1155 = await probe.supportsInterface(ERC1155_INTERFACE).catch(() => false);
  } catch { /* assume 721 */ }

  let tx;
  if (is1155) {
    const contract = new ethers.Contract(contractAddress, ERC1155_ABI, wallet);
    tx = await contract.safeTransferFrom(wallet.address, toAddress, BigInt(tokenId), 1n, '0x');
  } else {
    const contract = new ethers.Contract(contractAddress, ERC721_ABI, wallet);
    tx = await contract.safeTransferFrom(wallet.address, toAddress, BigInt(tokenId));
  }
  await tx.wait(1);
  logger.info(`[send] Sent token ${tokenId} from ${contractAddress} to ${toAddress} — tx ${tx.hash}`);
  return { txHash: tx.hash, contractAddress, tokenId, to: toAddress };
}

module.exports = { mintNFT, sendNFT };
