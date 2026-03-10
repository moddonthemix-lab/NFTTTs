import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const BASE = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');
const api = axios.create({ baseURL: `${BASE}/api` });
api.interceptors.request.use((cfg) => {
  const pw = sessionStorage.getItem('nftbot_auth');
  if (pw) cfg.headers['Authorization'] = `Bearer ${pw}`;
  return cfg;
});

const SUGGESTED = [
  'What are the top trending NFT collections today?',
  'Find collections with floor price under 0.1 ETH and high volume',
  'What new mints are happening on Ethereum right now?',
  'Show me trending collections on Base',
  'What are the most active collections in the last 24 hours?',
];

function ToolPill({ name }) {
  return (
    <span style={styles.toolPill}>
      ⚡ {name.replace(/_/g, ' ')}
    </span>
  );
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ ...styles.msgRow, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && <div style={styles.avatar}>🤖</div>}
      <div style={{ maxWidth: '75%' }}>
        {msg.toolsUsed?.length > 0 && (
          <div style={styles.toolRow}>
            {msg.toolsUsed.map((t, i) => <ToolPill key={i} name={t} />)}
          </div>
        )}
        <div style={{ ...styles.bubble, ...(isUser ? styles.bubbleUser : styles.bubbleBot) }}>
          {msg.content.split('\n').map((line, i) => (
            <React.Fragment key={i}>
              {line}
              {i < msg.content.split('\n').length - 1 && <br />}
            </React.Fragment>
          ))}
        </div>
        <div style={styles.msgTime}>{msg.time}</div>
      </div>
      {isUser && <div style={styles.avatarUser}>👤</div>}
    </div>
  );
}

export default function ClawCommand() {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  const send = async (prompt) => {
    const text = (prompt || input).trim();
    if (!text || loading) return;
    setInput('');
    setError(null);

    const userMsg = { role: 'user', content: text, time: new Date().toLocaleTimeString() };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    setLoading(true);

    try {
      // Send only role+content pairs as history context
      const historyContext = newHistory.map(({ role, content }) => ({ role, content }));
      const { data } = await api.post('/claw-command', { prompt: text, history: historyContext.slice(0, -1) });
      setHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || '(no response)',
          toolsUsed: data.toolsUsed || [],
          time: new Date().toLocaleTimeString(),
        },
      ]);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      setHistory((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${msg}`, toolsUsed: [], time: new Date().toLocaleTimeString() },
      ]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerIcon}>🦾</span>
          <div>
            <div style={styles.headerTitle}>Claw Command</div>
            <div style={styles.headerSub}>OpenSea AI · Live NFT Intelligence</div>
          </div>
        </div>
        {history.length > 0 && (
          <button style={styles.clearBtn} onClick={() => setHistory([])}>Clear Chat</button>
        )}
      </div>

      {/* Chat Area */}
      <div style={styles.chatArea}>
        {history.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>🎮</div>
            <div style={styles.emptyTitle}>Ask anything about NFTs</div>
            <div style={styles.emptySub}>Live data from OpenSea across 20+ chains</div>
            <div style={styles.suggestions}>
              {SUGGESTED.map((s, i) => (
                <button key={i} style={styles.suggestion} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {history.map((msg, i) => <Message key={i} msg={msg} />)}
            {loading && (
              <div style={{ ...styles.msgRow, justifyContent: 'flex-start' }}>
                <div style={styles.avatar}>🤖</div>
                <div style={{ ...styles.bubble, ...styles.bubbleBot, color: '#64748b' }}>
                  <span style={styles.typing}>Searching OpenSea</span>
                  <span style={styles.dots}>···</span>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <div style={styles.inputRow}>
          <textarea
            ref={inputRef}
            style={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about collections, mints, floor prices, trends..."
            rows={2}
            disabled={loading}
          />
          <button
            style={{ ...styles.sendBtn, opacity: loading || !input.trim() ? 0.5 : 1 }}
            onClick={() => send()}
            disabled={loading || !input.trim()}
          >
            {loading ? '⏳' : '⚡'}
          </button>
        </div>
        <div style={styles.hint}>Enter to send · Shift+Enter for new line · Powered by OpenSea MCP + Claude</div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0a0e1a',
    color: '#f1f5f9',
  },
  header: {
    padding: '20px 28px 16px',
    borderBottom: '1px solid #1e293b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#0f172a',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerIcon: { fontSize: 32 },
  headerTitle: { fontWeight: 700, fontSize: 20, letterSpacing: 0.3 },
  headerSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  clearBtn: {
    padding: '6px 14px', borderRadius: 8, border: '1px solid #334155',
    background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer',
  },
  chatArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', flex: 1, gap: 12, textAlign: 'center',
    paddingTop: 40,
  },
  emptyIcon: { fontSize: 56 },
  emptyTitle: { fontSize: 22, fontWeight: 700, color: '#e2e8f0' },
  emptySub: { fontSize: 14, color: '#64748b' },
  suggestions: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, width: '100%', maxWidth: 520 },
  suggestion: {
    padding: '10px 16px', borderRadius: 10, border: '1px solid #1e293b',
    background: '#0f172a', color: '#94a3b8', fontSize: 13, cursor: 'pointer',
    textAlign: 'left', transition: 'all 0.15s',
  },
  msgRow: { display: 'flex', alignItems: 'flex-end', gap: 10 },
  avatar: { fontSize: 20, flexShrink: 0, marginBottom: 4 },
  avatarUser: { fontSize: 20, flexShrink: 0, marginBottom: 4 },
  bubble: {
    padding: '12px 16px', borderRadius: 14, fontSize: 14,
    lineHeight: 1.6, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
  },
  bubbleUser: {
    background: 'rgba(99,102,241,0.2)', color: '#e2e8f0',
    borderBottomRightRadius: 4, border: '1px solid rgba(99,102,241,0.3)',
  },
  bubbleBot: {
    background: '#0f172a', color: '#e2e8f0',
    borderBottomLeftRadius: 4, border: '1px solid #1e293b',
  },
  msgTime: { fontSize: 10, color: '#475569', marginTop: 4, paddingLeft: 4 },
  toolRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  toolPill: {
    fontSize: 10, padding: '2px 8px', borderRadius: 20,
    background: 'rgba(99,102,241,0.15)', color: '#818cf8',
    border: '1px solid rgba(99,102,241,0.25)',
  },
  typing: { color: '#64748b', fontSize: 13 },
  dots: { color: '#6366f1', fontSize: 18, letterSpacing: 2, marginLeft: 4 },
  inputArea: {
    borderTop: '1px solid #1e293b',
    padding: '16px 28px 20px',
    background: '#0f172a',
    flexShrink: 0,
  },
  inputRow: { display: 'flex', gap: 12, alignItems: 'flex-end' },
  textarea: {
    flex: 1, background: '#1e293b', border: '1px solid #334155',
    borderRadius: 12, color: '#f1f5f9', fontSize: 14, padding: '12px 16px',
    resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
  },
  sendBtn: {
    width: 48, height: 48, borderRadius: 12, border: 'none',
    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    color: '#fff', fontSize: 20, cursor: 'pointer', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  hint: { fontSize: 11, color: '#475569', marginTop: 8, textAlign: 'center' },
};
