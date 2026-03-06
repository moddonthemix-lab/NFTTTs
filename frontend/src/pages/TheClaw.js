import React, { useState, useEffect, useCallback } from 'react';
import { mintApi, sniperApi, scannerApi } from '../utils/api';

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
          label="Sniper"
          icon="⚡"
          desc="Auto-buy when price enters your target range"
          color="#f59e0b"
          active={mode === 'sniper'}
          onClick={() => setMode(mode === 'sniper' ? null : 'sniper')}
        />
      </div>

      {mode === 'mint'   && <MintPanel ethPrice={ethPrice} />}
      {mode === 'sniper' && <SniperPanel ethPrice={ethPrice} />}
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

/* ─── Gas Speed Config (mirrors backend) ─────────────────────────────────── */
const GAS_SPEEDS = {
  slow:   { label: 'Slow',   desc: 'Low gas — may lag in congestion',         color: '#64748b' },
  normal: { label: 'Normal', desc: 'Standard — usually confirms within 1 min', color: '#22c55e' },
  fast:   { label: 'Fast',   desc: 'Higher tip — fast next-few-block confirm', color: '#f59e0b' },
  turbo:  { label: 'Turbo',  desc: 'Max tip — targets next block',             color: '#ef4444' },
};

/* ─── Sniper Panel ───────────────────────────────────────────────────────── */
function SniperPanel({ ethPrice }) {
  const [slug, setSlug]         = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [gasSpeed, setGasSpeed] = useState('normal');
  const [chain, setChain]       = useState('ethereum');
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState(null);
  const [preview, setPreview]         = useState(null);
  const [previewing, setPreviewing]   = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [snipers, setSnipers]         = useState([]);
  const [cancelling, setCancelling]   = useState(new Set());

  const fmtUsd = (eth) => ethPrice && eth > 0 ? ` ≈ $${(eth * ethPrice).toFixed(2)}` : '';

  const loadSnipers = useCallback(async () => {
    try {
      const data = await sniperApi.get();
      setSnipers(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadSnipers();
    const t = setInterval(loadSnipers, 5000);
    return () => clearInterval(t);
  }, [loadSnipers]);

  const handleLookup = async () => {
    const s = slug.trim().toLowerCase();
    if (!s) return;
    setPreview(null); setPreviewError(null); setPreviewing(true);
    try {
      const info = await scannerApi.getInfo(s);
      setPreview(info);
    } catch (err) {
      setPreviewError(err.response?.data?.error || 'Collection not found — check the slug');
    }
    setPreviewing(false);
  };

  const handleArm = async () => {
    const s = slug.trim().toLowerCase();
    if (!s) return setError('Collection slug is required');
    if (!preview) return setError('Look up the collection first to verify it');
    const mn = parseFloat(minPrice);
    const mx = parseFloat(maxPrice);
    if (isNaN(mn) || mn <= 0) return setError('Enter a valid min price > 0');
    if (isNaN(mx) || mx <= 0) return setError('Enter a valid max price > 0');
    if (mn > mx) return setError('Min price must be ≤ max price');
    setError(null); setBusy(true);
    try {
      await sniperApi.arm(s, mn, mx, quantity, gasSpeed, chain);
      setSlug(''); setMinPrice(''); setMaxPrice(''); setQuantity(1); setPreview(null);
      await loadSnipers();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setBusy(false);
  };

  const handleCancel = async (id) => {
    setCancelling((prev) => new Set([...prev, id]));
    try {
      await sniperApi.cancel(id);
      await loadSnipers();
    } catch { /* ignore */ }
    setCancelling((prev) => { const s = new Set(prev); s.delete(id); return s; });
  };

  const active = snipers.filter((s) => s.status === 'active');
  const done   = snipers.filter((s) => s.status !== 'active').slice(0, 10);

  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>
        <span style={{ color: '#f59e0b' }}>⚡</span> Sniper — Auto-Buy on Price Target
      </div>

      {/* Collection + chain */}
      <div style={styles.row}>
        <div style={{ ...styles.field, flex: 1 }}>
          <label style={styles.label}>Collection Slug</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...styles.input, flex: 1 }}
              placeholder="e.g. boredapeyachtclub"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); setPreview(null); setPreviewError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            />
            <button
              style={{ ...styles.actionBtn, background: '#1e293b', color: '#94a3b8', fontSize: 13, padding: '10px 16px', flexShrink: 0 }}
              onClick={handleLookup}
              disabled={!slug.trim() || previewing}
              type="button"
            >
              {previewing ? '…' : 'Look up'}
            </button>
          </div>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Chain</label>
          <select style={{ ...styles.input, width: 130 }} value={chain} onChange={(e) => setChain(e.target.value)}>
            <option value="ethereum">Ethereum</option>
            <option value="base">Base</option>
          </select>
        </div>
      </div>

      {previewError && <div style={styles.error}>{previewError}</div>}

      {preview && (
        <div style={styles.previewBox}>
          <div style={styles.previewLeft}>
            {preview.imageUrl && (
              <img src={preview.imageUrl} alt="" style={styles.previewImg} onError={(e) => e.target.style.display='none'} />
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>{preview.name}</div>
              {preview.description && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, lineHeight: 1.4 }}>
                  {preview.description.length > 100 ? preview.description.slice(0, 100) + '…' : preview.description}
                </div>
              )}
            </div>
          </div>
          <div style={styles.previewStats}>
            <PreviewStat label="Floor"      value={preview.floorPriceEth != null ? `${preview.floorPriceEth} ETH` : '—'} color="#22c55e" />
            <PreviewStat label="Best Offer" value={preview.bestOfferEth != null ? `${preview.bestOfferEth} ETH` : '—'} color="#6366f1" />
            <PreviewStat label="24h Vol"    value={preview.volume24hEth != null ? `${parseFloat(preview.volume24hEth).toFixed(2)} ETH` : '—'} />
            <PreviewStat label="Supply"     value={preview.totalSupply != null ? preview.totalSupply.toLocaleString() : '—'} />
            <PreviewStat label="Owners"     value={preview.numOwners != null ? preview.numOwners.toLocaleString() : '—'} />
          </div>
        </div>
      )}

      {/* Price range + quantity */}
      <div style={styles.row}>
        <div style={styles.field}>
          <label style={styles.label}>Min Price (ETH)</label>
          <input
            style={{ ...styles.input, width: 130 }}
            type="number" step="0.001" min="0"
            placeholder="0.00"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', paddingTop: 22, color: '#475569', fontSize: 18, fontWeight: 700 }}>→</div>
        <div style={styles.field}>
          <label style={styles.label}>Max Price (ETH)</label>
          <input
            style={{ ...styles.input, width: 130 }}
            type="number" step="0.001" min="0"
            placeholder="0.00"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Quantity</label>
          <input
            style={{ ...styles.input, width: 80 }}
            type="number" min="1" max="100"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
      </div>

      {minPrice && maxPrice && parseFloat(minPrice) <= parseFloat(maxPrice) && (
        <div style={styles.totalRow}>
          Range: <strong>{parseFloat(minPrice).toFixed(4)} ETH{fmtUsd(parseFloat(minPrice))}</strong>
          <span style={{ color: '#475569' }}>→</span>
          <strong>{parseFloat(maxPrice).toFixed(4)} ETH{fmtUsd(parseFloat(maxPrice))}</strong>
          {quantity > 1 && <span style={{ color: '#64748b' }}>× {quantity}</span>}
        </div>
      )}

      {/* Gas speed */}
      <div style={styles.field}>
        <label style={styles.label}>Gas Speed</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(GAS_SPEEDS).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setGasSpeed(key)}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: `2px solid ${gasSpeed === key ? cfg.color : '#334155'}`,
                background: gasSpeed === key ? `${cfg.color}20` : '#1e293b',
                color: gasSpeed === key ? cfg.color : '#64748b',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                transition: 'all 0.15s',
              }}
              title={cfg.desc}
            >
              {cfg.label}
            </button>
          ))}
        </div>
        <div style={styles.hint}>{GAS_SPEEDS[gasSpeed].desc}</div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <button
        style={{ ...styles.actionBtn, background: '#f59e0b', color: '#0f172a', opacity: busy ? 0.6 : 1 }}
        onClick={handleArm}
        disabled={busy}
      >
        {busy ? 'Arming…' : '⚡ Arm Sniper'}
      </button>

      <div style={styles.footNote}>
        Runs persistently in the background — survives page closes and server restarts. Cancel anytime.
      </div>

      {/* Active snipers */}
      {active.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Active Snipers ({active.length})
          </div>
          {active.map((s) => (
            <SniperRow key={s.id} sniper={s} onCancel={handleCancel} cancelling={cancelling.has(s.id)} fmtUsd={fmtUsd} />
          ))}
        </div>
      )}

      {/* Completed/cancelled snipers */}
      {done.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Recent ({done.length})
          </div>
          {done.map((s) => (
            <SniperRow key={s.id} sniper={s} onCancel={null} cancelling={false} fmtUsd={fmtUsd} />
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewStat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: color || '#f1f5f9', fontFamily: 'JetBrains Mono, monospace' }}>{value}</span>
    </div>
  );
}

