import React, { useState, useEffect } from 'react';
import OpportunityCard from '../components/OpportunityCard';
import { botApi, bidsApi, tradesApi, scannerApi, watchlistApi, favoritesApi } from '../utils/api';

const fmtUsd = (eth, price) => {
  if (!price || !eth) return null;
  const usd = eth * price;
  return usd >= 1000 ? `≈ $${Math.round(usd).toLocaleString()}` : `≈ $${usd.toFixed(2)}`;
};

const PAGE_SIZE = 20;

export default function Scanner({ opportunities, scanning, ethPrice }) {
  const [searchSlug, setSearchSlug] = useState('');
  const [searchChain, setSearchChain] = useState('ethereum');
  const [collectionResult, setCollectionResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [watchlist, setWatchlist] = useState([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    watchlistApi.get().then(setWatchlist).catch(() => {});
  }, []);

  const isWatched = (slug) => watchlist.some((w) => w.slug === slug);

  const handleToggleWatch = async (slug, name, image) => {
    if (isWatched(slug)) {
      await watchlistApi.remove(slug).catch(() => {});
      setWatchlist((prev) => prev.filter((w) => w.slug !== slug));
    } else {
      await watchlistApi.add(slug, name, image).catch(() => {});
      setWatchlist((prev) => [...prev, { slug, name, imageUrl: image }]);
    }
  };

  // Favorites (individual NFT opportunities)
  const [favorites, setFavorites] = useState(new Set());
  useEffect(() => {
    favoritesApi.get().then((list) => setFavorites(new Set(list.map((f) => f.id)))).catch(() => {});
  }, []);
  const isFavorited = (id) => favorites.has(id);
  const handleToggleFavorite = async (opp) => {
    if (favorites.has(opp.id)) {
      await favoritesApi.remove(opp.id).catch(() => {});
      setFavorites((prev) => { const n = new Set(prev); n.delete(opp.id); return n; });
    } else {
      await favoritesApi.add(opp).catch(() => {});
      setFavorites((prev) => new Set([...prev, opp.id]));
    }
  };

  // Collection-level favorites (bookmark a whole collection)
  const collectionFavId = (slug) => `col:${slug}`;
  const isCollectionFavorited = (slug) => favorites.has(collectionFavId(slug));
  const handleToggleCollectionFavorite = async (group) => {
    const id = collectionFavId(group.slug);
    if (favorites.has(id)) {
      await favoritesApi.remove(id).catch(() => {});
      setFavorites((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      await favoritesApi.add({
        id,
        type: 'collection',
        collectionSlug: group.slug,
        collectionName: group.name,
        collectionImage: group.image || '',
        floorPriceEth: group.floorPriceEth || 0,
        chain: group.chain || 'ethereum',
      }).catch(() => {});
      setFavorites((prev) => new Set([...prev, id]));
    }
  };

  // Sweep modal
  const [sweepModal, setSweepModal] = useState(null); // { slug, name }
  const [sweepCount, setSweepCount] = useState(3);
  const [sweepMaxPrice, setSweepMaxPrice] = useState('');
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepResult, setSweepResult] = useState(null);

  const handleSnipe = async (slug, name) => {
    if (!window.confirm(`Snipe floor of ${name}? This will immediately buy the cheapest listing.`)) return;
    try {
      const result = await tradesApi.snipe(slug);
      alert(`Sniped! Paid ${result.priceEth?.toFixed(4)} ETH. TX: ${result.txHash}`);
    } catch (err) {
      alert(`Snipe failed: ${err.message}`);
    }
  };

  const handleSweepSubmit = async () => {
    if (!sweepModal) return;
    setSweepLoading(true);
    setSweepResult(null);
    try {
      const result = await tradesApi.sweep(sweepModal.slug, sweepCount, sweepMaxPrice || undefined);
      setSweepResult(result);
    } catch (err) {
      alert(`Sweep failed: ${err.message}`);
    }
    setSweepLoading(false);
  };

  const [sort, setSort] = useState('score');
  const [filter, setFilter] = useState('all');
  const [chainTab, setChainTab] = useState('all'); // 'all' | 'ethereum' | 'base'
  const [bidModal, setBidModal] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidHours, setBidHours] = useState(24);
  const [actionLoading, setActionLoading] = useState(null);

  const [expandedCollections, setExpandedCollections] = useState(new Set());

  const toggleCollection = (slug) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const sorted = React.useMemo(() => {
    let list = [...(opportunities || [])];
    // Chain filter
    if (chainTab === 'ethereum') list = list.filter((o) => (o.chain || 'ethereum') === 'ethereum');
    if (chainTab === 'base') list = list.filter((o) => o.chain === 'base');
    // Opportunity filter
    if (filter === 'profitable') list = list.filter((o) => o.flipEstimate?.isProfitable);
    if (filter === 'highscore') list = list.filter((o) => o.score >= 70);
    if (sort === 'score') list.sort((a, b) => b.score - a.score);
    else if (sort === 'price') list.sort((a, b) => a.listingPriceEth - b.listingPriceEth);
    else if (sort === 'profit') list.sort((a, b) => (b.flipEstimate?.profitPct || 0) - (a.flipEstimate?.profitPct || 0));
    return list;
  }, [opportunities, sort, filter, chainTab]);

  // Reset page when filter/sort/chain changes
  React.useEffect(() => setPage(0), [opportunities, filter, sort, chainTab]);

  // Group sorted listings by collection, preserving inter-collection order by best score
  const grouped = React.useMemo(() => {
    const map = new Map();
    for (const opp of sorted) {
      const slug = opp.collectionSlug;
      if (!map.has(slug)) {
        map.set(slug, {
          slug,
          name: opp.collectionName,
          image: opp.collectionImage,
          floorPriceEth: opp.floorPriceEth,
          oneDayVolume: opp.oneDayVolume,
          chain: opp.chain || 'ethereum',
          listings: [],
        });
      }
      map.get(slug).listings.push(opp);
    }
    return Array.from(map.values());
  }, [sorted]);

  const handleScanNow = () => botApi.scan().catch((e) => alert(e.message));

  const [searchResults, setSearchResults] = useState([]);   // list of collection objects from search
  const [scannedResult, setScannedResult] = useState(null); // detailed scan of one picked collection
  const [scanningSlug, setScanningSlug] = useState(null);   // which slug is being deep-scanned

  const handleSearchCollection = async () => {
    if (!searchSlug.trim()) return;
    setSearching(true);
    setSearchResults([]);
    setScannedResult(null);
    try {
      const { collections } = await scannerApi.search(searchSlug.trim(), searchChain);
      setSearchResults(collections || []);
    } catch (err) {
      alert(err.message);
    }
    setSearching(false);
  };

  const handleDeepScan = async (slug) => {
    setScanningSlug(slug);
    setScannedResult(null);
    try {
      const result = await scannerApi.scanCollection(slug);
      setScannedResult(result);
    } catch (err) {
      alert(err.message);
    }
    setScanningSlug(null);
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

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Scanner</h1>
          <p style={styles.sub}>Live OpenSea opportunity scanner</p>
        </div>
        <button style={styles.btnScan} onClick={handleScanNow} disabled={scanning}>
          {scanning ? (
            <><span className="animate-spin" style={{ display: 'inline-block' }}>⟳</span> Scanning...</>
          ) : '⊕ Run Scan'}
        </button>
      </div>

      {/* Search */}
      <div style={styles.searchBox}>
        <div style={styles.chainToggle}>
          {[{ key: 'ethereum', label: 'ETH' }, { key: 'base', label: 'BASE' }].map(({ key, label }) => (
            <button
              key={key}
              style={{ ...styles.chainBtn, ...(searchChain === key ? styles.chainBtnActive : {}) }}
              onClick={() => setSearchChain(key)}
              title={key === 'ethereum' ? 'Search Ethereum collections' : 'Search Base network collections'}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          style={{ ...styles.input, flex: 1 }}
          placeholder={`Search ${searchChain === 'base' ? 'Base' : 'Ethereum'} by name, slug, or 0x contract`}
          value={searchSlug}
          onChange={(e) => { setSearchSlug(e.target.value); setSearchResults([]); setScannedResult(null); }}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchCollection()}
        />
        <button style={styles.btnSearch} onClick={handleSearchCollection} disabled={searching}>
          {searching ? '...' : 'Search'}
        </button>
      </div>

      {/* Search results list */}
      {searchResults.length > 0 && (
        <div style={styles.searchResultsPanel}>
          <div style={styles.srHeader}>
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for "{searchSlug}"
            <button style={styles.srClose} onClick={() => { setSearchResults([]); setScannedResult(null); }}>×</button>
          </div>
          <div style={styles.srList}>
            {searchResults.map((col) => {
              const slug = col.collection || col.slug;
              const contract = col.contracts?.[0]?.address || '';
              const watched = isWatched(slug);
              return (
                <div key={slug} style={styles.srRow}>
                  {col.image_url
                    ? <img src={col.image_url} alt="" style={styles.srImg} onError={(e) => { e.target.style.display = 'none'; }} />
                    : <div style={styles.srImgPlaceholder} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.srName}>{col.name || slug}</div>
                    <div style={styles.srMeta} className="mono">
                      {slug}
                      {contract && <span style={styles.srContract}> · {contract.slice(0, 6)}…{contract.slice(-4)}</span>}
                    </div>
                  </div>
                  <div style={styles.srActions}>
                    <button
                      style={styles.srScanBtn}
                      onClick={() => handleDeepScan(slug)}
                      disabled={scanningSlug === slug}
                    >
                      {scanningSlug === slug ? '...' : 'Scan'}
                    </button>
                    <button
                      style={watched ? styles.btnGroupUnwatch : styles.btnGroupWatch}
                      onClick={() => handleToggleWatch(slug, col.name, col.image_url)}
                      title={watched ? 'Remove from snipe list' : 'Add to snipe list'}
                    >
                      {watched ? '★' : '☆'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Deep scan result — full cards with buy/bid/favorite */}
          {scannedResult && (
            <div style={styles.deepScan}>
              <div style={styles.dsTitleRow}>
                <span style={styles.dsTitle}>{scannedResult.collection?.name} — Floor: {scannedResult.stats?.total?.floor_price?.toFixed(4)} ETH</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={styles.btnSnipe} onClick={() => handleSnipe(scannedResult.collection?.collection || searchSlug.trim(), scannedResult.collection?.name)}>⚡ Snipe</button>
                  <button style={styles.btnSweep} onClick={() => { setSweepModal({ slug: scannedResult.collection?.collection || searchSlug.trim(), name: scannedResult.collection?.name }); setSweepResult(null); setSweepCount(3); setSweepMaxPrice(''); }}>▣ Sweep</button>
                </div>
              </div>
              <div style={styles.grid}>
                {scannedResult.results?.slice(0, 20).map((r, i) => {
                  const slug = scannedResult.collection?.collection || searchSlug.trim();
                  const opp = {
                    id: r.listing?.order_hash || `${slug}_${i}`,
                    collectionSlug: slug,
                    collectionName: scannedResult.collection?.name || slug,
                    collectionImage: scannedResult.collection?.image_url || '',
                    listingPriceEth: r.priceEth,
                    floorPriceEth: scannedResult.stats?.total?.floor_price || 0,
                    score: r.score,
                    dealGrade: r.dealGrade,
                    liquidity: scannedResult.liquidity,
                    bestOfferEth: scannedResult.bestOfferEth || null,
                    isRare: r.isRare || false,
                    rarityRank: r.rarityRank,
                    rarityTotal: r.rarityTotal,
                    flipEstimate: r.flipEstimate,
                    oneDayVolume: 0,
                    listing: r.listing,
                  };
                  return (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      onBuy={handleBuy}
                      onBid={handleBidOpen}
                      onFavorite={handleToggleFavorite}
                      isFavorited={isFavorited(opp.id)}
                      ethPrice={ethPrice}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {searching && searchResults.length === 0 && (
        <div style={styles.srSearching}>Searching...</div>
      )}

      {/* Filters */}
      <div style={styles.filterRow}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={styles.filterGroup}>
            {[{ key: 'all', label: 'All' }, { key: 'ethereum', label: 'ETH' }, { key: 'base', label: 'BASE' }].map(({ key, label }) => (
              <button
                key={key}
                style={{ ...styles.filterBtn, ...(chainTab === key ? styles.filterActive : {}) }}
                onClick={() => setChainTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={styles.filterGroup}>
            {['all', 'profitable', 'highscore'].map((f) => (
              <button
                key={f}
                style={{ ...styles.filterBtn, ...(filter === f ? styles.filterActive : {}) }}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'profitable' ? 'Profitable' : 'High Score'}
              </button>
            ))}
          </div>
        </div>
        <select style={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="score">Sort: Score</option>
          <option value="price">Sort: Price ↑</option>
          <option value="profit">Sort: Profit %</option>
        </select>
      </div>

      {scanning && (
        <div style={styles.scanningBanner}>
          <span className="animate-spin" style={{ display: 'inline-block', marginRight: 8 }}>⟳</span>
          Scanning OpenSea collections...
        </div>
      )}

      {!scanning && sorted.length === 0 && (
        <div style={styles.empty}>
          No opportunities found. Click "Run Scan" to search for NFTs to flip.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grouped.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((group) => {
          const isExpanded = expandedCollections.has(group.slug);
          const best = group.listings[0];
          const bestGrade = best?.dealGrade || (best?.score >= 75 ? 'A' : best?.score >= 55 ? 'B' : best?.score >= 35 ? 'C' : best?.score >= 20 ? 'D' : 'F');
          const gradeColor = { A: '#22c55e', B: '#3b82f6', C: '#eab308', D: '#f97316', F: '#ef4444' }[bestGrade] || '#94a3b8';
          const dayChange = best?.oneDayChange || 0;
          return (
            <div key={group.slug} style={styles.groupWrapper}>
              {/* Collection header / toggle */}
              <button style={styles.groupHeader} onClick={() => toggleCollection(group.slug)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  {group.image && (
                    <img src={group.image} alt="" style={styles.groupImg}
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.groupName}>
                      {group.name}
                      {group.chain === 'base' && <span style={styles.chainBadge}>BASE</span>}
                    </div>
                    <div style={styles.groupMeta} className="mono">
                      Floor {group.floorPriceEth?.toFixed(4)} ETH
                      {ethPrice && group.floorPriceEth ? ` (${fmtUsd(group.floorPriceEth, ethPrice)})` : ''}
                      &nbsp;·&nbsp; Vol {(group.oneDayVolume || 0).toFixed(2)} ETH
                      {dayChange !== 0 && (
                        <span style={{ marginLeft: 6, color: dayChange > 0 ? '#22c55e' : '#ef4444' }}>
                          {dayChange > 0 ? '▲' : '▼'}{Math.abs(dayChange * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ ...styles.gradeChip, color: gradeColor, borderColor: gradeColor }}>{bestGrade}</div>
                  <span style={styles.groupCount}>{group.listings.length} listing{group.listings.length !== 1 ? 's' : ''}</span>
                  <button
                    style={styles.btnSnipe}
                    onClick={(e) => { e.stopPropagation(); handleSnipe(group.slug, group.name); }}
                    title="Snipe floor — buy the single cheapest listing now"
                  >⚡ Snipe</button>
                  <button
                    style={styles.btnSweep}
                    onClick={(e) => { e.stopPropagation(); setSweepModal({ slug: group.slug, name: group.name }); setSweepResult(null); setSweepCount(3); setSweepMaxPrice(''); }}
                    title="Sweep — buy multiple from the floor"
                  >▣ Sweep</button>
                  <button
                    style={isCollectionFavorited(group.slug) ? styles.btnGroupFavActive : styles.btnGroupFav}
                    onClick={(e) => { e.stopPropagation(); handleToggleCollectionFavorite(group); }}
                    title={isCollectionFavorited(group.slug) ? 'Remove from Favorites' : 'Save to Favorites'}
                  >
                    {isCollectionFavorited(group.slug) ? '♥' : '♡'}
                  </button>
                  <span style={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Listings grid */}
              {isExpanded && (
                <div style={styles.grid}>
                  {group.listings.map((opp) => (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      onBuy={handleBuy}
                      onBid={handleBidOpen}
                      onFavorite={handleToggleFavorite}
                      isFavorited={isFavorited(opp.id)}
                      ethPrice={ethPrice}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {grouped.length > PAGE_SIZE && (
        <div style={styles.pagination}>
          <button
            style={{ ...styles.pageBtn, opacity: page === 0 ? 0.3 : 1 }}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >← Prev</button>
          <span style={styles.pageInfo}>
            {page + 1} / {Math.ceil(grouped.length / PAGE_SIZE)}
            &nbsp;<span style={{ color: '#475569' }}>({grouped.length} collections)</span>
          </span>
          <button
            style={{ ...styles.pageBtn, opacity: page >= Math.ceil(grouped.length / PAGE_SIZE) - 1 ? 0.3 : 1 }}
            onClick={() => setPage((p) => Math.min(Math.ceil(grouped.length / PAGE_SIZE) - 1, p + 1))}
            disabled={page >= Math.ceil(grouped.length / PAGE_SIZE) - 1}
          >Next →</button>
        </div>
      )}

      {/* Sweep Modal */}
      {sweepModal && (
        <div style={styles.overlay} onClick={() => { setSweepModal(null); setSweepResult(null); }}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>▣ Sweep — {sweepModal.name}</h2>
            <div style={styles.modalInfo}>Buys the cheapest N listings sequentially from this collection.</div>
            <label style={styles.label}>Number of NFTs (1–100)</label>
            <input style={styles.input} type="number" min="1" max="100" value={sweepCount} onChange={(e) => setSweepCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))} />
            <label style={styles.label}>Max price per NFT (ETH, leave blank for no limit)</label>
            <input style={styles.input} type="number" step="0.001" placeholder="e.g. 0.5" value={sweepMaxPrice} onChange={(e) => setSweepMaxPrice(e.target.value)} />
            {sweepResult && (
              <div style={{ background: '#0f172a', borderRadius: 8, padding: 12, fontSize: 13 }}>
                <div style={{ color: '#22c55e', fontWeight: 700, marginBottom: 6 }}>
                  Bought {sweepResult.bought} / {sweepResult.attempted}
                </div>
                {sweepResult.results?.map((r, i) => (
                  <div key={i} style={{ color: r.success ? '#94a3b8' : '#ef4444', marginBottom: 2 }} className="mono">
                    #{i + 1} {r.priceEth?.toFixed(4)} ETH — {r.success ? `✓ ${r.txHash?.slice(0, 10)}…` : `✗ ${r.error}`}
                  </div>
                ))}
              </div>
            )}
            <div style={styles.modalActions}>
              <button style={styles.btnCancel} onClick={() => { setSweepModal(null); setSweepResult(null); }}>Close</button>
              <button style={styles.btnBid} onClick={handleSweepSubmit} disabled={sweepLoading}>
                {sweepLoading ? `Buying…` : `Sweep ${sweepCount}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bid Modal */}
      {bidModal && (
        <div style={styles.overlay} onClick={() => setBidModal(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Place Bid — {bidModal.collectionName}</h2>
            <div style={styles.modalInfo}>
              Floor: <b>{bidModal.floorPriceEth?.toFixed(4)} ETH</b>
            </div>
            <label style={styles.label}>Bid Amount (ETH)</label>
            <input
              style={styles.input}
              type="number"
              step="0.001"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
            />
            <label style={styles.label}>Expiration (hours)</label>
            <input
              style={styles.input}
              type="number"
              value={bidHours}
              onChange={(e) => setBidHours(e.target.value)}
            />
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
  btnScan: { padding: '9px 18px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 14 },
  searchBox: { display: 'flex', gap: 10, alignItems: 'center' },
  chainToggle: { display: 'flex', borderRadius: 9, overflow: 'hidden', border: '1px solid #334155', flexShrink: 0 },
  chainBtn: { padding: '9px 12px', border: 'none', background: '#1e293b', color: '#64748b', fontWeight: 700, fontSize: 11, cursor: 'pointer', letterSpacing: 0.5 },
  chainBtnActive: { background: '#6366f1', color: '#fff' },
  input: { padding: '9px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 14, outline: 'none' },
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '8px 0' },
  pageBtn: { padding: '7px 16px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  pageInfo: { fontSize: 13, color: '#94a3b8', fontFamily: 'JetBrains Mono, monospace' },
  btnSearch: { padding: '9px 18px', borderRadius: 9, border: 'none', background: '#1e293b', color: '#94a3b8', fontWeight: 600, fontSize: 14 },
  collectionResult: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 },
  crTitle: { fontWeight: 600, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  watchlistPanel: { background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px' },
  watchlistTitle: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  watchlistChips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  watchChip: { display: 'flex', alignItems: 'center', gap: 6, background: '#1e293b', border: '1px solid #334155', borderRadius: 20, padding: '4px 10px 4px 6px' },
  watchChipImg: { width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' },
  watchChipName: { fontSize: 12, color: '#cbd5e1', fontWeight: 500 },
  watchChipRemove: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 },
  btnWatch: { padding: '4px 12px', borderRadius: 8, border: '1px solid #6366f1', background: 'transparent', color: '#818cf8', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btnUnwatch: { padding: '4px 12px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btnGroupWatch: { padding: '3px 8px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 13, cursor: 'pointer' },
  btnGroupUnwatch: { padding: '3px 8px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, cursor: 'pointer' },
  btnGroupFav: { padding: '3px 8px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: 14, cursor: 'pointer' },
  btnGroupFavActive: { padding: '3px 8px', borderRadius: 6, border: 'none', background: '#7f1d1d', color: '#f87171', fontSize: 14, cursor: 'pointer' },
  searchResultsPanel: { background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' },
  srHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', fontSize: 12, color: '#64748b', borderBottom: '1px solid #1e293b' },
  srClose: { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  srList: { display: 'flex', flexDirection: 'column' },
  srRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #1e293b' },
  srImg: { width: 36, height: 36, borderRadius: 7, objectFit: 'cover', flexShrink: 0 },
  srImgPlaceholder: { width: 36, height: 36, borderRadius: 7, background: '#1e293b', flexShrink: 0 },
  srName: { fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  srMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  srContract: { color: '#475569' },
  srActions: { display: 'flex', gap: 6, flexShrink: 0 },
  srScanBtn: { padding: '4px 12px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  srSearching: { color: '#64748b', fontSize: 13, textAlign: 'center', padding: '12px 0' },
  deepScan: { padding: 14, borderTop: '1px solid #1e293b', background: '#070d1a' },
  dsTitleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' },
  dsTitle: { fontWeight: 600, fontSize: 13 },
  btnSnipe: { padding: '4px 10px', borderRadius: 6, border: 'none', background: '#854d0e', color: '#fbbf24', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  btnSweep: { padding: '4px 10px', borderRadius: 6, border: 'none', background: '#1e3a5f', color: '#60a5fa', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  crGrid: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  crItem: { background: '#1e293b', borderRadius: 8, padding: '6px 12px', display: 'flex', gap: 10, fontSize: 13 },
  crScore: { color: '#6366f1', fontWeight: 700 },
  filterRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  filterGroup: { display: 'flex', gap: 6 },
  filterBtn: { padding: '6px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 13, fontWeight: 500 },
  filterActive: { background: '#6366f1', color: '#fff', borderColor: '#6366f1' },
  select: { padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', fontSize: 13 },
  scanningBanner: { background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '12px 16px', color: '#818cf8', fontSize: 13 },
  empty: { color: '#64748b', textAlign: 'center', padding: '48px 0', fontSize: 14 },
  groupWrapper: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' },
  groupHeader: { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', color: '#f1f5f9', cursor: 'pointer', textAlign: 'left' },
  groupImg: { width: 36, height: 36, borderRadius: 7, objectFit: 'cover', flexShrink: 0 },
  groupName: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  groupMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  groupBadge: { fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' },
  gradeChip: { width: 28, height: 28, borderRadius: 6, border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
  chainBadge: { display: 'inline-block', marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: '#1e3a5f', color: '#60a5fa', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, verticalAlign: 'middle' },
  groupCount: { fontSize: 12, color: '#64748b', background: '#1e293b', borderRadius: 6, padding: '2px 8px' },
  chevron: { fontSize: 10, color: '#64748b' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, padding: '0 16px 16px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: 28, width: 400, display: 'flex', flexDirection: 'column', gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: 700 },
  modalInfo: { color: '#94a3b8', fontSize: 13 },
  label: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  modalActions: { display: 'flex', gap: 10, marginTop: 4 },
  btnCancel: { flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600 },
  btnBid: { flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700 },
};
