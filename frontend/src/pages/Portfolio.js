import React, { useState, useCallback } from 'react';
import { tradesApi } from '../utils/api';
import { format } from 'date-fns';

const fmt = (n, d = 4) => (n != null ? Number(n).toFixed(d) : '—');

export default function Portfolio({ portfolio, ethPrice }) {
  const [action, setAction] = useState({}); // { [key]: 'list'|'offer' }
  const [listPrice, setListPrice] = useState({});
  const [busy, setBusy] = useState({});
  const [bestOffers, setBestOffers] = useState({}); // { [key]: { priceEth, loading } }

  const fmtUsd = (eth) => {
    if (!ethPrice || eth == null) return null;
    const usd = eth * ethPrice;
    return usd >= 1000 ? `$${Math.round(usd).toLocaleString()}` : `$${usd.toFixed(2)}`;
  };

  const key = (nft) => `${nft.contractAddress}-${nft.tokenId}`;

  const fetchBestOffer = useCallback(async (nft) => {
    const k = key(nft);
    if (!nft.contractAddress || !nft.tokenId || !nft.collectionSlug) return;
    setBestOffers((p) => ({ ...p, [k]: { loading: true } }));
    try {
      const data = await tradesApi.getBestOffer(nft.contractAddress, nft.tokenId, nft.collectionSlug, nft.chain || 'ethereum');
      setBestOffers((p) => ({ ...p, [k]: { priceEth: data.priceEth, loading: false } }));
    } catch {
      setBestOffers((p) => ({ ...p, [k]: { priceEth: null, loading: false } }));
    }
  }, []);

  const openAction = (nft, mode) => {
    const k = key(nft);
    setAction((p) => ({ ...p, [k]: mode }));
    if (mode === 'offer') fetchBestOffer(nft);
  };

  const closeAction = (nft) => setAction((p) => ({ ...p, [key(nft)]: null }));

  const handleList = async (nft) => {
    const k = key(nft);
    const price = listPrice[k];
    if (!price) return alert('Enter a sell price');
    if (!nft.contractAddress || !nft.tokenId) return alert('NFT is missing contract/token data — cannot list');
    if (!window.confirm(`List ${nft.collectionName || nft.collectionSlug} #${nft.tokenId} for ${price} ETH?`)) return;
    setBusy((p) => ({ ...p, [k]: true }));
    try {
      await tradesApi.sell(nft.contractAddress, nft.tokenId, parseFloat(price), nft.chain || 'ethereum');
      alert('Listed on OpenSea! It will sell when someone buys at your price.');
      closeAction(nft);
    } catch (err) {
      alert(`List failed: ${err.response?.data?.error || err.message}`);
    }
    setBusy((p) => ({ ...p, [k]: false }));
  };

  const handleAcceptOffer = async (nft) => {
    const k = key(nft);
    const offerEth = bestOffers[k]?.priceEth;
    if (!nft.contractAddress || !nft.tokenId) return alert('NFT is missing contract/token data — cannot accept offer');
    if (!offerEth) return alert('No offer found for this NFT');
    if (!window.confirm(`Accept best offer of ${fmt(offerEth)} ETH for ${nft.collectionName || nft.collectionSlug} #${nft.tokenId}?\n\nThis sells the NFT immediately on-chain.`)) return;
    setBusy((p) => ({ ...p, [k]: true }));
    try {
      await tradesApi.acceptOffer(nft.contractAddress, nft.tokenId, nft.collectionSlug, nft.chain || 'ethereum');
      alert(`Sold for ${fmt(offerEth)} ETH! NFT removed from portfolio.`);
      closeAction(nft);
    } catch (err) {
      alert(`Accept offer failed: ${err.response?.data?.error || err.message}`);
    }
    setBusy((p) => ({ ...p, [k]: false }));
  };

  const totalCost = (portfolio || []).reduce((sum, n) => sum + (n.buyPriceEth || 0), 0);

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
            const k = key(nft);
            const mode = action[k];
            const offerData = bestOffers[k];
            const profit = nft.floorPriceEth && nft.buyPriceEth
              ? ((nft.floorPriceEth - nft.buyPriceEth) / nft.buyPriceEth * 100)
              : null;

            return (
              <div key={k || i} style={styles.card}>
                {nft.collectionImage && (
                  <img src={nft.collectionImage} alt="" style={styles.img} onError={(e) => { e.target.style.display = 'none'; }} />
                )}
                <div style={styles.info}>
                  <div style={styles.name}>{nft.collectionName || nft.collectionSlug}</div>
                  <div style={styles.tokenId} className="mono">
                    {nft.tokenId ? `#${nft.tokenId}` : <span style={{ color: '#475569' }}>token unknown</span>}
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

                  {/* Action area */}
                  {!mode && (
                    <div style={styles.btnRow}>
                      <button style={styles.btnOffer} onClick={() => openAction(nft, 'offer')}>
                        ⚡ Accept Offer
                      </button>
                      <button style={styles.btnList} onClick={() => openAction(nft, 'list')}>
                        List for Price
                      </button>
                    </div>
                  )}

                  {mode === 'list' && (
                    <div style={styles.actionBox}>
                      <div style={styles.actionLabel}>Set listing price</div>
                      <div style={styles.inputRow}>
                        <input
                          style={styles.input}
                          type="number"
                          step="0.001"
                          placeholder="ETH price"
                          value={listPrice[k] || ''}
                          onChange={(e) => setListPrice((p) => ({ ...p, [k]: e.target.value }))}
                          autoFocus
                        />
                        <button style={styles.btnConfirm} onClick={() => handleList(nft)} disabled={busy[k]}>
                          {busy[k] ? '...' : 'List'}
                        </button>
                        <button style={styles.btnX} onClick={() => closeAction(nft)}>✗</button>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Creates a fixed-price listing on OpenSea (72h). Sells when someone buys.
                      </div>
                    </div>
                  )}

                  {mode === 'offer' && (
                    <div style={styles.actionBox}>
                      <div style={styles.actionLabel}>Accept best offer — sell now</div>
                      {offerData?.loading && <div style={{ fontSize: 12, color: '#6366f1' }}>Fetching best offer...</div>}
                      {!offerData?.loading && offerData?.priceEth != null && (
                        <div style={styles.offerPrice}>
                          Best offer: <span style={{ color: '#22c55e', fontWeight: 700 }}>{fmt(offerData.priceEth)} ETH</span>
                          {fmtUsd(offerData.priceEth) && <span style={{ color: '#64748b' }}> ({fmtUsd(offerData.priceEth)})</span>}
                          {nft.buyPriceEth && (
                            <span style={{ color: offerData.priceEth > nft.buyPriceEth ? '#22c55e' : '#ef4444', marginLeft: 8 }}>
                              {offerData.priceEth > nft.buyPriceEth ? '+' : ''}
                              {((offerData.priceEth - nft.buyPriceEth) / nft.buyPriceEth * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                      {!offerData?.loading && offerData?.priceEth == null && offerData && (
                        <div style={{ fontSize: 12, color: '#ef4444' }}>No offers found for this NFT.</div>
                      )}
                      <div style={styles.inputRow}>
                        <button
                          style={styles.btnConfirmOffer}
                          onClick={() => handleAcceptOffer(nft)}
                          disabled={busy[k] || !offerData?.priceEth}
                        >
                          {busy[k] ? 'Selling...' : '⚡ Accept & Sell Now'}
                        </button>
                        <button style={styles.btnX} onClick={() => closeAction(nft)}>✗</button>
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
  btnList: { flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  actionBox: { background: '#0a1020', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #1e293b' },
  actionLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: { display: 'flex', gap: 6 },
  input: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, outline: 'none' },
  btnConfirm: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnConfirmOffer: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnX: { padding: '8px 10px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  offerPrice: { fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
};
