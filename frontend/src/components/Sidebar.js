import React from 'react';
import { NavLink } from 'react-router-dom';

const NAV = [
  { path: '/', label: 'Dashboard', icon: '◈' },
  { path: '/scanner', label: 'Scanner', icon: '⊕' },
  { path: '/portfolio', label: 'Portfolio', icon: '◇' },
  { path: '/approvals', label: 'Approvals', icon: '◉' },
  { path: '/bids', label: 'Bids', icon: '⊖' },
  { path: '/trades', label: 'Trade History', icon: '≡' },
  { path: '/wallet', label: 'Wallet', icon: '◎' },
  { path: '/logs', label: 'Logs', icon: '▤' },
];

export default function Sidebar({ connected, botRunning, pendingCount }) {
  return (
    <aside style={styles.sidebar}>
      <div style={styles.logo}>
        <span style={styles.logoIcon}>⬡</span>
        <div>
          <div style={styles.logoTitle}>NFT Bot</div>
          <div style={styles.logoSub}>Trading Engine</div>
        </div>
      </div>

      <div style={styles.statusRow}>
        <span style={{ ...styles.dot, background: connected ? '#22c55e' : '#ef4444' }} />
        <span style={styles.statusText}>{connected ? 'Connected' : 'Offline'}</span>
        {botRunning && (
          <>
            <span style={{ ...styles.dot, background: '#6366f1', marginLeft: 8 }} className="animate-pulse" />
            <span style={styles.statusText}>Bot Active</span>
          </>
        )}
      </div>

      <nav style={styles.nav}>
        {NAV.map(({ path, label, icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            style={({ isActive }) => ({
              ...styles.link,
              ...(isActive ? styles.linkActive : {}),
            })}
          >
            <span style={styles.icon}>{icon}</span>
            <span>{label}</span>
            {label === 'Approvals' && pendingCount > 0 && (
              <span style={styles.badge}>{pendingCount}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={styles.footer}>
        <div style={styles.footerText}>NFT Trading Bot v1.0</div>
        <div style={{ ...styles.footerText, color: '#64748b' }}>Use at your own risk</div>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: 220,
    minHeight: '100vh',
    background: '#0f172a',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    padding: '0 0 16px 0',
    flexShrink: 0,
  },
  logo: {
    padding: '20px 20px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderBottom: '1px solid #1e293b',
  },
  logoIcon: { fontSize: 28, color: '#6366f1' },
  logoTitle: { fontWeight: 700, fontSize: 16, letterSpacing: 0.5 },
  logoSub: { fontSize: 11, color: '#64748b' },
  statusRow: {
    padding: '10px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderBottom: '1px solid #1e293b',
  },
  dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' },
  statusText: { fontSize: 11, color: '#94a3b8' },
  nav: { flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 8,
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 500,
    textDecoration: 'none',
    transition: 'all 0.15s',
  },
  linkActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#818cf8',
  },
  icon: { fontSize: 16, width: 20, textAlign: 'center' },
  badge: {
    marginLeft: 'auto',
    background: '#ef4444',
    color: '#fff',
    borderRadius: 10,
    padding: '1px 7px',
    fontSize: 11,
    fontWeight: 700,
  },
  footer: { padding: '16px 20px', borderTop: '1px solid #1e293b' },
  footerText: { fontSize: 11, color: '#94a3b8', lineHeight: 1.6 },
};
