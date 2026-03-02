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

  useEffect(() => {
    favoritesApi.get().then(setFavorites).catch(() => {}).finally(() => setLoading(false));
  }, []);

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

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Favorites</h1>
          <p style={styles.sub}>NFTs you've saved — tied to this session</p>
        </div>
        {favorites.length > 0 && (
          <span style={styles.count}>{favorites.length} saved</span>
        )}
      </div>

      {loading && <div style={styles.empty}>Loading...</div>}

      {!loading && favorites.length === 0 && (
        <div style={styles.empty}>
          No favorites yet. Hit ♡ on any opportunity card in the Scanner to save it here.
        </div>
      )}

      <div style={styles.grid}>
        {favorites.map((opp) => (
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
  empty: { color: '#64748b', textAlign: 'center', padding: '48px 0', fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
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
