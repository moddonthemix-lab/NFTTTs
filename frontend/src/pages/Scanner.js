import React, { useState } from 'react';
import OpportunityCard from '../components/OpportunityCard';
import { botApi, bidsApi, tradesApi, scannerApi } from '../utils/api';

export default function Scanner({ opportunities, scanning }) {
  const [searchSlug, setSearchSlug] = useState('');
  const [collectionResult, setCollectionResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState('score');
  const [filter, setFilter] = useState('all');
  const [bidModal, setBidModal] = useState(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidHours, setBidHours] = useState(24);
  const [actionLoading, setActionLoading] = useState(null);

  const sorted = React.useMemo(() => {
    let list = [...(opportunities || [])];
    if (filter === 'profitable') list = list.filter((o) => o.flipEstimate?.isProfitable);
    if (filter === 'highscore') list = list.filter((o) => o.score >= 70);
    if (sort === 'score') list.sort((a, b) => b.score - a.score);
    else if (sort === 'price') list.sort((a, b) => a.listingPriceEth - b.listingPriceEth);
    else if (sort === 'profit') list.sort((a, b) => (b.flipEstimate?.profitPct || 0) - (a.flipEstimate?.profitPct || 0));
    return list;
  }, [opportunities, sort, filter]);

  const handleScanNow = () => botApi.scan().catch((e) => alert(e.message));

  const handleSearchCollection = async () => {
    if (!searchSlug.trim()) return;
    setSearching(true);
    setCollectionResult(null);
    try {
      const result = await scannerApi.scanCollection(searchSlug.trim());
      setCollectionResult(result);
    } catch (err) {
      alert(err.message);
    }
    setSearching(false);
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

      {/* Search single collection */}
      <div style={styles.searchBox}>
        <input
          style={styles.input}
          placeholder="Search collection by slug (e.g. boredapeyachtclub)"
          value={searchSlug}
          onChange={(e) => setSearchSlug(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearchCollection()}
        />
        <button style={styles.btnSearch} onClick={handleSearchCollection} disabled={searching}>
          {searching ? '...' : 'Search'}
        </button>
      </div>

      {collectionResult && (
        <div style={styles.collectionResult}>
          <div style={styles.crTitle}>
            {collectionResult.collection?.name || searchSlug} — Floor: {collectionResult.stats?.total?.floor_price?.toFixed(4)} ETH
          </div>
          <div style={styles.crGrid}>
            {collectionResult.results?.slice(0, 8).map((r, i) => (
              <div key={i} style={styles.crItem}>
                <span style={styles.crScore} className="mono">{r.score}</span>
                <span className="mono">{r.priceEth?.toFixed(4)} ETH</span>
                <span style={{ color: r.flipEstimate?.isProfitable ? '#22c55e' : '#94a3b8' }} className="mono">
                  {r.flipEstimate?.profitPct > 0 ? '+' : ''}{r.flipEstimate?.profitPct?.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={styles.filterRow}>
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

      <div style={styles.grid}>
        {sorted.map((opp) => (
          <OpportunityCard
            key={opp.id}
            opp={opp}
            onBuy={handleBuy}
            onBid={handleBidOpen}
          />
        ))}
      </div>

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
  searchBox: { display: 'flex', gap: 10 },
  input: { flex: 1, padding: '9px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 14, outline: 'none' },
  btnSearch: { padding: '9px 18px', borderRadius: 9, border: 'none', background: '#1e293b', color: '#94a3b8', fontWeight: 600, fontSize: 14 },
  collectionResult: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 },
  crTitle: { fontWeight: 600, marginBottom: 10 },
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, padding: 28, width: 400, display: 'flex', flexDirection: 'column', gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: 700 },
  modalInfo: { color: '#94a3b8', fontSize: 13 },
  label: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  modalActions: { display: 'flex', gap: 10, marginTop: 4 },
  btnCancel: { flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600 },
  btnBid: { flex: 1, padding: '10px 0', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700 },
};
