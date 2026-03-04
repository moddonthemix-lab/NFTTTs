import React, { useState } from 'react';
import { bidsApi, scannerApi } from '../utils/api';
import { format } from 'date-fns';

export default function Bids({ bids, setBids }) {
  const [showForm, setShowForm] = useState(false);
  const [slug, setSlug] = useState('');
  const [amount, setAmount] = useState('');
  const [hours, setHours] = useState(24);
  const [chain, setChain] = useState('ethereum');
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const handleLookup = async () => {
    if (!slug.trim()) return;
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const info = await scannerApi.getInfo(slug.trim());
      setPreview(info);
    } catch (err) {
      setPreviewError(err.response?.data?.error || 'Collection not found');
    }
    setPreviewing(false);
  };

  const handleSlugChange = (e) => {
    setSlug(e.target.value);
    setPreview(null);
    setPreviewError(null);
  };

  const handlePlace = async () => {
    if (!slug || !amount) return alert('Fill in all fields');
    setLoading(true);
    try {
      const result = await bidsApi.place(slug.trim(), parseFloat(amount), parseInt(hours), chain);
      alert(`Bid placed! Order: ${result.orderHash || 'submitted'}`);
      setShowForm(false);
      setSlug(''); setAmount(''); setChain('ethereum'); setPreview(null);
    } catch (err) {
      alert(`Bid failed: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  const handleCancel = async (bid) => {
    if (!bid.orderHash) return alert('No order hash to cancel');
    setCancelling((p) => ({ ...p, [bid.orderHash]: true }));
    try {
      await bidsApi.cancel(bid.orderHash, bid.chain || 'ethereum');
      setBids?.((prev) => prev.filter((b) => b.orderHash !== bid.orderHash));
      alert('Bid cancelled');
    } catch (err) {
      alert(`Cancel failed: ${err.response?.data?.error || err.message}`);
    }
    setCancelling((p) => ({ ...p, [bid.orderHash]: false }));
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Active Bids</h1>
          <p style={styles.sub}>{(bids || []).length} active collection bids</p>
        </div>
        <button style={styles.btnNew} onClick={() => { setShowForm(!showForm); setPreview(null); setPreviewError(null); }}>
          {showForm ? '✗ Cancel' : '+ New Bid'}
        </button>
      </div>

      {showForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitle}>Place Collection Bid</h3>

          <label style={styles.label}>Collection Slug</label>
          <div style={styles.slugRow}>
            <input
              style={{ ...styles.input, flex: 1 }}
              placeholder="e.g. boredapeyachtclub"
              value={slug}
              onChange={handleSlugChange}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            />
            <button style={styles.btnLookup} onClick={handleLookup} disabled={!slug.trim() || previewing} type="button">
              {previewing ? '...' : 'Lookup'}
            </button>
          </div>

          {previewError && (
            <div style={styles.previewError}>{previewError}</div>
          )}

          {preview && (
            <div style={styles.preview}>
              <div style={styles.previewLeft}>
                {preview.imageUrl && (
                  <img src={preview.imageUrl} alt="" style={styles.previewImg} />
                )}
                <div>
                  <div style={styles.previewName}>{preview.name}</div>
                  {preview.description && (
                    <div style={styles.previewDesc}>
                      {preview.description.length > 100 ? preview.description.slice(0, 100) + '…' : preview.description}
                    </div>
                  )}
                </div>
              </div>
              <div style={styles.previewStats}>
                <div style={styles.previewStat}>
                  <span style={styles.previewStatLabel}>Floor</span>
                  <span style={styles.previewStatVal}>{preview.floorPriceEth != null ? `${preview.floorPriceEth} ETH` : '—'}</span>
                </div>
                <div style={styles.previewStat}>
                  <span style={styles.previewStatLabel}>Best Offer</span>
                  <span style={styles.previewStatVal}>{preview.bestOfferEth != null ? `${preview.bestOfferEth} ETH` : '—'}</span>
                </div>
                <div style={styles.previewStat}>
                  <span style={styles.previewStatLabel}>24h Vol</span>
                  <span style={styles.previewStatVal}>{preview.volume24hEth != null ? `${parseFloat(preview.volume24hEth).toFixed(2)} ETH` : '—'}</span>
                </div>
                <div style={styles.previewStat}>
                  <span style={styles.previewStatLabel}>Supply</span>
                  <span style={styles.previewStatVal}>{preview.totalSupply != null ? preview.totalSupply.toLocaleString() : '—'}</span>
                </div>
                <div style={styles.previewStat}>
                  <span style={styles.previewStatLabel}>Owners</span>
                  <span style={styles.previewStatVal}>{preview.numOwners != null ? preview.numOwners.toLocaleString() : '—'}</span>
                </div>
              </div>
            </div>
          )}

          <label style={styles.label}>Offer Amount (ETH / WETH)</label>
          <input style={styles.input} type="number" step="0.001" placeholder="0.05" value={amount} onChange={(e) => setAmount(e.target.value)} />

          <label style={styles.label}>Chain</label>
          <div style={styles.chainRow}>
            {['ethereum', 'base'].map((c) => (
              <button
                key={c}
                style={{ ...styles.chainBtn, ...(chain === c ? styles.chainBtnActive : {}) }}
                onClick={() => setChain(c)}
                type="button"
              >
                {c === 'ethereum' ? '⬡ Ethereum' : '🔵 Base'}
              </button>
            ))}
          </div>

          <label style={styles.label}>Expires In (hours)</label>
          <input style={styles.input} type="number" value={hours} onChange={(e) => setHours(e.target.value)} />

          <div style={styles.note}>
            This is a <strong>collection offer</strong> — any holder of this collection can accept it. Wraps ETH → WETH automatically if needed.
          </div>
          <button style={styles.btnPlace} onClick={handlePlace} disabled={loading}>
            {loading ? 'Placing...' : 'Place Bid'}
          </button>
        </div>
      )}

      {!bids?.length ? (
        <div style={styles.empty}>No active bids. Place a bid above to get started.</div>
      ) : (
        <div style={styles.list}>
          {bids.map((bid, i) => (
            <div key={i} style={styles.card}>
              <div style={styles.cardLeft}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={styles.bidSlug}>{bid.collectionSlug}</span>
                  {bid.chain && (
                    <span style={{ ...styles.chainBadge, ...(bid.chain === 'base' ? styles.chainBadgeBase : {}) }}>
                      {bid.chain}
                    </span>
                  )}
                </div>
                <div style={styles.bidMeta}>
                  <span className="mono" style={{ color: '#eab308' }}>{bid.offerAmountEth} ETH</span>
                  {bid.placedAt && (
                    <span style={{ color: '#64748b', fontSize: 12 }}>
                      Placed {format(new Date(bid.placedAt), 'MMM d HH:mm')}
                    </span>
                  )}
                  {bid.orderHash && (
                    <span style={styles.hash} className="mono">
                      {bid.orderHash.slice(0, 10)}...
                    </span>
                  )}
                </div>
              </div>
              <button
                style={styles.btnCancel}
                onClick={() => handleCancel(bid)}
                disabled={cancelling[bid.orderHash]}
              >
                {cancelling[bid.orderHash] ? '...' : 'Cancel'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  btnNew: { padding: '9px 18px', borderRadius: 9, border: 'none', background: '#eab308', color: '#0a0e1a', fontWeight: 700, fontSize: 14 },
  form: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 },
  formTitle: { fontWeight: 700, fontSize: 16 },
  label: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: '10px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 14, outline: 'none' },
  slugRow: { display: 'flex', gap: 8, alignItems: 'stretch' },
  btnLookup: { padding: '10px 16px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  previewError: { fontSize: 12, color: '#ef4444', background: '#1e293b', borderRadius: 8, padding: '8px 12px' },
  preview: { background: '#1e293b', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid #22c55e44' },
  previewLeft: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  previewImg: { width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
  previewName: { fontWeight: 700, fontSize: 15, color: '#f1f5f9' },
  previewDesc: { fontSize: 12, color: '#64748b', marginTop: 3, lineHeight: 1.4 },
  previewStats: { display: 'flex', gap: 16, flexWrap: 'wrap' },
  previewStat: { display: 'flex', flexDirection: 'column', gap: 2 },
  previewStatLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  previewStatVal: { fontSize: 13, fontWeight: 600, color: '#f1f5f9' },
  note: { fontSize: 12, color: '#64748b', background: '#1e293b', borderRadius: 8, padding: '8px 12px' },
  btnPlace: { padding: '11px 0', borderRadius: 9, border: 'none', background: '#eab308', color: '#0a0e1a', fontWeight: 700, fontSize: 15 },
  empty: { textAlign: 'center', color: '#64748b', padding: '48px 0', fontSize: 14 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { display: 'flex', flexDirection: 'column', gap: 4 },
  bidSlug: { fontWeight: 600, fontSize: 15 },
  bidMeta: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  hash: { fontSize: 11, color: '#334155' },
  btnCancel: { padding: '7px 16px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#ef4444', fontWeight: 600, fontSize: 13 },
  chainRow: { display: 'flex', gap: 8 },
  chainBtn: { flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  chainBtnActive: { border: '1px solid #eab308', color: '#eab308', background: '#1e293b' },
  chainBadge: { fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: '#1e3a5f', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: 0.5 },
  chainBadgeBase: { background: '#1a2a4a', color: '#3b82f6' },
};
