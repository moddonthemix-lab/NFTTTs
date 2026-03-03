import React, { useState, useEffect } from 'react';
import OpportunityCard from '../components/OpportunityCard';
import { favoritesApi, tradesApi, bidsApi } from '../utils/api';

export default function Favorites() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [bidModal, setBidModal] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidHours, setBidHours] = useState(24);
  const [sort, setSort] = useState('saved');
  const [expandedCollections, setExpandedCollections] = useState(new Set());

  useEffect(() => {
    favoritesApi.get().then((list) => {
      setFavorites(list);
      // auto-expand all NFT opportunity collection groups on first load
      const slugs = new Set(list.filter(f => f.type !== 'collection').map((f) => f.collectionSlug || 'unknown'));
      setExpandedCollections(slugs);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const toggleCollection = (slug) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleRemoveFavorite = async (opp) => {
    await favoritesApi.remove(opp.id).catch(() => {});
    setFavorites((prev) => prev.filter((f) => f.id !== opp.id));
  };

  const handleBuy = async (opp) => {
    if (!window.confirm(`Buy ${opp.collectionName} #${opp.tokenId} for ${opp.listingPriceEth} ETH?`)) return;
    setActionLoading(opp.id);
    try {
      await tradesApi.buy(opp.listing);
      alert('Buy order sent!');
    } catch (err) {
      alert(`Buy failed: ${err.message}`);
    }
    setActionLoading(null);
  };

  const handleBidOpen = (opp) => {
    setBidModal(opp);
    setBidAmount((opp.floorPriceEth * 0.85).toFixed(4));
  };

  const handleBidSubmit = async () => {
    if (!bidModal || !bidAmount) return;
    setActionLoading(bidModal.id);
    try {
      await bidsApi.place(bidModal.collectionSlug, parseFloat(bidAmount), parseInt(bidHours));
      alert(`Bid placed on ${bidModal.collectionSlug}!`);
      setBidModal(null);
    } catch (err) {
      alert(`Bid failed: ${err.message}`);
    }
    setActionLoading(null);
  };

  // Separate collection bookmarks from NFT opportunity favorites
  const collectionFavs = React.useMemo(() =>
    favorites.filter(f => f.type === 'collection').sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0)),
  [favorites]);

  const handleRemoveCollectionFav = async (id) => {
    await favoritesApi.remove(id).catch(() => {});
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  };

  // Sort and group NFT opportunities by collection
  const sorted = React.useMemo(() => {
    const list = favorites.filter(f => f.type !== 'collection');
    if (sort === 'score') list.sort((a, b) => (b.score || 0) - (a.score || 0));
    else if (sort === 'price') list.sort((a, b) => (a.listingPriceEth || 0) - (b.listingPriceEth || 0));
    else if (sort === 'profit') list.sort((a, b) => (b.flipEstimate?.profitPct || 0) - (a.flipEstimate?.profitPct || 0));
    else list.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    return list;
  }, [favorites, sort]);

  const grouped = React.useMemo(() => {
    const map = new Map();
    for (const opp of sorted) {
      const slug = opp.collectionSlug || 'unknown';
      if (!map.has(slug)) {
        map.set(slug, {
          slug,
          name: opp.collectionName || slug,
          image: opp.collectionImage || null,
          floorPriceEth: opp.floorPriceEth,
          listings: [],
        });
      }
      map.get(slug).listings.push(opp);
    }
    return Array.from(map.values());
  }, [sorted]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Favorites</h1>
          <p style={styles.sub}>Saved to your connected wallet</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {favorites.length > 0 && (
            <span style={styles.count}>{favorites.length} saved</span>
          )}
          <select style={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="saved">Sort: Date Saved</option>
            <option value="score">Sort: Score</option>
            <option value="price">Sort: Price ↑</option>
            <option value="profit">Sort: Profit %</option>
          </select>
        </div>
      </div>

      {loading && <div style={styles.empty}>Loading...</div>}

      {!loading && favorites.length === 0 && (
        <div style={styles.empty}>
          No favorites yet. Hit ♡ on collection headers or opportunity cards in the Scanner to save here.
        </div>
      )}

      {/* Bookmarked Collections */}
      {collectionFavs.length > 0 && (
        <div>
          <div style={styles.sectionTitle}>Collections</div>
          <div style={styles.colFavGrid}>
            {collectionFavs.map((col) => (
              <div key={col.id} style={styles.colFavCard}>
                {col.collectionImage
                  ? <img src={col.collectionImage} alt="" style={styles.colFavImg} onError={(e) => { e.target.style.display = 'none'; }} />
                  : <div style={styles.colFavImgPlaceholder} />
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.colFavName}>{col.collectionName || col.collectionSlug}</div>
                  <div style={styles.colFavMeta} className="mono">
                    {col.floorPriceEth ? `Floor ${col.floorPriceEth.toFixed(4)} ETH` : col.collectionSlug}
                    {col.chain === 'base' && <span style={styles.chainBadge}>BASE</span>}
                  </div>
                </div>
                <button style={styles.colFavRemove} onClick={() => handleRemoveCollectionFav(col.id)} title="Remove">♥</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NFT Opportunity favorites, grouped by collection */}
      {sorted.length > 0 && collectionFavs.length > 0 && (
        <div style={styles.sectionTitle}>NFT Opportunities</div>
      )}

      {/* Collection groups */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grouped.map((group) => {
          const isExpanded = expandedCollections.has(group.slug);
          const best = group.listings[0];
          const bestGrade = best?.dealGrade || (() => { const s = best?.score ?? 0; return s >= 75 ? 'A' : s >= 55 ? 'B' : s >= 35 ? 'C' : s >= 20 ? 'D' : 'F'; })();
          const gradeColor = { A: '#22c55e', B: '#3b82f6', C: '#eab308', D: '#f97316', F: '#ef4444' }[bestGrade] || '#94a3b8';
          return (
            <div key={group.slug} style={styles.groupWrapper}>
              <button style={styles.groupHeader} onClick={() => toggleCollection(group.slug)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {group.image && (
                    <img src={group.image} alt="" style={styles.groupImg}
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.groupName}>{group.name}</div>
                    <div style={styles.groupMeta} className="mono">
                      {group.floorPriceEth ? `Floor ${group.floorPriceEth.toFixed(4)} ETH` : group.slug}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ ...styles.gradeChip, color: gradeColor, borderColor: gradeColor }}>{bestGrade}</div>
                  <span style={styles.groupCount}>{group.listings.length} saved</span>
                  <span style={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div style={styles.grid}>
                  {group.listings.map((opp) => (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      onBuy={handleBuy}
                      onBid={handleBidOpen}
                      onFavorite={handleRemoveFavorite}
                      isFavorited={true}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {bidModal && (
        <div style={styles.overlay} onClick={() => setBidModal(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Place Bid — {bidModal.collectionName}</h2>
            <div style={styles.modalInfo}>Floor: <b>{bidModal.floorPriceEth?.toFixed(4)} ETH</b></div>
            <label style={styles.label}>Bid Amount (ETH)</label>
            <input style={styles.input} type="number" step="0.001" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} />
            <label style={styles.label}>Expiration (hours)</label>
            <input style={styles.input} type="number" value={bidHours} onChange={(e) => setBidHours(e.target.value)} />
            <div style={styles.modalActions}>
              <button style={styles.btnCancel} onClick={() => setBidModal(null)}>Cancel</button>
              <button style={styles.btnBid} onClick={handleBidSubmit} disabled={!!actionLoading}>
                {actionLoading ? '...' : 'Place Bid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  sectionTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 8 },
  colFavGrid: { display: 'flex', flexDirection: 'column', gap: 6 },
  colFavCard: { display: 'flex', alignItems: 'center', gap: 12, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 14px' },
  colFavImg: { width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
  colFavImgPlaceholder: { width: 40, height: 40, borderRadius: 8, background: '#1e293b', flexShrink: 0 },
  colFavName: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  colFavMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  colFavRemove: { background: '#7f1d1d', border: 'none', color: '#f87171', borderRadius: 6, padding: '4px 8px', fontSize: 13, cursor: 'pointer', flexShrink: 0 },
  chainBadge: { display: 'inline-block', marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: '#1e3a5f', color: '#60a5fa', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 },
  count: { background: '#1e293b', color: '#94a3b8', borderRadius: 8, padding: '4px 12px', fontSize: 13 },
  select: { padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', padding: '48px 0', fontSize: 14 },
  groupWrapper: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' },
  groupHeader: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', color: '#f1f5f9', cursor: 'pointer', textAlign: 'left' },
  groupImg: { width: 36, height: 36, borderRadius: 7, objectFit: 'cover', flexShrink: 0 },
  groupName: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  groupMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  groupBadge: { fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' },
  gradeChip: { width: 28, height: 28, borderRadius: 6, border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
  groupCount: { fontSize: 12, color: '#64748b', background: '#1e293b', borderRadius: 6, padding: '2px 8px' },
  chevron: { fontSize: 10, color: '#64748b' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, padding: '0 16px 16px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: 28, width: 400, display: 'flex', flexDirection: 'column', gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: 700 },
  modalInfo: { color: '#94a3b8', fontSize: 13 },
  label: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { padding: '9px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 14, outline: 'none' },
  modalActions: { display: 'flex', gap: 10, marginTop: 4 },
  btnCancel: { flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600 },
  btnBid: { flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700 },
};
