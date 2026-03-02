import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import PasswordGate from './components/PasswordGate';
import Dashboard from './pages/Dashboard';
import Scanner from './pages/Scanner';
import Portfolio from './pages/Portfolio';
import Approvals from './pages/Approvals';
import Bids from './pages/Bids';
import Trades from './pages/Trades';
import Wallet from './pages/Wallet';
import Logs from './pages/Logs';
import { useSocket } from './hooks/useSocket';

// AppInner only mounts after PasswordGate auth passes, so
// useSocket() picks up the sessionStorage token at the right time.
function AppInner() {
  const {
    connected,
    walletInfo,
    botRunning,
    portfolio,
    trades,
    bids,
    setBids,
    pendingApprovals,
    stats,
    opportunities,
    scanning,
    logs,
  } = useSocket();

  return (
    <BrowserRouter>
      <div style={styles.layout}>
        <Sidebar
          connected={connected}
          botRunning={botRunning}
          pendingCount={pendingApprovals?.filter((a) => a.status === 'pending').length || 0}
        />
        <main style={styles.main}>
          <Routes>
            <Route
              path="/"
              element={
                <Dashboard
                  walletInfo={walletInfo}
                  botRunning={botRunning}
                  stats={stats}
                  trades={trades}
                  portfolio={portfolio}
                  pendingApprovals={pendingApprovals}
                  scanning={scanning}
                />
              }
            />
            <Route
              path="/scanner"
              element={<Scanner opportunities={opportunities} scanning={scanning} />}
            />
            <Route
              path="/portfolio"
              element={<Portfolio portfolio={portfolio} />}
            />
            <Route
              path="/approvals"
              element={<Approvals pendingApprovals={pendingApprovals} />}
            />
            <Route
              path="/bids"
              element={<Bids bids={bids} setBids={setBids} />}
            />
            <Route
              path="/trades"
              element={<Trades trades={trades} />}
            />
            <Route
              path="/wallet"
              element={<Wallet walletInfo={walletInfo} />}
            />
            <Route
              path="/logs"
              element={<Logs logs={logs} />}
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <PasswordGate>
      <AppInner />
    </PasswordGate>
  );
}

const styles = {
  layout: { display: 'flex', minHeight: '100vh' },
  main: { flex: 1, overflowY: 'auto', minHeight: '100vh' },
};
