import React from 'react';

const fmtUsd = (eth, price) => {
  if (!price || !eth) return null;
  const usd = eth * price;
  return usd >= 1000 ? `≈ $${Math.round(usd).toLocaleString()}` : `≈ $${usd.toFixed(2)}`;
};

const GRADE_COLOR = { A: '#22c55e', B: '#3b82f6', C: '#eab308', D: '#f97316', F: '#ef4444' };
const GRADE_BG    = { A: 'rgba(34,197,94,0.12)', B: 'rgba(59,130,246,0.12)', C: 'rgba(234,179,8,0.12)', D: 'rgba(249,115,22,0.12)', F: 'rgba(239,68,68,0.12)' };
const LIQ_COLOR   = { High: '#22c55e', Med: '#eab308', Low: '#ef4444' };

function getDealGrade(opp) {
  if (opp.dealGrade) return opp.dealGrade;
  const s = opp.score || 0;
  if (s >= 75) return 'A';
  if (s >= 55) return 'B';
  if (s >= 35) return 'C';
  if (s >= 20) return 'D';
  return 'F';
}

export default function OpportunityCard({ opp, onBuy, onBid, onFavorite, isFavorited, ethPrice }) {
  const profitPct = opp.flipEstimate?.profitPct || 0;
  const isProfitable = opp.flipEstimate?.isProfitable;
  const grade = getDealGrade(opp);
  const liq = opp.liquidity;
  const changeDay = opp.oneDayChange || 0;
  const changeHour = opp.oneHourChange || 0;
  const bestOffer = opp.bestOfferEth;

  return (
    <div style={styles.card} className="animate-fadeIn">
      {/* Header: image + name + grade badge */}
      <div style={styles.header}>
        {opp.collectionImage && (
          <img src={opp.collectionImage} alt="" style={styles.img} onError={(e) => { e.target.style.display = 'none'; }} />
        )}
        <div style={styles.info}>
          <div style={styles.name} title={opp.collectionName}>{opp.collectionName}</div>
          <div style={styles.tokenId} className="mono">
            {opp.tokenId ? `#${opp.tokenId}` : opp.collectionSlug}
            {opp.isRare && (
              <span style={styles.rareBadge} title={`Rarity rank #${opp.rarityRank} of ${opp.rarityTotal}`}>
                ✦ RARE
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <div
            style={{ ...styles.gradeBadge, color: GRADE_COLOR[grade], background: GRADE_BG[grade] }}
            title={`Deal grade ${grade} — based on discount vs avg sale price, volume, and momentum`}
          >
            {grade}
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

      {/* Metrics grid */}
      <div style={styles.grid}>
        <Metric
          label="List Price"
          value={`${opp.listingPriceEth?.toFixed(4)} ETH`}
          sub={fmtUsd(opp.listingPriceEth, ethPrice)}
        />
        <Metric
          label={opp.avgSalePriceEth ? 'Avg Sale' : 'Floor'}
          value={`${(opp.avgSalePriceEth || opp.floorPriceEth)?.toFixed(4)} ETH`}
          sub={fmtUsd(opp.avgSalePriceEth || opp.floorPriceEth, ethPrice)}
          hint={opp.avgSalePriceEth ? 'Avg 24h sale — realistic exit price' : 'Floor price (no recent sales data)'}
        />
        <Metric
          label="Est. Profit"
          value={`${profitPct > 0 ? '+' : ''}${profitPct?.toFixed(1)}%`}
          color={isProfitable ? '#22c55e' : '#94a3b8'}
          hint="If sold at avg sale price, after 7.5% fees"
        />
        <Metric
          label="Liquidity"
          value={liq ? liq.grade : '—'}
          color={liq ? LIQ_COLOR[liq.grade] : '#94a3b8'}
          sub={liq?.sales24h > 0 ? `${liq.sales24h} sales today` : null}
          hint="How quickly you could resell — based on daily sales velocity"
        />
      </div>

      {/* Extra info row: best offer + 24h/1h change */}
      {(bestOffer || changeDay !== 0 || changeHour !== 0) && (
        <div style={styles.infoRow}>
          {bestOffer && (
            <div style={styles.infoPill} title="Highest collection bid — you can sell any NFT instantly at this price">
              <span style={styles.infoPillLabel}>Best Offer</span>
              <span style={styles.infoPillVal}>{bestOffer.toFixed(4)} ETH</span>
              {ethPrice && <span style={styles.infoPillSub}>{fmtUsd(bestOffer, ethPrice)}</span>}
            </div>
          )}
          {changeDay !== 0 && (
            <div style={styles.infoPill} title="24-hour volume change vs prior day">
              <span style={styles.infoPillLabel}>24h Chg</span>
              <span style={{ ...styles.infoPillVal, color: changeDay > 0 ? '#22c55e' : '#ef4444' }}>
                {changeDay > 0 ? '+' : ''}{(changeDay * 100).toFixed(0)}%
              </span>
            </div>
          )}
          {changeHour !== 0 && (
            <div style={styles.infoPill} title="1-hour volume change">
              <span style={styles.infoPillLabel}>1h Chg</span>
              <span style={{ ...styles.infoPillVal, color: changeHour > 0 ? '#22c55e' : '#ef4444' }}>
                {changeHour > 0 ? '+' : ''}{(changeHour * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      )}

      <div style={styles.actions}>
        <button style={styles.btnBuy} onClick={() => onBuy?.(opp)}>Buy Now</button>
        <button style={styles.btnBid} onClick={() => onBid?.(opp)}>Place Bid</button>
      </div>
    </div>
  );
}

function Metric({ label, value, color, hint, sub }) {
  return (
    <div style={styles.metric} title={hint}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color: color || '#f1f5f9' }} className="mono">{value}</div>
      {sub && <div style={styles.metricSub}>{sub}</div>}
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
  rareBadge: { display: 'inline-block', marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: 'rgba(234,179,8,0.15)', color: '#eab308', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 },
  gradeBadge: { width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
  heartBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '2px 4px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  metric: { background: '#1e293b', borderRadius: 8, padding: '8px 10px' },
  metricLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  metricValue: { fontSize: 13, fontWeight: 600 },
  metricSub: { fontSize: 10, color: '#475569', marginTop: 2 },
  infoRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  infoPill: { display: 'flex', alignItems: 'center', gap: 5, background: '#1e293b', borderRadius: 7, padding: '5px 9px' },
  infoPillLabel: { fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 },
  infoPillVal: { fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: '#f1f5f9' },
  infoPillSub: { fontSize: 10, color: '#475569' },
  actions: { display: 'flex', gap: 8 },
  btnBuy: {
    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
    background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 13,
  },
  btnBid: {
    flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #334155',
    background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13,
  },
};
