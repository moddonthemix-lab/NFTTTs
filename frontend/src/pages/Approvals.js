import React, { useState } from 'react';
import { approvalsApi } from '../utils/api';
import { format } from 'date-fns';

export default function Approvals({ pendingApprovals }) {
  const [loading, setLoading] = useState({});

  const handle = async (id, action) => {
    setLoading((prev) => ({ ...prev, [id]: true }));
    try {
      if (action === 'approve') await approvalsApi.approve(id);
      else await approvalsApi.reject(id);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
    setLoading((prev) => ({ ...prev, [id]: false }));
  };

  const pending = (pendingApprovals || []).filter((a) => a.status === 'pending');

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Approvals</h1>
      <p style={styles.sub}>
        {pending.length > 0
          ? `${pending.length} trade${pending.length > 1 ? 's' : ''} waiting for your approval`
          : 'No pending approvals'}
      </p>

      {pending.length === 0 && (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>✓</div>
          <div>All caught up. The bot will queue trades here when <b>AUTO_TRADE=false</b>.</div>
        </div>
      )}

      <div style={styles.list}>
        {pending.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            loading={loading[approval.id]}
            onApprove={() => handle(approval.id, 'approve')}
            onReject={() => handle(approval.id, 'reject')}
          />
        ))}
      </div>
    </div>
  );
}

function ApprovalCard({ approval, loading, onApprove, onReject }) {
  const actionColor = {
    buy: '#6366f1',
    sell: '#22c55e',
    bid: '#eab308',
  }[approval.action] || '#94a3b8';

  return (
    <div style={styles.card} className="animate-fadeIn">
      <div style={styles.cardHeader}>
        <span style={{ ...styles.actionBadge, background: `${actionColor}22`, color: actionColor }}>
          {approval.action?.toUpperCase()}
        </span>
        <span style={styles.time}>
          {approval.createdAt ? format(new Date(approval.createdAt), 'MMM d, HH:mm:ss') : ''}
        </span>
      </div>

      <div style={styles.cardTitle}>
        {approval.collectionName || approval.collectionSlug}
        {approval.tokenId && <span style={styles.tokenId} className="mono"> #{approval.tokenId}</span>}
      </div>

      <div style={styles.details}>
        {approval.action === 'buy' && (
          <>
            <Detail label="Buy Price" value={`${approval.priceEth} ETH`} color="#6366f1" />
            <Detail label="Floor Price" value={`${approval.floorPriceEth} ETH`} />
            <Detail
              label="Est. Profit"
              value={`${approval.flipEstimate?.profitPct > 0 ? '+' : ''}${approval.flipEstimate?.profitPct?.toFixed(1)}%`}
              color={approval.flipEstimate?.isProfitable ? '#22c55e' : '#94a3b8'}
            />
            <Detail label="Score" value={approval.score} color="#818cf8" />
          </>
        )}
        {approval.action === 'sell' && (
          <>
            <Detail label="Sell Price" value={`${approval.priceEth} ETH`} color="#22c55e" />
            <Detail label="Buy Price" value={`${approval.buyPriceEth} ETH`} />
            <Detail
              label="Profit"
              value={`${(approval.flip?.profitEth || 0) >= 0 ? '+' : ''}${(approval.flip?.profitEth || 0).toFixed(4)} ETH`}
              color={(approval.flip?.profitEth || 0) >= 0 ? '#22c55e' : '#ef4444'}
            />
          </>
        )}
        {approval.action === 'bid' && (
          <>
            <Detail label="Collection" value={approval.collectionSlug} />
            <Detail label="Bid Amount" value={`${approval.bidPriceEth} ETH`} color="#eab308" />
          </>
        )}
      </div>

      <div style={styles.cardActions}>
        <button
          style={styles.btnReject}
          onClick={onReject}
          disabled={loading}
        >
          ✗ Reject
        </button>
        <button
          style={styles.btnApprove}
          onClick={onApprove}
          disabled={loading}
        >
          {loading ? '...' : '✓ Approve & Execute'}
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value, color }) {
  return (
    <div style={styles.detail}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={{ ...styles.detailValue, color: color || '#f1f5f9' }} className="mono">{value}</span>
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: -12 },
  empty: { textAlign: 'center', padding: '60px 0', color: '#64748b', fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  emptyIcon: { fontSize: 36, color: '#22c55e' },
  list: { display: 'flex', flexDirection: 'column', gap: 14 },
  card: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  actionBadge: { padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, letterSpacing: 0.5 },
  time: { fontSize: 12, color: '#64748b' },
  cardTitle: { fontSize: 18, fontWeight: 600 },
  tokenId: { color: '#64748b', fontSize: 14 },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 },
  detail: { background: '#1e293b', borderRadius: 8, padding: '8px 12px' },
  detailLabel: { display: 'block', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  detailValue: { fontSize: 14, fontWeight: 600 },
  cardActions: { display: 'flex', gap: 10 },
  btnReject: { flex: 1, padding: '10px 0', borderRadius: 9, border: '1px solid #334155', background: 'transparent', color: '#ef4444', fontWeight: 600, fontSize: 14 },
  btnApprove: { flex: 2, padding: '10px 0', borderRadius: 9, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 14 },
};
