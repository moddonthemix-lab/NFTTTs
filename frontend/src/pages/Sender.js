import React, { useState, useEffect } from 'react';
import { portfolioApi, senderApi } from '../utils/api';

export default function Sender() {
  const [portfolio, setPortfolio]     = useState([]);
  const [loading, setLoading]         = useState(true);

  // Manual-entry mode for NFTs not in portfolio
  const [manualContract, setManualContract] = useState('');
  const [manualTokenId, setManualTokenId]   = useState('');
  const [manualChain, setManualChain]       = useState('ethereum');

  // Selection basket
  const [selected, setSelected] = useState([]); // [{ contractAddress, tokenId, chain, name, image }]

  // Recipient + send state
  const [toAddress, setToAddress]   = useState('');
  const [sending, setSending]       = useState(false);
  const [results, setResults]       = useState(null); // array of per-token results

  // Chain filter for portfolio view
  const [chainFilter, setChainFilter] = useState('all');

  useEffect(() => {
    portfolioApi.get()
      .then((items) => setPortfolio(items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isSelected = (contractAddress, tokenId) =>
    selected.some((s) => s.contractAddress === contractAddress && String(s.tokenId) === String(tokenId));

  const toggleSelect = (item) => {
    if (isSelected(item.contractAddress, item.tokenId)) {
      setSelected((prev) => prev.filter(
        (s) => !(s.contractAddress === item.contractAddress && String(s.tokenId) === String(item.tokenId))
      ));
    } else {
      if (selected.length >= 20) return;
      setSelected((prev) => [...prev, item]);
    }
  };

  const addManual = () => {
    if (!manualContract || !manualTokenId) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(manualContract)) {
      alert('Invalid contract address');
      return;
    }
    if (isSelected(manualContract, manualTokenId)) return;
    if (selected.length >= 20) return;
    setSelected((prev) => [...prev, {
      contractAddress: manualContract,
      tokenId: manualTokenId,
      chain: manualChain,
      name: `${manualContract.slice(0, 6)}…#${manualTokenId}`,
      image: null,
    }]);
    setManualContract(''); setManualTokenId('');
  };

  const handleSend = async () => {
    if (!toAddress || !/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
      alert('Enter a valid recipient address');
      return;
    }
    if (selected.length === 0) { alert('Select at least one NFT to send'); return; }
    if (!window.confirm(`Send ${selected.length} NFT${selected.length > 1 ? 's' : ''} to ${toAddress}?`)) return;

    setSending(true);
    setResults(null);
    try {
      const transfers = selected.map((s) => ({
        contractAddress: s.contractAddress,
        tokenId: s.tokenId,
        chain: s.chain || 'ethereum',
      }));
      const data = await senderApi.send(transfers, toAddress);
      setResults(data.results);
      // Remove successfully sent NFTs from selection
      const failedKeys = new Set(
        data.results.filter((r) => r.status === 'error').map((r) => `${r.contractAddress}_${r.tokenId}`)
      );
      setSelected((prev) => prev.filter((s) => failedKeys.has(`${s.contractAddress}_${s.tokenId}`)));
      // Refresh portfolio
      portfolioApi.get().then((items) => setPortfolio(items || [])).catch(() => {});
    } catch (err) {
      alert(`Send failed: ${err.response?.data?.error || err.message}`);
    }
    setSending(false);
  };

  const visiblePortfolio = portfolio.filter((n) =>
    chainFilter === 'all' || (n.chain || 'ethereum') === chainFilter
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.h1}>Sender</h1>
        <p style={styles.sub}>Send up to 20 NFTs to any wallet in one batch</p>
      </div>

      {/* ── Recipient ── */}
      <div style={styles.card}>
        <label style={styles.label}>Recipient Address</label>
        <input
          style={styles.input}
          placeholder="0x… destination wallet"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value)}
        />
      </div>

      {/* ── NFT Basket ── */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <label style={styles.label}>
            Selected NFTs
            <span style={{ color: selected.length >= 20 ? '#ef4444' : '#64748b', marginLeft: 8 }}>
              {selected.length} / 20
            </span>
          </label>
          {selected.length > 0 && (
            <button style={styles.btnClear} onClick={() => setSelected([])}>Clear all</button>
          )}
        </div>

        {selected.length === 0 ? (
          <div style={styles.empty}>No NFTs selected — pick from your portfolio below or add manually</div>
        ) : (
          <div style={styles.basketGrid}>
            {selected.map((s) => (
              <div key={`${s.contractAddress}_${s.tokenId}`} style={styles.basketItem}>
                {s.image
                  ? <img src={s.image} alt="" style={styles.basketImg} onError={(e) => { e.target.style.display = 'none'; }} />
                  : <div style={styles.basketImgPlaceholder} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.basketName} title={s.name}>{s.name || `#${s.tokenId}`}</div>
                  <div style={styles.basketMeta}>
                    {s.chain === 'base' ? '⬡ Base' : '⬡ ETH'}
                  </div>
                </div>
                <button style={styles.btnRemove} onClick={() => toggleSelect(s)}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Manual add */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #1e293b' }}>
          <label style={styles.label}>Add by contract + token ID</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <input
              style={{ ...styles.input, flex: 2, minWidth: 160 }}
              placeholder="0x contract address"
              value={manualContract}
              onChange={(e) => setManualContract(e.target.value)}
            />
            <input
              style={{ ...styles.input, flex: 1, minWidth: 80 }}
              placeholder="Token ID"
              value={manualTokenId}
              onChange={(e) => setManualTokenId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addManual()}
            />
            <select
              style={{ ...styles.input, width: 110 }}
              value={manualChain}
              onChange={(e) => setManualChain(e.target.value)}
            >
              <option value="ethereum">Ethereum</option>
              <option value="base">Base</option>
            </select>
            <button
              style={{ ...styles.btnSend, padding: '0 16px', background: '#334155' }}
              onClick={addManual}
              disabled={!manualContract || !manualTokenId || selected.length >= 20}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      {/* ── Send button ── */}
      <button
        style={{ ...styles.btnSend, opacity: sending || selected.length === 0 || !toAddress ? 0.5 : 1 }}
        onClick={handleSend}
        disabled={sending || selected.length === 0 || !toAddress}
      >
        {sending
          ? `⟳ Sending ${selected.length} NFT${selected.length > 1 ? 's' : ''}…`
          : `⇥ Send ${selected.length > 0 ? `${selected.length} ` : ''}NFT${selected.length !== 1 ? 's' : ''}`}
      </button>

      {/* ── Results ── */}
      {results && (
        <div style={styles.card}>
          <label style={styles.label}>Send Results</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {results.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8, background: '#0f172a',
                border: `1px solid ${r.status === 'ok' ? '#22c55e44' : '#ef444444'}`,
              }}>
                <span style={{ color: r.status === 'ok' ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 16 }}>
                  {r.status === 'ok' ? '✓' : '✗'}
                </span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#94a3b8' }}>
                    {r.contractAddress?.slice(0, 8)}…#{r.tokenId}
                  </span>
                  {r.status === 'ok'
                    ? <span style={{ marginLeft: 10, fontSize: 11, color: '#64748b' }}>tx {r.txHash?.slice(0, 14)}…</span>
                    : <span style={{ marginLeft: 10, fontSize: 11, color: '#ef4444' }}>{r.error}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Portfolio picker ── */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <label style={styles.label}>
            Your Portfolio
            {!loading && <span style={{ color: '#64748b', marginLeft: 8 }}>{portfolio.length} NFTs</span>}
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'ethereum', 'base'].map((c) => (
              <button
                key={c}
                style={{ ...styles.chainBtn, ...(chainFilter === c ? styles.chainBtnActive : {}) }}
                onClick={() => setChainFilter(c)}
              >
                {c === 'all' ? 'All' : c === 'ethereum' ? 'ETH' : 'BASE'}
              </button>
            ))}
          </div>
        </div>

        {loading && <div style={styles.empty}>Loading portfolio…</div>}
        {!loading && visiblePortfolio.length === 0 && (
          <div style={styles.empty}>
            {portfolio.length === 0
              ? 'No NFTs in portfolio — use manual entry above to send any NFT'
              : 'No NFTs on this chain'}
          </div>
        )}

        <div style={styles.nftGrid}>
          {visiblePortfolio.map((nft) => {
            const sel = isSelected(nft.contractAddress, nft.tokenId);
            const atMax = !sel && selected.length >= 20;
            return (
              <button
                key={`${nft.contractAddress}_${nft.tokenId}`}
                style={{
                  ...styles.nftCard,
                  border: sel ? '2px solid #6366f1' : '2px solid #1e293b',
                  background: sel ? 'rgba(99,102,241,0.08)' : '#0f172a',
                  opacity: atMax ? 0.4 : 1,
                  cursor: atMax ? 'not-allowed' : 'pointer',
                }}
                onClick={() => !atMax && toggleSelect({
                  contractAddress: nft.contractAddress,
                  tokenId: nft.tokenId,
                  chain: nft.chain || 'ethereum',
                  name: `${nft.collectionName || nft.collectionSlug || 'NFT'} #${nft.tokenId}`,
                  image: nft.imageUrl || nft.collectionImage || null,
                })}
                disabled={atMax}
                title={atMax ? 'Maximum 20 NFTs per batch' : sel ? 'Click to deselect' : 'Click to select'}
              >
                {nft.imageUrl || nft.collectionImage
                  ? <img src={nft.imageUrl || nft.collectionImage} alt="" style={styles.nftImg}
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  : <div style={styles.nftImgPlaceholder} />
                }
                <div style={styles.nftName} title={`${nft.collectionName || nft.collectionSlug} #${nft.tokenId}`}>
                  {nft.collectionName || nft.collectionSlug || 'NFT'}
                  <span style={{ color: '#64748b' }}> #{nft.tokenId}</span>
                </div>
                {(nft.chain === 'base') && (
                  <span style={styles.chainBadge}>BASE</span>
                )}
                {sel && <span style={styles.checkmark}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page:   { padding: 28, maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', flexDirection: 'column', gap: 4 },
  h1:     { fontSize: 24, fontWeight: 700 },
  sub:    { color: '#64748b', fontSize: 13 },
  card:   { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '16px 20px' },
  label:  { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 },
  input:  { padding: '9px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  empty:  { color: '#475569', fontSize: 13, textAlign: 'center', padding: '16px 0' },
  btnSend: {
    width: '100%', padding: '14px 0', borderRadius: 10, border: 'none',
    background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 15,
    cursor: 'pointer', transition: 'opacity 0.15s',
  },
  btnClear:  { padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' },
  btnRemove: { padding: '2px 7px', borderRadius: 5, border: 'none', background: '#1e293b', color: '#94a3b8', fontSize: 16, cursor: 'pointer', lineHeight: 1 },
  basketGrid: { display: 'flex', flexDirection: 'column', gap: 6 },
  basketItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#1e293b', borderRadius: 8 },
  basketImg:  { width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  basketImgPlaceholder: { width: 32, height: 32, borderRadius: 6, background: '#334155', flexShrink: 0 },
  basketName: { fontSize: 13, color: '#f1f5f9', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  basketMeta: { fontSize: 10, color: '#64748b', marginTop: 1 },
  nftGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginTop: 6 },
  nftCard: { position: 'relative', borderRadius: 10, padding: 8, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, transition: 'border-color 0.15s' },
  nftImg:  { width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 7 },
  nftImgPlaceholder: { width: '100%', aspectRatio: '1/1', background: '#1e293b', borderRadius: 7 },
  nftName: { fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chainBadge: { position: 'absolute', top: 6, left: 6, fontSize: 8, fontWeight: 700, color: '#60a5fa', background: '#1e3a5f', borderRadius: 3, padding: '1px 4px' },
  checkmark:  { position: 'absolute', top: 6, right: 6, color: '#6366f1', fontWeight: 900, fontSize: 14 },
  chainBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #1e293b', background: '#1e293b', color: '#64748b', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  chainBtnActive: { background: '#312e81', color: '#818cf8', borderColor: '#6366f1' },
};
