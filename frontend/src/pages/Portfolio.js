import React, { useState, useCallback } from 'react';
import { tradesApi, scannerApi, portfolioApi } from '../utils/api';
import { format } from 'date-fns';

const fmt = (n, d = 4) => (n != null ? Number(n).toFixed(d) : '—');

export default function Portfolio({ portfolio, setPortfolio, ethPrice }) {
  const [action, setAction] = useState({});  // { [k]: 'list'|'offer' }
  const [listPrice, setListPrice] = useState({});
  const [busy, setBusy] = useState({});
  const [bestOffers, setBestOffers] = useState({});  // { [k]: { priceEth, loading } }
  const [fees, setFees] = useState({});              // { [k]: { marketplaceFee, royaltyFee, loading } }
  const [syncing, setSyncing] = useState(false);

  const fmtUsd = (eth) => {
    if (!ethPrice || eth == null) return null;
    const usd = eth * ethPrice;
    return usd >= 1000 ? `$${Math.round(usd).toLocaleString()}` : `$${usd.toFixed(2)}`;
  };

  const handleSync = async (chain = 'ethereum') => {
    setSyncing(true);
    try {
      const { added, portfolio: updated } = await portfolioApi.sync(chain);
      if (setPortfolio) setPortfolio(updated);
      alert(added > 0 ? `Synced ${added} new NFT${added !== 1 ? 's' : ''} from wallet.` : 'Wallet synced — no new NFTs found.');
    } catch (err) {
      alert(`Sync failed: ${err.response?.data?.error || err.message}`);
    }
    setSyncing(false);
  };

  // Unique key per card — use contract+token when available, else index-based
  const cardKey = (nft, i) =>
    nft.contractAddress && nft.tokenId
      ? `${nft.contractAddress}-${nft.tokenId}`
      : `idx-${i}`;

  const fetchBestOffer = useCallback(async (k, nft) => {
    if (!nft.contractAddress || !nft.tokenId || !nft.collectionSlug) {
      setBestOffers((p) => ({ ...p, [k]: { priceEth: null, loading: false } }));
      return;
    }
    setBestOffers((p) => ({ ...p, [k]: { loading: true } }));
    try {
      const data = await tradesApi.getBestOffer(
        nft.contractAddress, nft.tokenId, nft.collectionSlug, nft.chain || 'ethereum'
      );
      setBestOffers((p) => ({ ...p, [k]: { priceEth: data.priceEth, loading: false } }));
    } catch {
      setBestOffers((p) => ({ ...p, [k]: { priceEth: null, loading: false } }));
    }
  }, []);

  const fetchFees = useCallback(async (k, nft) => {
    if (!nft.collectionSlug) {
      setFees((p) => ({ ...p, [k]: { marketplaceFee: 2.5, royaltyFee: 5.0, loading: false } }));
      return;
    }
    setFees((p) => ({ ...p, [k]: { loading: true } }));
    try {
      const info = await scannerApi.getInfo(nft.collectionSlug);
      const mFee = info?.fees?.marketplaceFee ?? 2.5;
      const rFee = info?.fees?.royaltyFee ?? 5.0;
      setFees((p) => ({ ...p, [k]: { marketplaceFee: mFee, royaltyFee: rFee, loading: false } }));
    } catch {
      setFees((p) => ({ ...p, [k]: { marketplaceFee: 2.5, royaltyFee: 5.0, loading: false } }));
    }
  }, []);

  const openAction = (k, nft, mode) => {
    setAction((p) => ({ ...p, [k]: mode }));
    if (mode === 'offer') fetchBestOffer(k, nft);
    if (mode === 'list') fetchFees(k, nft);
  };

  const closeAction = (k) => setAction((p) => ({ ...p, [k]: null }));

  const handleList = async (k, nft) => {
    const price = listPrice[k];
    if (!price || isNaN(parseFloat(price))) return alert('Enter a valid sell price in ETH');
    if (!nft.contractAddress || !nft.tokenId) {
      return alert('This NFT is missing contract/token data and cannot be listed.\nOnly NFTs with a known token ID can be listed.');
    }
    const feeData = fees[k];
    const mFee = feeData?.marketplaceFee ?? 2.5;
    const rFee = feeData?.royaltyFee ?? 5.0;
    const totalFeePct = mFee + rFee;
    const proceeds = (parseFloat(price) * (1 - totalFeePct / 100)).toFixed(4);
    if (!window.confirm(
      `List ${nft.collectionName || nft.collectionSlug} #${nft.tokenId} for ${price} ETH?\n\n` +
      `Fees: ${mFee.toFixed(1)}% OpenSea + ${rFee.toFixed(1)}% creator royalty = ${totalFeePct.toFixed(1)}% total\n` +
      `You receive: ~${proceeds} ETH after fees`
    )) return;
    setBusy((p) => ({ ...p, [k]: true }));
    try {
      await tradesApi.sell(nft.contractAddress, nft.tokenId, parseFloat(price), nft.chain || 'ethereum');
      alert('Listed on OpenSea! It will sell when someone buys at your price.');
      closeAction(k);
    } catch (err) {
      alert(`List failed: ${err.response?.data?.error || err.message}`);
    }
    setBusy((p) => ({ ...p, [k]: false }));
  };

  const handleAcceptOffer = async (k, nft) => {
    const offerEth = bestOffers[k]?.priceEth;
    if (!nft.contractAddress || !nft.tokenId) {
      return alert('NFT is missing contract/token data — cannot accept offer');
    }
    if (!offerEth) return alert('No offer found for this NFT');
    if (!window.confirm(
      `Accept best offer of ${fmt(offerEth)} ETH for ${nft.collectionName || nft.collectionSlug} #${nft.tokenId}?\n\nThis sells the NFT immediately on-chain.`
    )) return;
    setBusy((p) => ({ ...p, [k]: true }));
    try {
      await tradesApi.acceptOffer(nft.contractAddress, nft.tokenId, nft.collectionSlug, nft.chain || 'ethereum');
      alert(`Sold for ${fmt(offerEth)} ETH! NFT removed from portfolio.`);
      closeAction(k);
    } catch (err) {
      alert(`Accept offer failed: ${err.response?.data?.error || err.message}`);
    }
    setBusy((p) => ({ ...p, [k]: false }));
  };

  const totalCost = (portfolio || []).reduce((sum, n) => sum + (n.buyPriceEth || 0), 0);
  const canSell = (nft) => !!(nft.contractAddress && nft.tokenId);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Portfolio</h1>
          <p style={styles.sub}>
            {(portfolio || []).length} NFTs held — cost: {fmt(totalCost)} ETH
            {ethPrice && totalCost > 0 && <span style={{ color: '#64748b' }}> ({fmtUsd(totalCost)})</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.syncBtn} onClick={() => handleSync('ethereum')} disabled={syncing}>
            {syncing ? 'Syncing...' : '⟳ Sync ETH Wallet'}
          </button>
          <button style={styles.syncBtn} onClick={() => handleSync('base')} disabled={syncing}>
            {syncing ? '' : '⟳ Sync Base Wallet'}
          </button>
        </div>
      </div>

      {!portfolio?.length ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>◇</div>
          <div>No NFTs in portfolio yet.</div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            NFTs appear here when the bot buys them or when you mark a bid as filled.
          </div>
        </div>
      ) : (
        <div style={styles.grid}>
          {portfolio.map((nft, i) => {
            const k = cardKey(nft, i);
            const mode = action[k];
            const offerData = bestOffers[k];
            const feeData = fees[k];
            const sellable = canSell(nft);
            const profit = nft.floorPriceEth && nft.buyPriceEth
              ? ((nft.floorPriceEth - nft.buyPriceEth) / nft.buyPriceEth * 100)
              : null;

            return (
              <div key={k} style={styles.card}>
                {nft.collectionImage && (
                  <img
                    src={nft.collectionImage}
                    alt=""
                    style={styles.img}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                )}
                <div style={styles.info}>
                  <div style={styles.name}>{nft.collectionName || nft.collectionSlug}</div>
                  <div style={styles.tokenId} className="mono">
                    {nft.tokenId
                      ? `#${nft.tokenId}`
                      : <span style={{ color: '#475569' }}>token unknown</span>}
                  </div>

                  <div style={styles.meta}>
                    <MetaItem label="Paid" value={`${fmt(nft.buyPriceEth)} ETH`} sub={fmtUsd(nft.buyPriceEth)} />
                    {nft.floorPriceEth > 0 && (
                      <MetaItem
                        label="Floor"
                        value={`${fmt(nft.floorPriceEth)} ETH`}
                        sub={profit != null ? (
                          <span style={{ color: profit >= 0 ? '#22c55e' : '#ef4444' }}>
                            {profit >= 0 ? '+' : ''}{profit.toFixed(1)}%
                          </span>
                        ) : null}
                      />
                    )}
                    {nft.acquiredAt && (
                      <MetaItem label="Acquired" value={format(new Date(nft.acquiredAt), 'MMM d HH:mm')} />
                    )}
                    {nft.acquiredVia === 'bid_fill' && (
                      <MetaItem label="Via" value="Bid fill" />
                    )}
                  </div>

                  {/* Sell buttons — only when no action open */}
                  {!mode && (
                    <div style={styles.btnRow}>
                      {sellable ? (
                        <button style={styles.btnOffer} onClick={() => openAction(k, nft, 'offer')}>
                          ⚡ Accept Offer
                        </button>
                      ) : (
                        <button style={styles.btnOfferDisabled} disabled title="Token ID unknown — cannot sell">
                          ⚡ Accept Offer
                        </button>
                      )}
                      {sellable ? (
                        <button style={styles.btnList} onClick={() => openAction(k, nft, 'list')}>
                          List for Price
                        </button>
                      ) : (
                        <button style={styles.btnListDisabled} disabled title="Token ID unknown — cannot list">
                          List for Price
                        </button>
                      )}
                    </div>
                  )}

                  {/* List for price form */}
                  {mode === 'list' && (
                    <div style={styles.actionBox}>
                      <div style={styles.actionLabel}>Set listing price (ETH)</div>
                      <div style={styles.inputRow}>
                        <input
                          style={styles.input}
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="0.00 ETH"
                          value={listPrice[k] || ''}
                          onChange={(e) => setListPrice((p) => ({ ...p, [k]: e.target.value }))}
                          autoFocus
                        />
                        <button
                          style={styles.btnConfirm}
                          onClick={() => handleList(k, nft)}
                          disabled={busy[k]}
                        >
                          {busy[k] ? '...' : 'List'}
                        </button>
                        <button style={styles.btnX} onClick={() => closeAction(k)}>✗</button>
                      </div>

                      {/* Fee breakdown */}
                      <FeeBreakdown feeData={feeData} listPrice={listPrice[k]} />
                    </div>
                  )}

                  {/* Accept offer form */}
                  {mode === 'offer' && (
                    <div style={styles.actionBox}>
                      <div style={styles.actionLabel}>Accept best offer — sell now</div>
                      {offerData?.loading && (
                        <div style={{ fontSize: 12, color: '#6366f1' }}>Fetching best offer...</div>
                      )}
                      {!offerData?.loading && offerData?.priceEth != null && (
                        <div style={styles.offerPrice}>
                          Best offer:{' '}
                          <span style={{ color: '#22c55e', fontWeight: 700 }}>{fmt(offerData.priceEth)} ETH</span>
                          {fmtUsd(offerData.priceEth) && (
                            <span style={{ color: '#64748b' }}> ({fmtUsd(offerData.priceEth)})</span>
                          )}
                          {nft.buyPriceEth && (
                            <span style={{ color: offerData.priceEth > nft.buyPriceEth ? '#22c55e' : '#ef4444', marginLeft: 8 }}>
                              {offerData.priceEth > nft.buyPriceEth ? '+' : ''}
                              {((offerData.priceEth - nft.buyPriceEth) / nft.buyPriceEth * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                      {!offerData?.loading && offerData && offerData.priceEth == null && (
                        <div style={{ fontSize: 12, color: '#ef4444', padding: '4px 0' }}>
                          No offers found for this NFT.
                        </div>
                      )}
                      <div style={styles.inputRow}>
                        <button
                          style={offerData?.priceEth ? styles.btnConfirmOffer : styles.btnConfirmOfferDisabled}
                          onClick={() => handleAcceptOffer(k, nft)}
                          disabled={busy[k] || !offerData?.priceEth}
                        >
                          {busy[k] ? 'Selling...' : '⚡ Accept & Sell Now'}
                        </button>
                        <button style={styles.btnX} onClick={() => closeAction(k)}>✗</button>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Executes on-chain immediately. NFT transfers out, WETH transfers in.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FeeBreakdown({ feeData, listPrice }) {
  const mFee = feeData?.marketplaceFee ?? 2.5;
  const rFee = feeData?.royaltyFee ?? 5.0;
  const total = mFee + rFee;
  const price = parseFloat(listPrice);

  return (
    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, lineHeight: 1.6 }}>
      {feeData?.loading ? (
        <span>Loading fees...</span>
      ) : (
        <>
          <span style={{ color: '#94a3b8' }}>
            Fees: {mFee.toFixed(1)}% OpenSea + {rFee.toFixed(1)}% creator = {total.toFixed(1)}% total
          </span>
          {!isNaN(price) && price > 0 && (
            <span style={{ color: '#22c55e', marginLeft: 8 }}>
              → you receive ~{(price * (1 - total / 100)).toFixed(4)} ETH
            </span>
          )}
        </>
      )}
    </div>
  );
}

function MetaItem({ label, value, sub }) {
  return (
    <div style={{ marginRight: 16, marginBottom: 4 }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b' }}>{sub}</div>}
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  empty: { textAlign: 'center', padding: '60px 0', color: '#64748b', fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  emptyIcon: { fontSize: 40, color: '#334155' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  card: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  img: { width: '100%', height: 180, objectFit: 'cover' },
  info: { padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  name: { fontWeight: 600, fontSize: 15 },
  tokenId: { fontSize: 12, color: '#64748b' },
  meta: { display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 4 },
  btnRow: { display: 'flex', gap: 8 },
  btnOffer: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnOfferDisabled: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#1e293b', color: '#475569', fontWeight: 700, fontSize: 13, cursor: 'not-allowed' },
  btnList: { flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  btnListDisabled: { flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#334155', fontWeight: 600, fontSize: 13, cursor: 'not-allowed' },
  actionBox: { background: '#0a1020', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #1e293b' },
  actionLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: { display: 'flex', gap: 6 },
  input: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, outline: 'none' },
  btnConfirm: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnConfirmOffer: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnConfirmOfferDisabled: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#1e293b', color: '#475569', fontWeight: 700, fontSize: 13, cursor: 'not-allowed' },
  btnX: { padding: '8px 10px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  offerPrice: { fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  syncBtn: { padding: '8px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 12, cursor: 'pointer' },
};
