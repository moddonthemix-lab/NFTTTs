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

  // Expanded wallet state
  const [expanded, setExpanded] = useState(null);       // address currently shown
  const [holdings, setHoldings] = useState({});          // { address: data }
  const [loadingNfts, setLoadingNfts] = useState(null);  // address being fetched
  const [expandedCollections, setExpandedCollections] = useState(new Set());

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
    if (expanded === address) { setExpanded(null); }
    setHoldings((prev) => { const n = { ...prev }; delete n[address]; return n; });
  };

  const handleExpand = async (address) => {
    if (expanded === address) { setExpanded(null); return; }
    setExpanded(address);
    setExpandedCollections(new Set());
    if (holdings[address]) return; // already loaded
    setLoadingNfts(address);
    try {
      const data = await whaleApi.getNfts(address);
      setHoldings((prev) => ({ ...prev, [address]: data }));
      // auto-expand all collections
      const slugs = new Set((data.collections || []).map((c) => c.slug));
      setExpandedCollections(slugs);
    } catch (err) {
      setHoldings((prev) => ({ ...prev, [address]: { error: err.message } }));
    }
    setLoadingNfts(null);
  };

  const toggleCol = (slug) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const fmt = (n) => n?.toFixed(4) ?? '—';
  const short = (addr) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Whale Tracker</h1>
          <p style={styles.sub}>Track up to 10 wallets — see what they hold</p>
        </div>
        <span style={styles.count}>{whales.length} / 10 wallets</span>
      </div>

      {/* Add wallet form */}
      {whales.length < 10 && (
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

      {/* Wallet list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {whales.map((whale) => {
          const isOpen = expanded === whale.address;
          const data = holdings[whale.address];
          const isLoading = loadingNfts === whale.address;

          return (
            <div key={whale.address} style={styles.whaleCard}>
              {/* Wallet header row */}
              <div style={styles.whaleHeader}>
                <button style={styles.whaleToggle} onClick={() => handleExpand(whale.address)}>
                  <div style={styles.whaleIdent}>
                    <div style={styles.whaleAvatar}>
                      {(whale.label || whale.address).slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div style={styles.whaleName}>
                        {whale.label || short(whale.address)}
                      </div>
                      <div style={styles.whaleAddr} className="mono">
                        {whale.label ? short(whale.address) : ''}
                        {data && !data.error && (
                          <span style={styles.whaleMeta}>
                            {whale.label ? ' · ' : ''}
                            {data.totalNfts} NFTs
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

              {/* Expanded holdings */}
              {isOpen && (
                <div style={styles.holdingsSection}>
                  {isLoading && <div style={styles.loadingMsg}>Fetching NFTs from OpenSea...</div>}
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
                        {data.totalNfts >= 200 && (
                          <div style={styles.truncNote}>Showing first 200 NFTs</div>
                        )}
                      </div>

                      {/* Collections */}
                      {data.collections?.length === 0 && (
                        <div style={styles.emptyHoldings}>No NFTs found for this wallet.</div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px' }}>
                        {data.collections?.map((col) => {
                          const colOpen = expandedCollections.has(col.slug);
                          const estVal = col.floorPriceEth ? col.nfts.length * col.floorPriceEth : null;
                          return (
                            <div key={col.slug} style={styles.colGroup}>
                              <button style={styles.colHeader} onClick={() => toggleCol(col.slug)}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                  {col.image
                                    ? <img src={col.image} alt="" style={styles.colImg} onError={(e) => { e.target.style.display = 'none'; }} />
                                    : <div style={styles.colImgPlaceholder} />
                                  }
                                  <div style={{ minWidth: 0 }}>
                                    <div style={styles.colName}>{col.name || col.slug}</div>
                                    <div style={styles.colMeta} className="mono">
                                      {col.floorPriceEth
                                        ? `Floor ${fmt(col.floorPriceEth)} ETH${ethPrice ? ` (${fmtUsd(col.floorPriceEth, ethPrice)})` : ''}`
                                        : col.slug}
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                  {estVal && (
                                    <span style={styles.estVal}>
                                      ~{fmt(estVal)} ETH
                                      {ethPrice && <span style={styles.estValUsd}> ({fmtUsd(estVal, ethPrice)})</span>}
                                    </span>
                                  )}
                                  <span style={styles.colCount}>{col.nfts.length} NFT{col.nfts.length !== 1 ? 's' : ''}</span>
                                  <span style={styles.chevronSm}>{colOpen ? '▲' : '▼'}</span>
                                </div>
                              </button>

                              {colOpen && (
                                <div style={styles.nftGrid}>
                                  {col.nfts.map((nft) => (
                                    <a
                                      key={`${nft.contract}_${nft.tokenId}`}
                                      href={nft.openseaUrl || `https://opensea.io/assets/ethereum/${nft.contract}/${nft.tokenId}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={styles.nftCard}
                                    >
                                      {nft.image
                                        ? <img src={nft.image} alt="" style={styles.nftImg} onError={(e) => { e.target.style.display = 'none'; }} />
                                        : <div style={styles.nftImgPlaceholder} />
                                      }
                                      <div style={styles.nftName}>{nft.name || `#${nft.tokenId}`}</div>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
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
  page: { padding: 28, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  count: { background: '#1e293b', color: '#94a3b8', borderRadius: 8, padding: '4px 12px', fontSize: 13 },
  addBox: { display: 'flex', gap: 10 },
  input: { padding: '9px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 14, outline: 'none' },
  btnAdd: { padding: '9px 18px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', flexShrink: 0 },
  error: { color: '#ef4444', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', padding: '48px 0', fontSize: 14 },
  // Whale card
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
  chevronSm: { fontSize: 9, color: '#64748b' },
  btnRemove: { padding: '12px 14px', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, flexShrink: 0 },
  // Holdings
  holdingsSection: { borderTop: '1px solid #1e293b' },
  loadingMsg: { padding: '16px', color: '#6366f1', fontSize: 13, textAlign: 'center' },
  errorMsg: { padding: '16px', color: '#ef4444', fontSize: 13 },
  emptyHoldings: { padding: '16px', color: '#64748b', fontSize: 13, textAlign: 'center' },
  summaryStrip: { display: 'flex', gap: 0, borderBottom: '1px solid #1e293b', flexWrap: 'wrap' },
  summaryItem: { flex: 1, minWidth: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 10px', borderRight: '1px solid #1e293b' },
  summaryLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  summaryVal: { fontSize: 18, fontWeight: 700 },
  truncNote: { flex: 'none', padding: '12px 16px', color: '#64748b', fontSize: 11, alignSelf: 'center' },
  // Collection group
  colGroup: { background: '#0a1020', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' },
  colHeader: { width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'transparent', border: 'none', color: '#f1f5f9', cursor: 'pointer', textAlign: 'left' },
  colImg: { width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 },
  colImgPlaceholder: { width: 32, height: 32, borderRadius: 6, background: '#1e293b', flexShrink: 0 },
  colName: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  colMeta: { fontSize: 11, color: '#64748b', marginTop: 1 },
  colCount: { fontSize: 12, color: '#64748b', background: '#1e293b', borderRadius: 5, padding: '2px 7px' },
  estVal: { fontSize: 12, color: '#22c55e', fontWeight: 600 },
  estValUsd: { color: '#475569', fontWeight: 400 },
  summaryUsd: { fontSize: 11, color: '#475569', marginTop: 2 },
  // NFT grid
  nftGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, padding: '10px 14px 14px' },
  nftCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, textDecoration: 'none', cursor: 'pointer' },
  nftImg: { width: '100%', aspectRatio: '1', borderRadius: 7, objectFit: 'cover', background: '#1e293b' },
  nftImgPlaceholder: { width: '100%', aspectRatio: '1', borderRadius: 7, background: '#1e293b' },
  nftName: { fontSize: 10, color: '#94a3b8', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' },
};
