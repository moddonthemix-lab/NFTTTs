import React, { useState, useEffect } from 'react';
import { whaleApi } from '../utils/api';

const WHALE_LIMIT = 10;

const fmtUsd = (eth, price) => {
  if (!price || !eth) return null;
  const usd = eth * price;
  return usd >= 1000 ? `≈ $${Math.round(usd).toLocaleString()}` : `≈ $${usd.toFixed(2)}`;
};

const timeAgo = (ts) => {
  if (!ts) return '—';
  const sec = Math.floor(Date.now() / 1000) - ts;
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
};

export default function WhaleTracker({ ethPrice }) {
  const [whales, setWhales] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [expanded, setExpanded] = useState(null);
  const [activeTabs, setActiveTabs] = useState({}); // address → 'holdings' | 'activity'
  const [holdings, setHoldings] = useState({});
  const [loadingNfts, setLoadingNfts] = useState(null);
  const [fullScanning, setFullScanning] = useState(null);
  const [activity, setActivity] = useState({});
  const [loadingActivity, setLoadingActivity] = useState(null);

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
    setActivity((prev) => { const n = { ...prev }; delete n[address]; return n; });
  };

  const handleExpand = async (address) => {
    if (expanded === address) { setExpanded(null); return; }
    setExpanded(address);
    // Default to holdings tab, load if not cached
    const tab = activeTabs[address] || 'holdings';
    if (tab === 'holdings' && !holdings[address]) {
      fetchHoldings(address);
    }
    if (tab === 'activity' && !activity[address]) {
      fetchActivity(address);
    }
  };

  const fetchHoldings = async (address, full = false) => {
    if (full) {
      setFullScanning(address);
    } else {
      setLoadingNfts(address);
    }
    try {
      const data = await whaleApi.getNfts(address, full);
      setHoldings((prev) => ({ ...prev, [address]: data }));
    } catch (err) {
      setHoldings((prev) => ({ ...prev, [address]: { error: err.message } }));
    }
    setLoadingNfts(null);
    setFullScanning(null);
  };

  const fetchActivity = async (address) => {
    setLoadingActivity(address);
    try {
      const data = await whaleApi.getActivity(address);
      setActivity((prev) => ({ ...prev, [address]: data }));
    } catch (err) {
      setActivity((prev) => ({ ...prev, [address]: { error: err.message, events: [], autoWatchlisted: [] } }));
    }
    setLoadingActivity(null);
  };

  const switchTab = (address, tab) => {
    setActiveTabs((prev) => ({ ...prev, [address]: tab }));
    if (tab === 'holdings' && !holdings[address]) fetchHoldings(address);
    if (tab === 'activity' && !activity[address]) fetchActivity(address);
  };

  const refreshActivity = (address) => {
    setActivity((prev) => { const n = { ...prev }; delete n[address]; return n; });
    fetchActivity(address);
  };

  const fmt = (n) => n?.toFixed(4) ?? '—';
  const short = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Whale Tracker</h1>
          <p style={styles.sub}>Track up to {WHALE_LIMIT} wallets — see holdings &amp; recent activity</p>
        </div>
        <span style={styles.count}>{whales.length} / {WHALE_LIMIT} wallets</span>
      </div>

      {whales.length < WHALE_LIMIT && (
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
          const act = activity[whale.address];
          const isLoadingNfts = loadingNfts === whale.address;
          const isLoadingActivity = loadingActivity === whale.address;
          const tab = activeTabs[whale.address] || 'holdings';

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
                    {(isLoadingNfts || isLoadingActivity) && <span style={styles.spinning}>⟳</span>}
                    <span style={styles.chevron}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>
                <button style={styles.btnRemove} onClick={() => handleRemove(whale.address)} title="Remove">✕</button>
              </div>

              {isOpen && (
                <div style={styles.holdingsSection}>
                  {/* Tab bar */}
                  <div style={styles.tabBar}>
                    <button
                      style={{ ...styles.tabBtn, ...(tab === 'holdings' ? styles.tabBtnActive : {}) }}
                      onClick={() => switchTab(whale.address, 'holdings')}
                    >
                      Holdings
                    </button>
                    <button
                      style={{ ...styles.tabBtn, ...(tab === 'activity' ? styles.tabBtnActive : {}) }}
                      onClick={() => switchTab(whale.address, 'activity')}
                    >
                      Activity
                      {act?.events?.length > 0 && (
                        <span style={styles.tabBadge}>{act.events.length}</span>
                      )}
                    </button>
                    {tab === 'activity' && (
                      <button
                        style={styles.tabRefresh}
                        onClick={() => refreshActivity(whale.address)}
                        disabled={isLoadingActivity}
                        title="Refresh activity"
                      >
                        ⟳
                      </button>
                    )}
                  </div>

                  {/* Holdings tab */}
                  {tab === 'holdings' && (
                    <>
                      {isLoadingNfts && <div style={styles.loadingMsg}>Quick scan — fetching top collections...</div>}
                      {fullScanning === whale.address && <div style={styles.loadingMsg}>Full scan — fetching all NFTs (may take a moment)...</div>}
                      {data?.error && <div style={styles.errorMsg}>{data.error}</div>}

                      {data && !data.error && (
                        <>
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
                                    onClick={() => fetchHoldings(whale.address, true)}
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

                          {data.collections?.length === 0 && (
                            <div style={styles.emptyHoldings}>No NFTs found for this wallet.</div>
                          )}
                          <div style={styles.colList}>
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
                    </>
                  )}

                  {/* Activity tab */}
                  {tab === 'activity' && (
                    <div style={styles.activityPane}>
                      {isLoadingActivity && <div style={styles.loadingMsg}>Fetching recent activity...</div>}
                      {act?.error && <div style={styles.errorMsg}>{act.error}</div>}

                      {act && !act.error && !isLoadingActivity && (
                        <>
                          {/* Auto-watchlist notification */}
                          {act.autoWatchlisted?.length > 0 && (
                            <div style={styles.watchlistNotice}>
                              <span style={styles.watchlistIcon}>+</span>
                              <span>
                                Auto-added <strong>{act.autoWatchlisted.length}</strong> buy collection{act.autoWatchlisted.length !== 1 ? 's' : ''} to your watchlist:{' '}
                                {act.autoWatchlisted.join(', ')}
                              </span>
                            </div>
                          )}

                          {act.events?.length === 0 && (
                            <div style={styles.emptyHoldings}>No recent sale activity found.</div>
                          )}

                          <div style={styles.activityList}>
                            {act.events?.map((ev, i) => (
                              <div key={i} style={styles.activityRow}>
                                <span style={{ ...styles.activityBadge, background: ev.type === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: ev.type === 'buy' ? '#22c55e' : '#ef4444' }}>
                                  {ev.type === 'buy' ? 'BUY' : 'SELL'}
                                </span>
                                <div style={styles.activityInfo}>
                                  <span style={styles.activityNft}>
                                    {ev.nftName || ev.tokenId || '—'}
                                  </span>
                                  {ev.collection && (
                                    <a
                                      href={`https://opensea.io/collection/${ev.collection}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={styles.activityCollection}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {ev.collection}
                                    </a>
                                  )}
                                </div>
                                <div style={styles.activityRight}>
                                  <span style={styles.activityPrice}>
                                    {ev.priceEth != null
                                      ? <><span style={{ color: '#f1f5f9', fontWeight: 600 }}>{ev.priceEth.toFixed(4)}</span> <span style={{ color: '#475569' }}>ETH</span></>
                                      : <span style={{ color: '#475569' }}>—</span>
                                    }
                                  </span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={styles.activityTime}>{timeAgo(ev.timestamp)}</span>
                                    {ev.txHash && (
                                      <a
                                        href={`https://etherscan.io/tx/${ev.txHash}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={styles.activityTxLink}
                                        onClick={(e) => e.stopPropagation()}
                                        title="View on Etherscan"
                                      >
                                        ↗
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
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
  // Tabs
  tabBar: { display: 'flex', alignItems: 'center', borderBottom: '1px solid #1e293b', padding: '0 16px', gap: 4 },
  tabBtn: { padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', color: '#64748b', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: -1 },
  tabBtnActive: { color: '#818cf8', borderBottomColor: '#6366f1' },
  tabBadge: { background: '#1e293b', color: '#94a3b8', borderRadius: 10, padding: '1px 6px', fontSize: 11, fontWeight: 600 },
  tabRefresh: { marginLeft: 'auto', padding: '6px 10px', background: 'transparent', border: 'none', color: '#475569', fontSize: 16, cursor: 'pointer' },
  // Holdings
  summaryStrip: { display: 'flex', gap: 0, borderBottom: '1px solid #1e293b', flexWrap: 'wrap' },
  summaryItem: { flex: 1, minWidth: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 10px', borderRight: '1px solid #1e293b' },
  summaryLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  summaryVal: { fontSize: 18, fontWeight: 700 },
  summaryUsd: { fontSize: 11, color: '#475569', marginTop: 2 },
  btnFullScan: { padding: '4px 12px', borderRadius: 6, border: '1px solid #6366f1', background: 'transparent', color: '#818cf8', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginTop: 2 },
  colList: { padding: '8px 16px 16px' },
  colListHeader: { display: 'flex', alignItems: 'center', padding: '6px 10px', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #1e293b', marginBottom: 4 },
  colHeaderCell: { width: 110, textAlign: 'right', flexShrink: 0 },
  colRow: { display: 'flex', alignItems: 'center', padding: '8px 10px', borderRadius: 8, textDecoration: 'none', color: '#f1f5f9', transition: 'background 0.15s', cursor: 'pointer' },
  colIdentity: { flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  colIcon: { width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  colIconPlaceholder: { width: 28, height: 28, borderRadius: 6, background: '#1e293b', flexShrink: 0 },
  colName: { fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  colCell: { width: 110, textAlign: 'right', flexShrink: 0 },
  colCountBadge: { fontSize: 12, color: '#94a3b8', background: '#1e293b', borderRadius: 5, padding: '2px 8px', fontWeight: 600 },
  // Activity
  activityPane: { padding: '0 0 8px' },
  watchlistNotice: { display: 'flex', alignItems: 'flex-start', gap: 10, margin: '12px 16px', padding: '10px 14px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, fontSize: 13, color: '#a5b4fc' },
  watchlistIcon: { background: '#6366f1', color: '#fff', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  activityList: { padding: '4px 16px 8px' },
  activityRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #1e293b' },
  activityBadge: { fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, letterSpacing: 0.5, flexShrink: 0 },
  activityInfo: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  activityNft: { fontSize: 13, fontWeight: 500, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  activityCollection: { fontSize: 11, color: '#6366f1', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  activityRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  activityPrice: { fontSize: 13 },
  activityTime: { fontSize: 11, color: '#475569' },
  activityTxLink: { fontSize: 12, color: '#475569', textDecoration: 'none' },
};
