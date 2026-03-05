import React, { useState } from 'react';
import { format } from 'date-fns';

export default function Trades({ trades }) {
  const [filter, setFilter] = useState('all');

  const filtered = (trades || []).filter((t) => filter === 'all' || t.type === filter);
  const totalProfit = (trades || [])
    .filter((t) => t.type === 'sell' || t.type === 'accept_offer')
    .reduce((s, t) => s + (t.profitEth || 0), 0);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Trade History</h1>
          <p style={styles.sub}>{(trades || []).length} total trades</p>
        </div>
        <div style={styles.profitBadge}>
          <span style={styles.profitLabel}>Total Profit</span>
          <span style={{ ...styles.profitVal, color: totalProfit >= 0 ? '#22c55e' : '#ef4444' }} className="mono">
            {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(6)} ETH
          </span>
        </div>
      </div>

      <div style={styles.filterRow}>
        {['all', 'buy', 'sell', 'list', 'bid'].map((f) => (
          <button
            key={f}
            style={{ ...styles.filterBtn, ...(filter === f ? styles.filterActive : {}) }}
            onClick={() => setFilter(f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {!filtered.length ? (
        <div style={styles.empty}>No trades yet.</div>
      ) : (
        <div style={styles.tableWrap}>
          <div style={styles.thead}>
            <span>Type</span>
            <span>Collection</span>
            <span>Token ID</span>
            <span>Price</span>
            <span>Profit</span>
            <span>TX / Order</span>
            <span>Time</span>
          </div>
          {filtered.map((t, i) => (
            <div key={i} style={{ ...styles.trow, background: i % 2 === 0 ? '#0f172a' : 'transparent' }}>
              <span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  background: t.type === 'buy' ? 'rgba(99,102,241,0.15)' : t.type === 'sell' ? 'rgba(34,197,94,0.15)' : t.type === 'list' ? 'rgba(168,85,247,0.15)' : 'rgba(234,179,8,0.15)',
                  color: t.type === 'buy' ? '#818cf8' : t.type === 'sell' ? '#22c55e' : t.type === 'list' ? '#a855f7' : '#eab308',
                }}>
                  {t.type?.toUpperCase()}
                </span>
              </span>
              <span style={styles.colTrunc}>{t.collectionName || t.collectionSlug || '—'}</span>
              <span className="mono">{t.tokenId ? `#${t.tokenId}` : '—'}</span>
              <span className="mono">{(t.priceEth || 0).toFixed(4)} ETH</span>
              <span className="mono" style={{ color: (t.profitEth || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                {t.profitEth != null ? `${t.profitEth >= 0 ? '+' : ''}${t.profitEth.toFixed(4)}` : '—'}
              </span>
              <span className="mono" style={{ fontSize: 11, color: '#64748b' }}>
                {t.txHash ? `${t.txHash.slice(0, 8)}...` : t.orderHash ? `${t.orderHash.slice(0, 8)}...` : '—'}
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {t.timestamp ? format(new Date(t.timestamp), 'MMM d, HH:mm') : '—'}
              </span>
            </div>
          ))}
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
  profitBadge: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  profitLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  profitVal: { fontSize: 20, fontWeight: 700 },
  filterRow: { display: 'flex', gap: 6 },
  filterBtn: { padding: '6px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12, fontWeight: 600 },
  filterActive: { background: '#6366f1', color: '#fff', borderColor: '#6366f1' },
  empty: { textAlign: 'center', color: '#64748b', padding: '48px 0', fontSize: 14 },
  tableWrap: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' },
  thead: { display: 'grid', gridTemplateColumns: '80px 1fr 90px 110px 110px 110px 120px', gap: 8, padding: '10px 16px', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #1e293b' },
  trow: { display: 'grid', gridTemplateColumns: '80px 1fr 90px 110px 110px 110px 120px', gap: 8, padding: '10px 16px', fontSize: 13, alignItems: 'center' },
  colTrunc: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
};