function useSecondsAgo(isoTimestamp) {
  const [secs, setSecs] = useState(null);
  useEffect(() => {
    if (!isoTimestamp) { setSecs(null); return; }
    const update = () => setSecs(Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [isoTimestamp]);
  return secs;
}

const POLL_MS = { slow: 30000, normal: 10000, fast: 5000, turbo: 2000 };

function SniperRow({ sniper, onCancel, cancelling, fmtUsd }) {
  const statusColor = sniper.status === 'active' ? '#22c55e' : sniper.status === 'filled' ? '#6366f1' : '#475569';
  const fills = sniper.fills || [];
  const secsAgo = useSecondsAgo(sniper.lastCheckedAt);
  const pollSec = (POLL_MS[sniper.gasSpeed] || 10000) / 1000;
  const isActive = sniper.status === 'active';

  let checkedLabel = null;
  if (isActive && secsAgo !== null) {
    if (secsAgo < 3) checkedLabel = { text: 'just checked', color: '#22c55e' };
    else if (secsAgo < pollSec * 1.5) checkedLabel = { text: `checked ${secsAgo}s ago`, color: '#94a3b8' };
    else checkedLabel = { text: `checked ${secsAgo}s ago — next poll soon`, color: '#f59e0b' };
  } else if (isActive && secsAgo === null) {
    checkedLabel = { text: 'waiting for first poll…', color: '#64748b' };
  }

  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '12px 14px', marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          {/* Pulse dot for active */}
          {isActive && (
            <span style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: '#22c55e', flexShrink: 0,
              boxShadow: secsAgo !== null && secsAgo < 3 ? '0 0 0 4px #22c55e44' : 'none',
              transition: 'box-shadow 0.4s',
            }} />
          )}
          <span style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{sniper.collectionSlug}</span>
          <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' }}>
            {sniper.minPriceEth}–{sniper.maxPriceEth} ETH
          </span>
          <span style={{ fontSize: 11, color: '#64748b' }}>×{sniper.quantity}</span>
          <span style={{ fontSize: 11, color: GAS_SPEEDS[sniper.gasSpeed]?.color || '#64748b' }}>
            {GAS_SPEEDS[sniper.gasSpeed]?.label || sniper.gasSpeed}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {sniper.status}{fills.length > 0 ? ` (${sniper.quantityFilled || fills.length}/${sniper.quantity})` : ''}
          </span>
        </div>
        {onCancel && (
          <button
            onClick={() => onCancel(sniper.id)}
            disabled={cancelling}
            style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: cancelling ? 0.5 : 1, flexShrink: 0 }}
          >
            {cancelling ? '…' : 'Cancel'}
          </button>
        )}
      </div>
      {checkedLabel && (
        <div style={{ fontSize: 11, color: checkedLabel.color, fontFamily: 'JetBrains Mono, monospace' }}>
          ⟳ {checkedLabel.text} · polls every {pollSec}s
        </div>
      )}
      {fills.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {fills.map((f, i) => (
            <div key={i} style={{ fontSize: 11, color: '#86efac', fontFamily: 'JetBrains Mono, monospace' }}>
              ✓ {f.priceEth} ETH — {f.txHash?.slice(0, 16)}…
            </div>
          ))}
        </div>
      )}
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
  previewBox: { background: '#1e293b', border: '1px solid #22c55e40', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  previewLeft: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  previewImg: { width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
  previewStats: { display: 'flex', gap: 16, flexWrap: 'wrap' },
};
