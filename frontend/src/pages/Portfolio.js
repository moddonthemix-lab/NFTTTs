import React, { useState } from 'react';
import { tradesApi, scannerApi } from '../utils/api';
import { format } from 'date-fns';

export default function Portfolio({ portfolio }) {
  const [selling, setSelling] = useState({});
  const [sellPrice, setSellPrice] = useState({});
  const [showSellFor, setShowSellFor] = useState(null);

  const totalCost = (portfolio || []).reduce((sum, n) => sum + (n.buyPriceEth || 0), 0);

  const handleSell = async (nft) => {
    const price = sellPrice[nft.tokenId] || '';
    if (!price) return alert('Enter a sell price');
    if (!window.confirm(`List ${nft.collectionName} #${nft.tokenId} for ${price} ETH?`)) return;

    setSelling((prev) => ({ ...prev, [nft.tokenId]: true }));
    try {
      await tradesApi.sell(nft.contractAddress, nft.tokenId, parseFloat(price));
      alert('Sell listing created!');
      setShowSellFor(null);
    } catch (err) {
      alert(`Sell failed: ${err.response?.data?.error || err.message}`);
    }
    setSelling((prev) => ({ ...prev, [nft.tokenId]: false }));
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Portfolio</h1>
          <p style={styles.sub}>{(portfolio || []).length} NFTs held — total cost: {totalCost.toFixed(4)} ETH</p>
        </div>
      </div>

      {!portfolio?.length ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>◇</div>
          <div>No NFTs in portfolio yet. The bot will buy and hold them here.</div>
        </div>
      ) : (
        <div style={styles.grid}>
          {portfolio.map((nft, i) => (
            <div key={i} style={styles.card}>
              {nft.collectionImage && (
                <img src={nft.collectionImage} alt="" style={styles.img} onError={(e) => { e.target.style.display = 'none'; }} />
              )}
              <div style={styles.info}>
                <div style={styles.name}>{nft.collectionName || nft.collectionSlug}</div>
                <div style={styles.tokenId} className="mono">#{nft.tokenId}</div>
                <div style={styles.meta}>
                  <MetaItem label="Bought" value={`${(nft.buyPriceEth || 0).toFixed(4)} ETH`} />
                  <MetaItem label="Floor" value={`${(nft.floorPriceEth || 0).toFixed(4)} ETH`} />
                  {nft.acquiredAt && (
                    <MetaItem label="Acquired" value={format(new Date(nft.acquiredAt), 'MMM d HH:mm')} />
                  )}
                </div>

                {showSellFor === nft.tokenId ? (
                  <div style={styles.sellRow}>
                    <input
                      style={styles.input}
                      type="number"
                      step="0.001"
                      placeholder="Sell price (ETH)"
                      value={sellPrice[nft.tokenId] || ''}
                      onChange={(e) => setSellPrice((prev) => ({ ...prev, [nft.tokenId]: e.target.value }))}
                    />
                    <button style={styles.btnSellConfirm} onClick={() => handleSell(nft)} disabled={selling[nft.tokenId]}>
                      {selling[nft.tokenId] ? '...' : 'List'}
                    </button>
                    <button style={styles.btnCancel} onClick={() => setShowSellFor(null)}>✗</button>
                  </div>
                ) : (
                  <button style={styles.btnSell} onClick={() => setShowSellFor(nft.tokenId)}>
                    Sell / List
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value }) {
  return (
    <div style={{ marginRight: 16 }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  empty: { textAlign: 'center', padding: '60px 0', color: '#64748b', fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  emptyIcon: { fontSize: 40, color: '#334155' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  card: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  img: { width: '100%', height: 180, objectFit: 'cover' },
  info: { padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  name: { fontWeight: 600, fontSize: 15 },
  tokenId: { fontSize: 12, color: '#64748b' },
  meta: { display: 'flex', flexWrap: 'wrap', gap: 0 },
  sellRow: { display: 'flex', gap: 6, marginTop: 4 },
  input: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, outline: 'none' },
  btnSell: { padding: '9px 0', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 14, marginTop: 4 },
  btnSellConfirm: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 13 },
  btnCancel: { padding: '8px 10px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 13 },
};
