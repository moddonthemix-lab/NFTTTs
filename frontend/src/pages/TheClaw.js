import React, { useState } from 'react';
import { mintApi, tradesApi, scannerApi } from '../utils/api';

export default function TheClaw({ ethPrice }) {
  const [mode, setMode] = useState(null); // null | 'mint' | 'fpbuy'

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>The Claw</h1>
        <p style={styles.sub}>Grab what you want — mint fresh or buy the floor</p>
      </div>

      {/* Mode picker */}
      <div style={styles.modePicker}>
        <ModeCard
          label="Mint"
          icon="✦"
          desc="Mint directly from a contract"
          color="#6366f1"
          active={mode === 'mint'}
          onClick={() => setMode(mode === 'mint' ? null : 'mint')}
        />
        <ModeCard
          label="FP Buy"
          icon="⚡"
          desc="Buy the cheapest listing at floor price"
          color="#f59e0b"
          active={mode === 'fpbuy'}
          onClick={() => setMode(mode === 'fpbuy' ? null : 'fpbuy')}
        />
      </div>

      {mode === 'mint'  && <MintPanel ethPrice={ethPrice} />}
      {mode === 'fpbuy' && <FPBuyPanel ethPrice={ethPrice} />}
    </div>
  );
}

/* ─── Mode Card ──────────────────────────────────────────────────────────── */
function ModeCard({ label, icon, desc, color, active, onClick }) {
  return (
    <button
      style={{
        ...styles.modeCard,
        borderColor: active ? color : '#1e293b',
        background: active ? `${color}18` : '#0f172a',
        boxShadow: active ? `0 0 0 2px ${color}44` : 'none',
      }}
      onClick={onClick}
    >
      <span style={{ fontSize: 36, color }}>{icon}</span>
      <span style={{ fontSize: 20, fontWeight: 800, color: active ? color : '#f1f5f9' }}>{label}</span>
      <span style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>{desc}</span>
    </button>
  );
}

/* ─── Mint Panel ─────────────────────────────────────────────────────────── */
function MintPanel({ ethPrice }) {
  const [contract, setContract]   = useState('');
  const [quantity, setQuantity]   = useState(1);
  const [price, setPrice]         = useState('');
  const [chain, setChain]         = useState('ethereum');
  const [calldata, setCalldata]   = useState('');
  const [advanced, setAdvanced]   = useState(false);
  const [busy, setBusy]           = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);

  const totalEth = (parseFloat(price) || 0) * quantity;
  const fmtUsd = (eth) => ethPrice && eth > 0 ? ` ≈ $${(eth * ethPrice).toFixed(2)}` : '';

  const handleMint = async () => {
    if (!contract || !/^0x[a-fA-F0-9]{40}$/.test(contract)) return setError('Enter a valid contract address (0x...)');
    if (quantity < 1 || quantity > 50) return setError('Quantity must be between 1 and 50');
    setError(null); setResult(null); setBusy(true);
    try {
      const res = await mintApi.mint(contract, quantity, parseFloat(price) || 0, chain, calldata || null);
      setResult(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setBusy(false);
  };

  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>
        <span style={{ color: '#6366f1' }}>✦</span> Mint NFTs
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Contract Address</label>
        <input
          style={styles.input}
          placeholder="0x..."
          value={contract}
          onChange={(e) => setContract(e.target.value.trim())}
        />
      </div>

      <div style={styles.row}>
        <div style={styles.field}>
          <label style={styles.label}>Quantity</label>
          <input
            style={{ ...styles.input, width: 90 }}
            type="number"
            min={1}
            max={50}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Price per NFT (ETH)</label>
          <input
            style={{ ...styles.input, width: 160 }}
            type="number"
            step="0.001"
            min="0"
            placeholder="0.00 (free)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Chain</label>
          <select
            style={{ ...styles.input, width: 130 }}
            value={chain}
            onChange={(e) => setChain(e.target.value)}
          >
            <option value="ethereum">Ethereum</option>
            <option value="base">Base</option>
          </select>
        </div>
      </div>

      {totalEth > 0 && (
        <div style={styles.totalRow}>
          Total: <strong>{totalEth.toFixed(6)} ETH</strong>
          <span style={{ color: '#64748b' }}>{fmtUsd(totalEth)}</span>
        </div>
      )}

      <button
        style={{ ...styles.advancedToggle }}
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? '▲ Hide' : '▼ Advanced'} (custom calldata)
      </button>

      {advanced && (
        <div style={styles.field}>
          <label style={styles.label}>Custom calldata (hex, overrides auto-detect)</label>
          <input
            style={{ ...styles.input, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            placeholder="0x... (leave blank to auto-detect mint function)"
            value={calldata}
            onChange={(e) => setCalldata(e.target.value.trim())}
          />
          <div style={styles.hint}>
            e.g. <code>0x1249c58b</code> for <code>mint()</code>. Only needed if auto-detect fails.
          </div>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.success}>
          Minted! TX: <span className="mono" style={{ color: '#818cf8' }}>{result.txHash.slice(0, 18)}…</span>
        </div>
      )}

      <button style={{ ...styles.actionBtn, background: '#6366f1' }} onClick={handleMint} disabled={busy}>
        {busy ? 'Minting…' : `✦ Mint ${quantity > 1 ? `${quantity}x ` : ''}Now`}
      </button>

      <div style={styles.footNote}>
        Auto-detects common mint functions: <code>mint(uint256)</code>, <code>publicMint(uint256)</code>, <code>mint(address, uint256)</code>, and more.
      </div>
    </div>
  );
}

