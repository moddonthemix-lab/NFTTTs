import React, { useRef, useEffect } from 'react';
import { format } from 'date-fns';

const TYPE_STYLES = {
  success: { color: '#22c55e', icon: '✓' },
  error:   { color: '#ef4444', icon: '✗' },
  warn:    { color: '#eab308', icon: '!' },
  info:    { color: '#94a3b8', icon: 'i' },
};

export default function Logs({ logs }) {
  const bottomRef = useRef(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, autoScroll]);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Live Logs</h1>
          <p style={styles.sub}>{logs?.length || 0} events</p>
        </div>
        <label style={styles.autoScrollLabel}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Auto-scroll
        </label>
      </div>

      <div style={styles.terminal}>
        {(!logs || logs.length === 0) && (
          <div style={styles.empty}>Waiting for events...</div>
        )}
        {[...(logs || [])].reverse().map((log) => {
          const ts = TYPE_STYLES[log.type] || TYPE_STYLES.info;
          return (
            <div key={log.id} style={styles.logLine}>
              <span style={{ ...styles.icon, color: ts.color }}>{ts.icon}</span>
              <span style={styles.time}>
                {log.time ? format(new Date(log.time), 'HH:mm:ss') : ''}
              </span>
              <span style={{ ...styles.msg, color: ts.color }}>{log.message}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, height: 'calc(100vh - 56px)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  autoScrollLabel: { display: 'flex', alignItems: 'center', color: '#94a3b8', fontSize: 13, cursor: 'pointer' },
  terminal: {
    flex: 1,
    background: '#0a0e1a',
    border: '1px solid #1e293b',
    borderRadius: 12,
    padding: '12px 16px',
    overflowY: 'auto',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  empty: { color: '#334155', textAlign: 'center', padding: '40px 0' },
  logLine: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '3px 0' },
  icon: { flexShrink: 0, fontWeight: 700, width: 14, textAlign: 'center' },
  time: { color: '#334155', flexShrink: 0, width: 62 },
  msg: { wordBreak: 'break-word' },
};
