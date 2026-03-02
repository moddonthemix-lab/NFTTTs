import React from 'react';

export default function OpportunityCard({ opp, onBuy, onBid, onFavorite, isFavorited }) {
  const profitPct = opp.flipEstimate?.profitPct || 0;
  const isProfitable = opp.flipEstimate?.isProfitable;

  const scoreColor =
    opp.score >= 75 ? '#22c55e' :
    opp.score >= 50 ? '#eab308' :
    '#94a3b8';

  return (
    <div style={styles.card} className="animate-fadeIn">
      <div style={styles.header}>
        {opp.collectionImage && (
          <img src={opp.collectionImage} alt="" style={styles.img} onError={(e) => { e.target.style.display = 'none'; }} />
        )}
        <div style={styles.info}>
          <div style={styles.name} title={opp.collectionName}>{opp.collectionName}</div>
          <div style={styles.tokenId} className="mono">
            {opp.tokenId ? `#${opp.tokenId}` : opp.collectionSlug}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <div style={{ ...styles.score, color: scoreColor }}>
            <div style={styles.scoreNum}>{opp.score}</div>
            <div style={styles.scoreLabel}>score</div>
          </div>
          {onFavorite && (
            <button
              style={{ ...styles.heartBtn, color: isFavorited ? '#f43f5e' : '#475569' }}
              onClick={() => onFavorite(opp)}
              title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFavorited ? '♥' : '♡'}
            </button>
          )}
        </div>
      </div>

      <div style={styles.grid}>
        <Metric label="List Price" value={`${opp.listingPriceEth?.toFixed(4)} ETH`} />
        <Metric
          label={opp.avgSalePriceEth ? 'Avg Sale' : 'Floor'}
          value={`${(opp.avgSalePriceEth || opp.floorPriceEth)?.toFixed(4)} ETH`}
          hint={opp.avgSalePriceEth ? 'Avg 24h sale — realistic exit price' : 'Floor price (no recent sales data)'}
        />
        <Metric
          label="Est. Profit"
          value={`${profitPct > 0 ? '+' : ''}${profitPct?.toFixed(1)}%`}
          color={isProfitable ? '#22c55e' : '#94a3b8'}
          hint="If sold at avg sale price, after 7.5% fees"
        />
        <Metric label="24h Vol" value={`${(opp.oneDayVolume || 0).toFixed(2)} ETH`} />
      </div>

      <div style={styles.actions}>
        <button style={styles.btnBuy} onClick={() => onBuy?.(opp)}>
          Buy Now
        </button>
        <button style={styles.btnBid} onClick={() => onBid?.(opp)}>
          Place Bid
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, color, hint }) {
  return (
    <div style={styles.metric} title={hint}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color: color || '#f1f5f9' }} className="mono">{value}</div>
    </div>
  );
}

const styles = {
  card: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    transition: 'border-color 0.2s',
  },
  header: { display: 'flex', alignItems: 'center', gap: 10 },
  img: { width: 42, height: 42, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
  info: { flex: 1, overflow: 'hidden' },
  name: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tokenId: { fontSize: 11, color: '#64748b', marginTop: 2 },
  score: { textAlign: 'center', flexShrink: 0 },
  scoreNum: { fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', lineHeight: 1 },
  scoreLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  metric: { background: '#1e293b', borderRadius: 8, padding: '8px 10px' },
  metricLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  metricValue: { fontSize: 13, fontWeight: 600 },
  heartBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 4px' },
  actions: { display: 'flex', gap: 8 },
  btnBuy: {
    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
    background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 13,
    transition: 'opacity 0.15s',
  },
  btnBid: {
    flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #334155',
    background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13,
    transition: 'all 0.15s',
  },
};