/* ─── FP Buy Panel ───────────────────────────────────────────────────────── */
function FPBuyPanel({ ethPrice }) {
  const [slug, setSlug]           = useState('');
  const [info, setInfo]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [buying, setBuying]       = useState(false);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);

  const fmtUsd = (eth) => ethPrice && eth > 0 ? ` ≈ $${(eth * ethPrice).toFixed(2)}` : '';

  const handleLookup = async () => {
    const s = slug.trim().toLowerCase();
    if (!s) return;
    setInfo(null); setError(null); setResult(null); setLoading(true);
    try {
      const data = await scannerApi.getInfo(s);
      setInfo(data);
    } catch (err) {
      setError('Collection not found — check the slug');
    }
    setLoading(false);
  };

  const handleFPBuy = async () => {
    const s = slug.trim().toLowerCase();
    if (!s) return;
    const floor = info?.floorPriceEth;
    if (!window.confirm(
      `FP Buy floor of "${info?.name || s}"?\n\n` +
      `Floor: ${floor ? `${floor.toFixed(4)} ETH${fmtUsd(floor)}` : 'unknown'}\n\n` +
      `This immediately buys the cheapest listing.`
    )) return;
    setError(null); setResult(null); setBuying(true);
    try {
      const res = await tradesApi.snipe(s);
      setResult(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setBuying(false);
  };

  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>
        <span style={{ color: '#f59e0b' }}>⚡</span> FP Buy — Floor Price Buy
      </div>

      <div style={styles.row}>
        <div style={{ ...styles.field, flex: 1 }}>
          <label style={styles.label}>Collection Slug</label>
          <input
            style={styles.input}
            placeholder="e.g. boredapeyachtclub"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setInfo(null); setResult(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          />
        </div>
        <button
          style={{ ...styles.actionBtn, background: '#1e293b', color: '#94a3b8', marginTop: 22, flexShrink: 0 }}
          onClick={handleLookup}
          disabled={loading || !slug.trim()}
        >
          {loading ? '…' : 'Look up'}
        </button>
      </div>

      {info && (
        <div style={styles.infoBox}>
          {info.imageUrl && <img src={info.imageUrl} alt="" style={styles.colImg} onError={(e) => e.target.style.display='none'} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{info.name}</div>
            <div style={{ display: 'flex', gap: 20, marginTop: 8, flexWrap: 'wrap' }}>
              <InfoStat label="Floor" value={info.floorPriceEth ? `${info.floorPriceEth.toFixed(4)} ETH${fmtUsd(info.floorPriceEth)}` : '—'} color="#22c55e" />
              <InfoStat label="Best Offer" value={info.bestOfferEth ? `${info.bestOfferEth.toFixed(4)} ETH${fmtUsd(info.bestOfferEth)}` : '—'} color="#6366f1" />
              <InfoStat label="Owners" value={info.numOwners?.toLocaleString() || '—'} />
              <InfoStat label="Supply" value={info.totalSupply?.toLocaleString() || '—'} />
            </div>
          </div>
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.success}>
          Bought! Paid <strong>{result.priceEth?.toFixed(4)} ETH</strong>.
          TX: <span className="mono" style={{ color: '#818cf8' }}>{result.txHash?.slice(0, 18)}…</span>
        </div>
      )}

      <button
        style={{ ...styles.actionBtn, background: '#f59e0b', color: '#0f172a', opacity: (!info || buying) ? 0.6 : 1 }}
        onClick={handleFPBuy}
        disabled={!info || buying}
      >
        {buying ? 'Buying…' : `⚡ FP Buy${info?.floorPriceEth ? ` @ ${info.floorPriceEth.toFixed(4)} ETH` : ''}`}
      </button>

      <div style={styles.footNote}>
        Buys the single cheapest active listing for this collection right now.
      </div>
    </div>
  );
}

function InfoStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || '#f1f5f9', fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 },
  header: { textAlign: 'center' },
  h1: { fontSize: 32, fontWeight: 900, letterSpacing: 1 },
  sub: { color: '#64748b', fontSize: 14, marginTop: 4 },
  modePicker: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  modeCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 20px', borderRadius: 16, border: '2px solid', background: '#0f172a', cursor: 'pointer', transition: 'all 0.15s' },
  panel: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 },
  panelTitle: { fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #1e293b', paddingBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: '10px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' },
  totalRow: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: '#94a3b8', background: '#1e293b', borderRadius: 8, padding: '8px 14px' },
  advancedToggle: { background: 'none', border: 'none', color: '#475569', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 },
  hint: { fontSize: 11, color: '#475569', marginTop: 2 },
  actionBtn: { padding: '13px 24px', borderRadius: 10, border: 'none', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', letterSpacing: 0.5 },
  footNote: { fontSize: 11, color: '#475569' },
  error: { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13 },
  success: { background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 14px', color: '#86efac', fontSize: 13 },
  infoBox: { display: 'flex', gap: 14, alignItems: 'flex-start', background: '#1e293b', borderRadius: 10, padding: 14 },
  colImg: { width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
};
