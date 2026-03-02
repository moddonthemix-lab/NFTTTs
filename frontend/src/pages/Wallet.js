import React, { useState } from 'react';
import { walletApi } from '../utils/api';

export default function Wallet({ walletInfo }) {
  const [tab, setTab] = useState('privatekey');
  const [privateKey, setPrivateKey] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [derivationPath, setDerivationPath] = useState("m/44'/60'/0'/0/0");
  const [loading, setLoading] = useState(false);
  const [newWallet, setNewWallet] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [forgetting, setForgetting] = useState(false);

  const handleForget = async () => {
    if (!window.confirm('Remove saved wallet from server? You will need to re-import to trade again.')) return;
    setForgetting(true);
    try {
      await walletApi.forget();
      alert('Wallet cleared. Reload the page to update status.');
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
    setForgetting(false);
  };

  const handleImportPK = async () => {
    if (!privateKey.trim()) return alert('Enter a private key');
    setLoading(true);
    try {
      const result = await walletApi.importPrivateKey(privateKey.trim());
      if (result.success) {
        alert(`Wallet connected: ${result.address}`);
        setPrivateKey('');
      }
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  const handleImportMnemonic = async () => {
    if (!mnemonic.trim()) return alert('Enter a mnemonic phrase');
    setLoading(true);
    try {
      const result = await walletApi.importMnemonic(mnemonic.trim(), derivationPath);
      if (result.success) {
        alert(`Wallet connected: ${result.address}`);
        setMnemonic('');
      }
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!window.confirm('Create a new random wallet? You MUST save the private key and mnemonic!')) return;
    setLoading(true);
    try {
      const result = await walletApi.createNew();
      setNewWallet(result);
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Wallet</h1>
      <p style={styles.sub}>Connect your Ethereum wallet to enable trading</p>

      {/* Current wallet status */}
      {walletInfo?.connected && (
        <div style={styles.connected}>
          <div style={styles.connectedTitle}>✓ Wallet Connected</div>
          <div style={styles.addrRow}>
            <span style={styles.addr} className="mono">{walletInfo.address}</span>
          </div>
          <div style={styles.balRow}>
            <span style={styles.balLabel}>Balance</span>
            <span style={styles.bal} className="mono">{walletInfo.balanceEth?.toFixed(6)} ETH</span>
          </div>
          <div style={styles.balRow}>
            <span style={styles.balLabel}>Saved</span>
            <span style={{ fontSize: 13, color: walletInfo.isSaved ? '#22c55e' : '#eab308' }}>
              {walletInfo.isSaved ? '✓ Auto-loads on restart' : '✗ Not saved — re-import after restart'}
            </span>
          </div>
          {walletInfo.needsReimport && (
            <div style={styles.reimportWarn}>
              ⚠ Server restarted — re-import your private key to sign transactions
            </div>
          )}
          <button style={styles.btnForget} onClick={handleForget} disabled={forgetting}>
            {forgetting ? 'Clearing...' : '✕ Forget Wallet'}
          </button>
        </div>
      )}

      {/* New wallet created */}
      {newWallet && (
        <div style={styles.newWalletBox}>
          <div style={styles.newWalletTitle}>🚨 NEW WALLET CREATED — SAVE THIS NOW</div>
          <div style={styles.newWalletWarn}>
            This information will NOT be shown again. Write it down and store it securely!
          </div>
          <Field label="Address" value={newWallet.address} mono />
          <Field label="Private Key" value={newWallet.privateKey} mono sensitive />
          {newWallet.mnemonic && <Field label="Mnemonic (Seed Phrase)" value={newWallet.mnemonic} mono sensitive />}
          <button style={styles.btnDismiss} onClick={() => setNewWallet(null)}>I have saved this — dismiss</button>
        </div>
      )}

      {/* Import form */}
      <div style={styles.card}>
        <div style={styles.tabs}>
          {[
            { key: 'privatekey', label: 'Private Key' },
            { key: 'mnemonic', label: 'Seed Phrase' },
            { key: 'create', label: 'Create New' },
          ].map((t) => (
            <button
              key={t.key}
              style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'privatekey' && (
          <div style={styles.form}>
            <p style={styles.formDesc}>Import an existing wallet using its private key.</p>
            <label style={styles.label}>Private Key</label>
            <div style={styles.inputRow}>
              <input
                style={styles.input}
                type={showKey ? 'text' : 'password'}
                placeholder="0x... or hex string"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                autoComplete="off"
              />
              <button style={styles.eyeBtn} onClick={() => setShowKey(!showKey)}>
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
            <div style={styles.secNote}>
              🔒 Your key is saved to the server's data volume and auto-loaded on restart. Use "Forget Wallet" on the status panel above to clear it.
            </div>
            <button style={styles.btnImport} onClick={handleImportPK} disabled={loading}>
              {loading ? 'Connecting...' : 'Import Wallet'}
            </button>
          </div>
        )}

        {tab === 'mnemonic' && (
          <div style={styles.form}>
            <p style={styles.formDesc}>Import a wallet using a 12 or 24-word seed phrase.</p>
            <label style={styles.label}>Seed Phrase</label>
            <textarea
              style={{ ...styles.input, height: 80, resize: 'vertical' }}
              placeholder="word1 word2 word3 ... word12"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              autoComplete="off"
            />
            <label style={styles.label}>Derivation Path (optional)</label>
            <input
              style={styles.input}
              value={derivationPath}
              onChange={(e) => setDerivationPath(e.target.value)}
            />
            <button style={styles.btnImport} onClick={handleImportMnemonic} disabled={loading}>
              {loading ? 'Connecting...' : 'Import from Seed Phrase'}
            </button>
          </div>
        )}

        {tab === 'create' && (
          <div style={styles.form}>
            <p style={styles.formDesc}>Generate a brand new Ethereum wallet. You must fund it with ETH before trading.</p>
            <div style={styles.createWarn}>
              ⚠ The private key and seed phrase will be shown ONCE. You are responsible for saving them.
            </div>
            <button style={styles.btnCreate} onClick={handleCreate} disabled={loading}>
              {loading ? 'Generating...' : '✦ Create New Wallet'}
            </button>
          </div>
        )}
      </div>

      <div style={styles.helpBox}>
        <div style={styles.helpTitle}>How to get an OpenSea API key</div>
        <ol style={styles.helpList}>
          <li>Go to the OpenSea developer portal</li>
          <li>Sign in and create an API key</li>
          <li>Add it to your <code style={styles.code}>.env</code> file as <code style={styles.code}>OPENSEA_API_KEY</code></li>
          <li>Also set <code style={styles.code}>ETH_RPC_URL</code> to your Alchemy or Infura endpoint</li>
        </ol>
      </div>
    </div>
  );
}

function Field({ label, value, mono, sensitive }) {
  const [show, setShow] = useState(!sensitive);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{
          flex: 1, padding: '8px 12px', background: '#1e293b', borderRadius: 8,
          fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
          fontSize: 12, color: '#f1f5f9', wordBreak: 'break-all',
          filter: sensitive && !show ? 'blur(5px)' : 'none',
        }}>{value}</div>
        {sensitive && (
          <button onClick={() => setShow(!show)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 16 }}>
            {show ? '🙈' : '👁'}
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: -12 },
  connected: { background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  connectedTitle: { color: '#22c55e', fontWeight: 700, fontSize: 15 },
  addrRow: { display: 'flex', alignItems: 'center', gap: 8 },
  addr: { fontSize: 13, color: '#f1f5f9', wordBreak: 'break-all' },
  balRow: { display: 'flex', alignItems: 'center', gap: 10 },
  balLabel: { fontSize: 12, color: '#64748b' },
  bal: { fontSize: 18, fontWeight: 700, color: '#22c55e' },
  reimportWarn: { background: 'rgba(234,179,8,0.1)', borderRadius: 8, padding: '8px 12px', color: '#eab308', fontSize: 12 },
  btnForget: { padding: '6px 14px', borderRadius: 8, border: '1px solid #ef4444', background: 'transparent', color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  newWalletBox: { background: 'rgba(239,68,68,0.08)', border: '2px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 },
  newWalletTitle: { color: '#ef4444', fontWeight: 700, fontSize: 16 },
  newWalletWarn: { color: '#fca5a5', fontSize: 13 },
  btnDismiss: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, marginTop: 8, alignSelf: 'flex-start' },
  card: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' },
  tabs: { display: 'flex', borderBottom: '1px solid #1e293b' },
  tab: { flex: 1, padding: '12px 0', border: 'none', background: 'transparent', color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  tabActive: { background: 'rgba(99,102,241,0.1)', color: '#818cf8', borderBottom: '2px solid #6366f1' },
  form: { padding: 24, display: 'flex', flexDirection: 'column', gap: 12 },
  formDesc: { color: '#94a3b8', fontSize: 13 },
  label: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { width: '100%', padding: '10px 14px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 14, outline: 'none' },
  inputRow: { display: 'flex', gap: 8 },
  eyeBtn: { padding: '0 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 9, fontSize: 16, cursor: 'pointer' },
  secNote: { fontSize: 11, color: '#64748b', background: 'rgba(99,102,241,0.05)', borderRadius: 8, padding: '8px 12px' },
  btnImport: { padding: '11px 0', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 15, marginTop: 4 },
  btnCreate: { padding: '11px 0', borderRadius: 9, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 15, marginTop: 4 },
  createWarn: { background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 8, padding: '10px 14px', color: '#eab308', fontSize: 13 },
  helpBox: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 20 },
  helpTitle: { fontWeight: 600, marginBottom: 10 },
  helpList: { color: '#94a3b8', fontSize: 13, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 },
  code: { background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 },
};
