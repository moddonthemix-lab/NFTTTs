import React, { useState, useEffect } from 'react';
import { whaleApi } from '../utils/api';

const fmtUsd = (eth, price) => {
  if (!price || !eth) return null;
  const usd = eth * price;
  return usd >= 1000 ? `≈ $${Math.round(usd).toLocaleString()}` : `≈ $${usd.toFixed(2)}`;
};

export default function WhaleTracker({ ethPrice }) {
  const [whales, setWhales] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [expanded, setExpanded] = useState(null);
  const [holdings, setHoldings] = useState({});
  const [loadingNfts, setLoadingNfts] = useState(null); // address being fetched
  const [fullScanning, setFullScanning] = useState(null); // address doing full scan

  useEffect(() => {
    whaleApi.get().then(setWhales).catch(() => {}).finally(() => setLoadingList(false));
  }, []);

  const handleAdd = async () => {
    const addr = input.trim();
    if (!addr) return;
    setAdding(true);
    setAddError('');
    try {
      await whaleApi.add(addr, label.trim());
      setWhales((prev) => [...prev, { address: addr, label: label.trim(), addedAt: new Date().toISOString() }]);
      setInput('');
      setLabel('');
    } catch (err) {
      setAddError(err.response?.data?.error || err.message);
    }
    setAdding(false);
  };

  const handleRemove = async (address) => {
    await whaleApi.remove(address).catch(() => {});
    setWhales((prev) => prev.filter((w) => w.address !== address));
    if (expanded === address) setExpanded(null);
    setHoldings((prev) => { const n = { ...prev }; delete n[address]; return n; });
  };

  const handleExpand = async (address) => {
    if (expanded === address) { setExpanded(null); return; }
    setExpanded(address);
    if (holdings[address]) return;
    setLoadingNfts(address);
    try {
      const data = await whaleApi.getNfts(address, false); // fast preview
      setHoldings((prev) => ({ ...prev, [address]: data }));
    } catch (err) {
      setHoldings((prev) => ({ ...prev, [address]: { error: err.message } }));
    }
    setLoadingNfts(null);
  };

  const handleFullScan = async (address) => {
    setFullScanning(address);
    try {
      const data = await whaleApi.getNfts(address, true); // full scan
      setHoldings((prev) => ({ ...prev, [address]: data }));
    } catch (err) {
      setHoldings((prev) => ({ ...prev, [address]: { ...holdings[address], fullScanError: err.message } }));
    }
    setFullScanning(null);
  };

  const fmt = (n) => n?.toFixed(4) ?? '—';
  const short = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Whale Tracker</h1>
          <p style={styles.sub}>Track up to 5 wallets — see what they hold</p>
        </div>
        <span style={styles.count}>{whales.length} / 5 wallets</span>
      </div>

      {whales.length < 5 && (
        <div style={styles.addBox}>
          <input
            style={{ ...styles.input, flex: 2 }}
            placeholder="0x wallet address"
            value={input}
            onChange={(e) => { setInput(e.target.value); setAddError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <input
            style={{ ...styles.input, flex: 1 }}
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <button style={styles.btnAdd} onClick={handleAdd} disabled={adding || !input.trim()}>
            {adding ? '...' : '+ Add'}
          </button>
        </div>
      )}
      {addError && <div style={styles.error}>{addError}</div>}

      {loadingList && <div style={styles.empty}>Loading...</div>}
      {!loadingList && whales.length === 0 && (
        <div style={styles.empty}>No wallets tracked yet. Add an address above to start.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {whales.map((whale) => {
          const isOpen = expanded === whale.address;
          const data = holdings[whale.address];
          const isLoading = loadingNfts === whale.address;

          return (
            <div key={whale.address} style={styles.whaleCard}>
              <div style={styles.whaleHeader}>
                <button style={styles.whaleToggle} onClick={() => handleExpand(whale.address)}>
                  <div style={styles.whaleIdent}>
                    <div style={styles.whaleAvatar}>
                      {(whale.label || whale.address).slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div style={styles.whaleName}>{whale.label || short(whale.address)}</div>
                      <div style={styles.whaleAddr} className="mono">
                        {whale.label ? short(whale.address) : ''}
                        {data && !data.error && (
                          <span style={styles.whaleMeta}>
                            {whale.label ? ' · ' : ''}
                            {data.totalNfts} NFTs · {data.collections?.length || 0} collections
                            {data.netValueEth > 0 ? ` · ~${fmt(data.netValueEth)} ETH${ethPrice ? ` (${fmtUsd(data.netValueEth, ethPrice)})` : ''}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isLoading && <span style={styles.spinning}>⟳</span>}
                    <span style={styles.chevron}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>
                <button style={styles.btnRemove} onClick={() => handleRemove(whale.address)} title="Remove">✕</button>
              </div>

              {isOpen && (
                <div style={styles.holdingsSection}>
                  {isLoading && <div style={styles.loadingMsg}>Quick scan — fetching top collections...</div>}
                  {fullScanning === whale.address && <div style={styles.loadingMsg}>Full scan — fetching all NFTs (may take a moment)...</div>}
                  {data?.error && <div style={styles.errorMsg}>{data.error}</div>}

                  {data && !data.error && (
                    <>
                      {/* Summary strip */}
                      <div style={styles.summaryStrip}>
                        <div style={styles.summaryItem}>
                          <span style={styles.summaryLabel}>Total NFTs</span>
                          <span style={styles.summaryVal}>{data.totalNfts}</span>
                        </div>
                        <div style={styles.summaryItem}>
                          <span style={styles.summaryLabel}>Collections</span>
                          <span style={styles.summaryVal}>{data.collections?.length || 0}</span>
                        </div>
                        <div style={styles.summaryItem}>
                          <span style={styles.summaryLabel}>Est. Value</span>
                          <span style={{ ...styles.summaryVal, color: '#22c55e' }}>
                            {data.netValueEth > 0 ? `~${fmt(data.netValueEth)} ETH` : '—'}
                          </span>
                          {data.netValueEth > 0 && ethPrice && (
                            <span style={styles.summaryUsd}>{fmtUsd(data.netValueEth, ethPrice)}</span>
                          )}
                        </div>
                        <div style={{ ...styles.summaryItem, alignItems: 'flex-start', justifyContent: 'center', borderRight: 'none' }}>
                          {!data.fullScan ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                              <span style={styles.summaryLabel}>Scan</span>
                              <span style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                                Top 10 collections shown
                              </span>
                              <button
                                style={styles.btnFullScan}
                                onClick={() => handleFullScan(whale.address)}
                                disabled={fullScanning === whale.address}
                              >
                                {fullScanning === whale.address ? '⟳ Scanning...' : '⊕ Full Scan'}
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                              <span style={styles.summaryLabel}>Scan</span>
                              <span style={{ fontSize: 11, color: '#22c55e' }}>
                                {data.truncated ? '2000+ NFTs (capped)' : 'All NFTs scanned'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Collection list — compact rows, no image grids */}
                      {data.collections?.length === 0 && (
                        <div style={styles.emptyHoldings}>No NFTs found for this wallet.</div>
                      )}
                      <div style={styles.colList}>
                        {/* Header row */}
                        {data.collections?.length > 0 && (
                          <div style={styles.colListHeader}>
                            <span style={{ flex: 1 }}>Collection</span>
                            <span style={styles.colHeaderCell}>Count</span>
                            <span style={styles.colHeaderCell}>Floor</span>
                            <span style={styles.colHeaderCell}>Est. Value</span>
                          </div>
                        )}
                        {data.collections?.map((col) => {
                          const count = col.count ?? col.nfts?.length ?? 0;
                          const estVal = col.floorPriceEth ? count * col.floorPriceEth : null;
                          return (
                            <a
                              key={col.slug}
                              href={`https://opensea.io/collection/${col.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              style={styles.colRow}
                            >
                              <div style={styles.colIdentity}>
                                {col.image
                                  ? <img src={col.image} alt="" style={styles.colIcon} onError={(e) => { e.target.style.display = 'none'; }} />
                                  : <div style={styles.colIconPlaceholder} />
                                }
                                <span style={styles.colName}>{col.name || col.slug}</span>
                              </div>
                              <span style={styles.colCell}>
                                <span style={styles.colCountBadge}>{count}</span>
                              </span>
                              <span style={styles.colCell}>
                                {col.floorPriceEth
                                  ? <span className="mono" style={{ color: '#94a3b8', fontSize: 12 }}>{fmt(col.floorPriceEth)} ETH</span>
                                  : <span style={{ color: '#475569', fontSize: 11 }}>—</span>}
                              </span>
                              <span style={styles.colCell}>
                                {estVal
                                  ? <span style={{ color: '#22c55e', fontWeight: 600, fontSize: 12 }}>
                                      ~{fmt(estVal)} ETH
                                      {ethPrice && <span style={{ color: '#475569', fontWeight: 400 }}> ({fmtUsd(estVal, ethPrice)})</span>}
                                    </span>
                                  : <span style={{ color: '#475569', fontSize: 11 }}>—</span>}
                              </span>
                            </a>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  count: { background: '#1e293b', color: '#94a3b8', borderRadius: 8, padding: '4px 12px', fontSize: 13 },
  addBox: { display: 'flex', gap: 10 },
  input: { padding: '9px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 14, outline: 'none' },
  btnAdd: { padding: '9px 18px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', flexShrink: 0 },
  error: { color: '#ef4444', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', padding: '48px 0', fontSize: 14 },
  whaleCard: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' },
  whaleHeader: { display: 'flex', alignItems: 'center' },
  whaleToggle: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'transparent', border: 'none', color: '#f1f5f9', cursor: 'pointer', textAlign: 'left' },
  whaleIdent: { display: 'flex', alignItems: 'center', gap: 12 },
  whaleAvatar: { width: 36, height: 36, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0 },
  whaleName: { fontWeight: 600, fontSize: 14 },
  whaleAddr: { fontSize: 11, color: '#64748b', marginTop: 2 },
  whaleMeta: { color: '#94a3b8' },
  spinning: { display: 'inline-block', animation: 'spin 1s linear infinite', color: '#6366f1', fontSize: 18 },
  chevron: { fontSize: 10, color: '#64748b' },
  btnRemove: { padding: '12px 14px', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, flexShrink: 0 },
  holdingsSection: { borderTop: '1px solid #1e293b' },
  loadingMsg: { padding: '16px', color: '#6366f1', fontSize: 13, textAlign: 'center' },
  errorMsg: { padding: '16px', color: '#ef4444', fontSize: 13 },
  emptyHoldings: { padding: '16px', color: '#64748b', fontSize: 13, textAlign: 'center' },
  summaryStrip: { display: 'flex', gap: 0, borderBottom: '1px solid #1e293b', flexWrap: 'wrap' },
  summaryItem: { flex: 1, minWidth: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 10px', borderRight: '1px solid #1e293b' },
  summaryLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  summaryVal: { fontSize: 18, fontWeight: 700 },
  summaryUsd: { fontSize: 11, color: '#475569', marginTop: 2 },
  btnFullScan: { padding: '4px 12px', borderRadius: 6, border: '1px solid #6366f1', background: 'transparent', color: '#818cf8', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginTop: 2 },
  // Compact collection list
  colList: { padding: '8px 16px 16px' },
  colListHeader: { display: 'flex', alignItems: 'center', padding: '6px 10px', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #1e293b', marginBottom: 4 },
  colHeaderCell: { width: 110, textAlign: 'right', flexShrink: 0 },
  colRow: { display: 'flex', alignItems: 'center', padding: '8px 10px', borderRadius: 8, textDecoration: 'none', color: '#f1f5f9', transition: 'background 0.15s', cursor: 'pointer', ':hover': { background: '#1e293b' } },
  colIdentity: { flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  colIcon: { width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  colIconPlaceholder: { width: 28, height: 28, borderRadius: 6, background: '#1e293b', flexShrink: 0 },
  colName: { fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  colCell: { width: 110, textAlign: 'right', flexShrink: 0 },
  colCountBadge: { fontSize: 12, color: '#94a3b8', background: '#1e293b', borderRadius: 5, padding: '2px 8px', fontWeight: 600 },
};
