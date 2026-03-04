import React, { useState, useEffect } from 'react';

const SESSION_KEY = 'nftbot_auth';
const BASE = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

export function getStoredPassword() {
  return sessionStorage.getItem(SESSION_KEY) || '';
}

export default function PasswordGate({ children }) {
  const [checked, setChecked]         = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authed, setAuthed]           = useState(false);
  const [password, setPassword]       = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);

  // On mount: probe /api/health to see if auth is required, then validate
  // any already-stored session token.
  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`${BASE}/api/health`);
        const data = await res.json();
        if (!data.authRequired) {
          setAuthed(true);
        } else {
          setAuthRequired(true);
          const stored = sessionStorage.getItem(SESSION_KEY);
          if (stored) {
            const test = await fetch(`${BASE}/api/stats`, {
              headers: { Authorization: `Bearer ${stored}` },
            });
            if (test.status !== 401) {
              setAuthed(true);
            } else {
              sessionStorage.removeItem(SESSION_KEY);
            }
          }
        }
      } catch {
        // Server unreachable — still show the gate
        setAuthRequired(true);
      }
      setChecked(true);
    })();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/stats`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (res.status === 401) {
        setError('Incorrect password');
        setLoading(false);
        return;
      }
      sessionStorage.setItem(SESSION_KEY, password);
      setAuthed(true);
    } catch {
      setError('Cannot reach server');
    }
    setLoading(false);
  };

  if (!checked) return null;
  if (!authRequired || authed) return children;

  return (
    <div style={s.overlay}>
      <div style={s.box}>
        <div style={s.icon}>◈</div>
        <h1 style={s.title}>NFT Claw Machine</h1>
        <p style={s.sub}>Enter your dashboard password to continue</p>
        <form onSubmit={handleSubmit} style={s.form}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={s.input}
            autoFocus
          />
          {error && <p style={s.error}>{error}</p>}
          <button type="submit" disabled={loading || !password} style={s.btn}>
            {loading ? 'Checking...' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0a0a0f',
  },
  box: {
    background: '#13131a',
    border: '1px solid #2a2a3a',
    borderRadius: 16,
    padding: '48px 40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: 360,
    boxShadow: '0 0 60px rgba(124,92,252,0.18)',
  },
  icon:  { fontSize: 48, marginBottom: 12, color: '#7c5cfc' },
  title: { color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 6px' },
  sub:   { color: '#888', fontSize: 14, margin: '0 0 28px', textAlign: 'center' },
  form:  { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' },
  input: {
    background: '#0d0d14',
    border: '1px solid #2a2a3a',
    borderRadius: 8,
    color: '#fff',
    fontSize: 16,
    padding: '12px 14px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  btn: {
    background: 'linear-gradient(135deg, #7c5cfc, #5c3ddb)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
    padding: '12px 0',
    width: '100%',
  },
  error: { color: '#f87171', fontSize: 13, margin: 0, textAlign: 'center' },
};
