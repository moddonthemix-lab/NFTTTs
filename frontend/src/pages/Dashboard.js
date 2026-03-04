import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import StatCard from '../components/StatCard';
import { botApi } from '../utils/api';
import { format } from 'date-fns';

const fmtUsd = (eth, price) => {
  if (!price || !eth) return null;
  const usd = eth * price;
  return usd >= 1000 ? `≈ $${Math.round(usd).toLocaleString()}` : `≈ $${usd.toFixed(2)}`;
};

export default function Dashboard({ walletInfo, botRunning, stats, trades, portfolio, pendingApprovals, scanning, ethPrice }) {
  const [starting, setStarting] = React.useState(false);
  const [diag, setDiag] = React.useState(null);
  const [diagLoading, setDiagLoading] = React.useState(false);

  const handleToggleBot = async () => {
    setStarting(true);
    try {
      if (botRunning) await botApi.stop();
      else await botApi.start();
    } catch (err) {
      alert(err.message);
    }
    setStarting(false);
  };

  const handleScanNow = async () => {
    try {
      await botApi.scan();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDiagnostics = async () => {
    setDiagLoading(true);
    try {
      const result = await botApi.diagnostics();
      setDiag(result);
    } catch (err) {
      setDiag({ errors: [err.message], ready: false });
    }
    setDiagLoading(false);
  };

  // Build profit chart from trades
  const chartData = React.useMemo(() => {
    const sells = (trades || []).filter((t) => t.type === 'sell').slice().reverse();
    let cumulative = 0;
    return sells.map((t) => {
      cumulative += t.profitEth || 0;
      return {
        time: format(new Date(t.timestamp), 'MMM d HH:mm'),
        profit: parseFloat(cumulative.toFixed(6)),
      };
    });
  }, [trades]);

  return (
    <div style={styles.page}>
      <div style={styles.titleRow}>
        <div>
          <h1 style={styles.h1}>Dashboard</h1>
          <p style={styles.sub}>NFT flip bot status & performance</p>
        </div>
        <div style={styles.btns}>
          <button style={styles.btnDiag} onClick={handleDiagnostics} disabled={diagLoading}>
            {diagLoading ? '...' : '⚙ Check Setup'}
          </button>
          <button style={styles.btnScan} onClick={handleScanNow} disabled={scanning}>
            {scanning ? '⟳ Scanning...' : '⊕ Scan Now'}
          </button>
          <button
            style={{ ...styles.btnBot, background: botRunning ? '#ef4444' : '#22c55e' }}
            onClick={handleToggleBot}
            disabled={starting}
          >
            {starting ? '...' : botRunning ? '⏹ Stop Bot' : '▶ Start Bot'}
          </button>
        </div>
      </div>

      {/* Diagnostics panel */}
      {diag && (
        <div style={{ ...styles.walletStrip, flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {diag.ready ? '✓ Setup looks good — ready to trade' : '⚠ Setup issues detected'}
            </span>
            <button style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }} onClick={() => setDiag(null)}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Pill label="Wallet" value={diag.walletAddress ? `${diag.walletAddress.slice(0,8)}...` : 'None'} ok={!!diag.walletAddress} />
            <Pill label="ETH (gas)" value={diag.ethBalanceEth ? `${diag.ethBalanceEth} ETH` : '—'} ok={parseFloat(diag.ethBalanceEth || 0) >= 0.001} warn={parseFloat(diag.ethBalanceEth || 0) > 0 && parseFloat(diag.ethBalanceEth || 0) < 0.001} />
            <Pill label="WETH (auto-wrapped)" value={diag.wethBalanceEth != null ? `${diag.wethBalanceEth} WETH` : '—'} neutral />
            <Pill label="Seaport approval" value={diag.seaportAllowance || '—'} ok={diag.seaportAllowance === 'unlimited'} neutral={diag.seaportAllowance !== 'unlimited'} />
            <Pill label="RPC" value={diag.rpcConnected ? 'Connected' : 'Error'} ok={diag.rpcConnected} />
            <Pill label="API Key" value={diag.apiKeyValid ? 'Valid' : 'Invalid'} ok={diag.apiKeyValid} />
          </div>
          {diag.errors?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {diag.errors.map((e, i) => (
                <div key={i} style={{ color: '#f87171', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wallet strip */}
      {walletInfo?.connected ? (
        <div style={styles.walletStrip}>
          <span style={styles.walletAddr} className="mono">
            {walletInfo.address?.slice(0, 8)}...{walletInfo.address?.slice(-6)}
          </span>
          <span style={styles.walletBal} className="mono">
            {walletInfo.balanceEth?.toFixed(6)} ETH
            {ethPrice && walletInfo.balanceEth != null && (
              <span style={{ color: '#64748b', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
                {fmtUsd(walletInfo.balanceEth, ethPrice)}
              </span>
            )}
          </span>
          {walletInfo.needsReimport && (
            <span style={styles.warn}>⚠ Re-import wallet to sign transactions</span>
          )}
        </div>
      ) : (
        <div style={styles.walletWarn}>
          ⚠ No wallet connected — go to <b>Wallet</b> page to import one
        </div>
      )}

      {/* Stats */}
      <div style={styles.statsGrid}>
        <StatCard icon="⬡" label="Total Bought" value={`${(stats?.totalBought || 0).toFixed(4)} ETH`} sub={fmtUsd(stats?.totalBought, ethPrice)} color="#6366f1" />
        <StatCard icon="⟳" label="Total Sold" value={`${(stats?.totalSold || 0).toFixed(4)} ETH`} sub={fmtUsd(stats?.totalSold, ethPrice)} color="#22c55e" />
        <StatCard
          icon="$"
          label="Total Profit"
          value={`${(stats?.totalProfit || 0) >= 0 ? '+' : ''}${(stats?.totalProfit || 0).toFixed(4)} ETH`}
          sub={fmtUsd(stats?.totalProfit, ethPrice)}
          color={(stats?.totalProfit || 0) >= 0 ? '#22c55e' : '#ef4444'}
        />
        <StatCard icon="◉" label="Portfolio" value={portfolio?.length || 0} sub={`of ${10} max`} />
        <StatCard icon="⊖" label="Active Bids" value={stats?.totalBids || 0} />
        <StatCard icon="◉" label="Pending" value={pendingApprovals?.length || 0} color="#eab308" sub="need approval" />
      </div>

      {/* Profit chart */}
      {chartData.length > 1 && (
        <div style={styles.chartBox}>
          <div style={styles.chartTitle}>Cumulative Profit (ETH)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="4 4" />
              <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
              />
              <Line type="monotone" dataKey="profit" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent trades */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Recent Trades</div>
        {!trades?.length ? (
          <div style={styles.empty}>No trades yet. Start the bot to begin scanning.</div>
        ) : (
          <div style={styles.table}>
            <div style={styles.thead}>
              <span>Type</span><span>Collection</span><span>Token</span>
              <span>Price</span><span>Profit</span><span>Time</span>
            </div>
            {(trades || []).slice(0, 20).map((t, i) => (
              <div key={i} style={styles.trow}>
                <span>
                  <span style={{ color: t.type === 'buy' ? '#6366f1' : t.type === 'sell' ? '#22c55e' : '#eab308' }}>
                    {t.type?.toUpperCase()}
                  </span>
                </span>
                <span style={styles.truncate}>{t.collectionName || t.collectionSlug}</span>
                <span className="mono">{t.tokenId ? `#${t.tokenId}` : '—'}</span>
                <span className="mono">{(t.priceEth || 0).toFixed(4)} ETH</span>
                <span className="mono" style={{ color: (t.profitEth || 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                  {t.profitEth != null ? `${t.profitEth >= 0 ? '+' : ''}${t.profitEth.toFixed(4)}` : '—'}
                </span>
                <span style={{ color: '#64748b', fontSize: 11 }}>
                  {t.timestamp ? format(new Date(t.timestamp), 'MMM d HH:mm') : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ label, value, ok, warn, neutral }) {
  const color = neutral ? '#64748b' : warn ? '#f59e0b' : ok ? '#22c55e' : '#f87171';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 },
  titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  btns: { display: 'flex', gap: 10 },
  btnBot: { padding: '9px 18px', borderRadius: 9, border: 'none', color: '#fff', fontWeight: 700, fontSize: 14 },
  btnScan: { padding: '9px 18px', borderRadius: 9, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 14 },
  btnDiag: { padding: '9px 18px', borderRadius: 9, border: '1px solid #334155', background: 'transparent', color: '#818cf8', fontWeight: 600, fontSize: 14 },
  walletStrip: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  walletAddr: { fontSize: 13, color: '#818cf8' },
  walletBal: { fontSize: 15, fontWeight: 700, color: '#22c55e' },
  warn: { fontSize: 12, color: '#eab308' },
  walletWarn: { background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 10, padding: '10px 16px', color: '#eab308', fontSize: 13 },
  statsGrid: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  chartBox: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '16px 20px' },
  chartTitle: { fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 12 },
  section: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16 },
  sectionTitle: { fontWeight: 600, fontSize: 15, marginBottom: 12 },
  empty: { color: '#64748b', textAlign: 'center', padding: '24px 0', fontSize: 13 },
  table: { display: 'flex', flexDirection: 'column', gap: 0 },
  thead: { display: 'grid', gridTemplateColumns: '60px 1fr 80px 110px 100px 110px', gap: 8, padding: '6px 8px', fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #1e293b' },
  trow: { display: 'grid', gridTemplateColumns: '60px 1fr 80px 110px 100px 110px', gap: 8, padding: '8px 8px', fontSize: 13, borderBottom: '1px solid #0f172a', alignItems: 'center' },
  truncate: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
};
