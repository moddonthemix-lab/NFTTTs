import React from 'react';

export default function StatCard({ label, value, sub, color, icon }) {
  return (
    <div style={styles.card}>
      <div style={styles.top}>
        <span style={styles.icon}>{icon}</span>
        <span style={styles.label}>{label}</span>
      </div>
      <div style={{ ...styles.value, color: color || '#f1f5f9' }}>{value}</div>
      {sub && <div style={styles.sub}>{sub}</div>}
    </div>
  );
}

const styles = {
  card: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: '16px 20px',
    minWidth: 160,
    flex: '1 1 160px',
  },
  top: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  icon: { fontSize: 18 },
  label: { fontSize: 12, color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: 24, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' },
  sub: { fontSize: 12, color: '#64748b', marginTop: 4 },
};
