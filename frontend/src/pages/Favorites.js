import React, { useState, useEffect, useRef } from 'react';
import OpportunityCard from '../components/OpportunityCard';
import { favoritesApi, tradesApi, bidsApi, scannerApi } from '../utils/api';

export default function Favorites() {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [bidModal, setBidModal] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidHours, setBidHours] = useState(24);
  const [sort, setSort] = useState('saved');

  // Expanded state for both collection-bookmarks and NFT-opportunity groups
  const [expandedCollections, setExpandedCollections] = useState(new Set());

  // Live listings fetched when a bookmarked collection is expanded
  const [colListings, setColListings] = useState({}); // { slug: { status:'loading'|'done', results:[] } }

  // NFT images lazy-loaded per token
  const [nftImages, setNftImages] = useState({});
  const fetchedNftImages = useRef(new Set());

  const refreshFavorites = React.useCallback(() => {
    favoritesApi.get().then((list) => {
      setFavorites(list);
      setExpandedCollections((prev) => {
        // Auto-expand NFT groups that aren't yet tracked
        const newSlugs = list.filter((f) => f.type !== 'collection').map((f) => f.collectionSlug || 'unknown');
        const next = new Set(prev);
        newSlugs.forEach((s) => next.add(s));
        return next;
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refreshFavorites();
    const interval = setInterval(refreshFavorites, 90_000); // refresh every 90s
    return () => clearInterval(interval);
  }, [refreshFavorites]);

  const toggleCollection = (slug, isColFav = false) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) { next.delete(slug); return next; }
      next.add(slug);
      // Fetch live listings on first expand of a bookmarked collection
      if (isColFav && !colListings[slug]) {
        const colChain = favorites.find((f) => f.collectionSlug === slug)?.chain || 'ethereum';
        setColListings((p) => ({ ...p, [slug]: { status: 'loading', results: [] } }));
        scannerApi.scanCollection(slug, colChain)
          .then((data) => {
            const results = (data.results || []).slice(0, 10).map((r, i) => ({
              id: r.listing?.order_hash || `${slug}_fav_${i}`,
              collectionSlug: slug,
              collectionName: data.collection?.name || slug,
              collectionImage: r.nftImageUrl || data.collection?.image_url || '',
              listingPriceEth: r.priceEth,
              floorPriceEth: data.stats?.total?.floor_price || 0,
              score: r.score,
              dealGrade: r.dealGrade,
              liquidity: data.liquidity,
              bestOfferEth: data.bestOfferEth || null,
              isRare: r.isRare || false,
              rarityRank: r.rarityRank,
              rarityTotal: r.rarityTotal,
              flipEstimate: r.flipEstimate,
              oneDayVolume: data.stats?.intervals?.find((iv) => iv.interval === 'one_day')?.volume || 0,
              listing: r.listing,
            }));
            setColListings((p) => ({ ...p, [slug]: { status: 'done', results } }));
          })
          .catch(() => setColListings((p) => ({ ...p, [slug]: { status: 'error', results: [] } })));
      }
      return next;
    });
  };

  // Separate collection bookmarks from NFT opportunity favorites
  const collectionFavs = React.useMemo(() =>
    favorites.filter((f) => f.type === 'collection').sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0)),
  [favorites]);

  // Sort and group NFT opportunities by collection
  const sorted = React.useMemo(() => {
    const list = favorites.filter((f) => f.type !== 'collection');
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
        map.set(slug, { slug, name: opp.collectionName || slug, image: opp.collectionImage || null, floorPriceEth: opp.floorPriceEth, listings: [] });
      }
      map.get(slug).listings.push(opp);
    }
    return Array.from(map.values());
  }, [sorted]);

  // Lazy-fetch NFT images when a group is expanded — must be after `grouped` is defined
  useEffect(() => {
    const allOpps = [
      ...sorted,
      ...Object.values(colListings).flatMap((c) => c.results || []),
    ];
    expandedCollections.forEach((slug) => {
      allOpps.filter((o) => o.collectionSlug === slug).forEach((opp) => {
        const key = `${opp.contractAddress}_${opp.tokenId}`;
        if (fetchedNftImages.current.has(key) || !opp.contractAddress || !opp.tokenId) return;
        fetchedNftImages.current.add(key);
        scannerApi.getNFTImage(opp.chain || 'ethereum', opp.contractAddress, opp.tokenId)
          .then((url) => { if (url) setNftImages((p) => ({ ...p, [key]: url })); })
          .catch(() => {});
      });
    });
  }, [expandedCollections, sorted, colListings]);

  const handleRemoveFavorite = async (opp) => {
    await favoritesApi.remove(opp.id).catch(() => {});
    setFavorites((prev) => prev.filter((f) => f.id !== opp.id));
  };

  const handleRemoveCollectionFav = async (id) => {
    await favoritesApi.remove(id).catch(() => {});
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  };

  const handleBuy = async (opp) => {
    if (!window.confirm(`Buy ${opp.collectionName} #${opp.tokenId} for ${opp.listingPriceEth} ETH?`)) return;
    setActionLoading(opp.id);
    try { await tradesApi.buy(opp.listing); alert('Buy order sent!'); }
    catch (err) { alert(`Buy failed: ${err.message}`); }
    setActionLoading(null);
  };

  const handleBidOpen = (opp) => { setBidModal(opp); setBidAmount((opp.floorPriceEth * 0.85).toFixed(4)); };

  const handleBidSubmit = async () => {
    if (!bidModal || !bidAmount) return;
    setActionLoading(bidModal.id);
    try {
      await bidsApi.place(bidModal.collectionSlug, parseFloat(bidAmount), parseInt(bidHours));
      alert(`Bid placed on ${bidModal.collectionSlug}!`);
      setBidModal(null);
    } catch (err) { alert(`Bid failed: ${err.message}`); }
    setActionLoading(null);
  };

  const renderCard = (opp, onFav, isFav) => {
    const nftKey = `${opp.contractAddress}_${opp.tokenId}`;
    const enriched = { ...opp, collectionImage: nftImages[nftKey] || opp.collectionImage };
    return (
      <OpportunityCard
        key={opp.id}
        opp={enriched}
        onBuy={handleBuy}
        onBid={handleBidOpen}
        onFavorite={onFav}
        isFavorited={isFav}
      />
    );
  };

  const gradeColor = (g) => ({ A: '#22c55e', B: '#3b82f6', C: '#eab308', D: '#f97316', F: '#ef4444' }[g] || '#94a3b8');

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Favorites</h1>
          <p style={styles.sub}>Saved collections and NFT opportunities</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {favorites.length > 0 && <span style={styles.count}>{favorites.length} saved</span>}
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
          No favorites yet — hit ♡ on collection headers or NFT cards in the Scanner to save here.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Bookmarked collections — expand to show live listings */}
        {collectionFavs.map((col) => {
          const isExpanded = expandedCollections.has(col.collectionSlug);
          const liveData = colListings[col.collectionSlug];
          return (
            <div key={col.id} style={styles.groupWrapper}>
              <button style={styles.groupHeader} onClick={() => toggleCollection(col.collectionSlug, true)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {col.collectionImage
                    ? <img src={col.collectionImage} alt="" style={styles.groupImg} onError={(e) => { e.target.style.display = 'none'; }} />
                    : <div style={styles.groupImgPlaceholder} />
                  }
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.groupName}>{col.collectionName || col.collectionSlug}</div>
                    <div style={styles.groupMeta} className="mono">
                      {col.floorPriceEth ? `Floor ${col.floorPriceEth.toFixed(4)} ETH` : col.collectionSlug}
                      {col.chain === 'base' && <span style={styles.chainBadge}>BASE</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={styles.colBadge}>Collection</span>
                  <button
                    style={styles.colFavRemove}
                    onClick={(e) => { e.stopPropagation(); handleRemoveCollectionFav(col.id); }}
                    title="Remove from Favorites"
                  >♥</button>
                  <span style={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div style={{ padding: '0 16px 16px' }}>
                  {!liveData || liveData.status === 'loading'
                    ? <div style={styles.loadingRow}>Scanning {col.collectionName || col.collectionSlug}...</div>
                    : liveData.status === 'error'
                    ? <div style={styles.loadingRow}>Failed to load listings.</div>
                    : liveData.results.length === 0
                    ? <div style={styles.loadingRow}>No listings found.</div>
                    : <div style={styles.grid}>{liveData.results.map((opp) => renderCard(opp, null, false))}</div>
                  }
                </div>
              )}
            </div>
          );
        })}

        {/* Saved NFT opportunity groups */}
        {grouped.map((group) => {
          const isExpanded = expandedCollections.has(group.slug);
          const best = group.listings[0];
          const bestGrade = best?.dealGrade || (best?.score >= 75 ? 'A' : best?.score >= 55 ? 'B' : best?.score >= 35 ? 'C' : 'F');
          return (
            <div key={group.slug} style={styles.groupWrapper}>
              <button style={styles.groupHeader} onClick={() => toggleCollection(group.slug, false)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {group.image
                    ? <img src={group.image} alt="" style={styles.groupImg} onError={(e) => { e.target.style.display = 'none'; }} />
                    : <div style={styles.groupImgPlaceholder} />
                  }
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.groupName}>{group.name}</div>
                    <div style={styles.groupMeta} className="mono">
                      {group.floorPriceEth ? `Floor ${group.floorPriceEth.toFixed(4)} ETH` : group.slug}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ ...styles.gradeChip, color: gradeColor(bestGrade), borderColor: gradeColor(bestGrade) }}>{bestGrade}</div>
                  <span style={styles.groupCount}>{group.listings.length} saved</span>
                  <span style={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div style={styles.grid}>
                  {group.listings.map((opp) => renderCard(opp, handleRemoveFavorite, true))}
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
  count: { background: '#1e293b', color: '#94a3b8', borderRadius: 8, padding: '4px 12px', fontSize: 13 },
  select: { padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', padding: '48px 0', fontSize: 14 },
  groupWrapper: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' },
  groupHeader: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', color: '#f1f5f9', cursor: 'pointer', textAlign: 'left' },
  groupImg: { width: 36, height: 36, borderRadius: 7, objectFit: 'cover', flexShrink: 0 },
  groupImgPlaceholder: { width: 36, height: 36, borderRadius: 7, background: '#1e293b', flexShrink: 0 },
  groupName: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  groupMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  gradeChip: { width: 28, height: 28, borderRadius: 6, border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
  groupCount: { fontSize: 12, color: '#64748b', background: '#1e293b', borderRadius: 6, padding: '2px 8px' },
  colBadge: { fontSize: 10, color: '#818cf8', background: '#1e1b4b', borderRadius: 5, padding: '2px 7px', fontWeight: 600, letterSpacing: 0.3 },
  colFavRemove: { background: '#7f1d1d', border: 'none', color: '#f87171', borderRadius: 6, padding: '4px 8px', fontSize: 13, cursor: 'pointer', flexShrink: 0 },
  chainBadge: { display: 'inline-block', marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: '#1e3a5f', color: '#60a5fa', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 },
  chevron: { fontSize: 10, color: '#64748b' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, padding: '0 16px 16px' },
  loadingRow: { color: '#64748b', fontSize: 13, padding: '16px 0', textAlign: 'center' },
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
