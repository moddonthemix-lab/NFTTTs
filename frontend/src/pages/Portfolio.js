import React, { useState, useCallback, useEffect, useRef } from 'react';
import { tradesApi, scannerApi, portfolioApi } from '../utils/api';
import { format } from 'date-fns';

const fmt = (n, d = 4) => (n != null ? Number(n).toFixed(d) : '—');

export default function Portfolio({ portfolio, setPortfolio, ethPrice }) {
  const [action, setAction] = useState({});  // { [k]: 'list'|'offer' }
  const [listPrice, setListPrice] = useState({});
  const [busy, setBusy] = useState({});
  const [bestOffers, setBestOffers] = useState({});  // { [k]: { priceEth, loading } }
  const [fees, setFees] = useState({});              // { [k]: { marketplaceFee, enforcedRoyaltyFee, optionalRoyaltyFee, loading } }
  const [royaltyOn, setRoyaltyOn] = useState({});   // { [k]: boolean } — optional royalty toggle
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [floorPrices, setFloorPrices] = useState({});  // { [slug]: number | null }
  const [floorLoading, setFloorLoading] = useState(false);
  const [nftImages, setNftImages] = useState({});      // { [k]: url | null | 'loading' }
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkAcceptMode, setBulkAcceptMode] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const fetchedRef = useRef(new Set());                // track which keys were already fetched

  const fmtUsd = (eth) => {
    if (!ethPrice || eth == null) return null;
    const usd = eth * ethPrice;
    return usd >= 1000 ? `$${Math.round(usd).toLocaleString()}` : `$${usd.toFixed(2)}`;
  };

  // Load live floor prices for all unique collection slugs in the portfolio
  const loadFloorPrices = useCallback(async (pf) => {
    const slugs = [...new Set((pf || []).map((n) => n.collectionSlug).filter(Boolean))];
    if (!slugs.length) return;
    setFloorLoading(true);
    const results = await Promise.allSettled(slugs.map((slug) => scannerApi.getInfo(slug)));
    const updated = {};
    results.forEach((r, i) => {
      updated[slugs[i]] = r.status === 'fulfilled' ? (r.value?.floorPriceEth ?? null) : null;
    });
    setFloorPrices((prev) => ({ ...prev, ...updated }));
    setFloorLoading(false);
  }, []);

  // Fetch floors whenever portfolio changes
  useEffect(() => {
    loadFloorPrices(portfolio);
  }, [portfolio, loadFloorPrices]);

  // Lazy-load individual NFT images for cards that have no collectionImage
  useEffect(() => {
    if (!portfolio?.length) return;
    portfolio.forEach((nft, i) => {
      if (!nft.contractAddress || !nft.tokenId) return;
      if (nft.collectionImage) return;  // already has an image
      const k = cardKey(nft, i);
      if (fetchedRef.current.has(k)) return;
      fetchedRef.current.add(k);
      setNftImages((p) => ({ ...p, [k]: 'loading' }));
      scannerApi.getNFTImage(nft.chain || 'ethereum', nft.contractAddress, nft.tokenId)
        .then((url) => setNftImages((p) => ({ ...p, [k]: url || null })))
        .catch(() => setNftImages((p) => ({ ...p, [k]: null })));
    });
  }, [portfolio]); // portfolio is the only trigger needed

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const updated = await portfolioApi.get();
      if (setPortfolio) setPortfolio(updated);
      await loadFloorPrices(updated);
    } catch { /* silent */ }
    setRefreshing(false);
  };

  const handleSync = async (chain = 'ethereum') => {
    setSyncing(true);
    try {
      const { added, portfolio: updated } = await portfolioApi.sync(chain);
      if (setPortfolio) setPortfolio(updated);
      alert(added > 0 ? `Synced ${added} new NFT${added !== 1 ? 's' : ''} from wallet.` : 'Wallet synced — no new NFTs found.');
    } catch (err) {
      alert(`Sync failed: ${err.response?.data?.error || err.message}`);
    }
    setSyncing(false);
  };

  // Unique key per card — use contract+token when available, else index-based
  const cardKey = (nft, i) =>
    nft.contractAddress && nft.tokenId
      ? `${nft.contractAddress}-${nft.tokenId}`
      : `idx-${i}`;

  const fetchBestOffer = useCallback(async (k, nft) => {
    if (!nft.contractAddress || !nft.tokenId || !nft.collectionSlug) {
      setBestOffers((p) => ({ ...p, [k]: { priceEth: null, loading: false } }));
      return;
    }
    setBestOffers((p) => ({ ...p, [k]: { loading: true } }));
    try {
      const data = await tradesApi.getBestOffer(
        nft.contractAddress, nft.tokenId, nft.collectionSlug, nft.chain || 'ethereum'
      );
      setBestOffers((p) => ({ ...p, [k]: { priceEth: data.priceEth, loading: false } }));
    } catch {
      setBestOffers((p) => ({ ...p, [k]: { priceEth: null, loading: false } }));
    }
  }, []);

  const fetchFees = useCallback(async (k, nft) => {
    if (!nft.collectionSlug) {
      setFees((p) => ({ ...p, [k]: { marketplaceFee: 1.0, enforcedRoyaltyFee: 0, optionalRoyaltyFee: 5.0, loading: false } }));
      setRoyaltyOn((p) => ({ ...p, [k]: true }));
      return;
    }
    setFees((p) => ({ ...p, [k]: { loading: true } }));
    try {
      const info = await scannerApi.getInfo(nft.collectionSlug);
      const mFee = info?.fees?.marketplaceFee ?? 1.0;
      const enforced = info?.fees?.enforcedRoyaltyFee ?? 0;
      const optional = info?.fees?.optionalRoyaltyFee ?? (info?.fees?.royaltyFee ?? 0);
      setFees((p) => ({ ...p, [k]: { marketplaceFee: mFee, enforcedRoyaltyFee: enforced, optionalRoyaltyFee: optional, loading: false } }));
      // Auto-set toggle: on by default (creator gets paid), but only relevant if optional > 0
      setRoyaltyOn((p) => ({ ...p, [k]: true }));
    } catch {
      setFees((p) => ({ ...p, [k]: { marketplaceFee: 1.0, enforcedRoyaltyFee: 0, optionalRoyaltyFee: 5.0, loading: false } }));
      setRoyaltyOn((p) => ({ ...p, [k]: true }));
    }
  }, []);

  const openAction = (k, nft, mode) => {
    setAction((p) => ({ ...p, [k]: mode }));
    if (mode === 'offer') fetchBestOffer(k, nft);
    if (mode === 'list') fetchFees(k, nft);
  };

  const closeAction = (k) => setAction((p) => ({ ...p, [k]: null }));

  const handleList = async (k, nft) => {
    const price = listPrice[k];
    if (!price || isNaN(parseFloat(price))) return alert('Enter a valid sell price in ETH');
    if (!nft.contractAddress || !nft.tokenId) {
      return alert('This NFT is missing contract/token data and cannot be listed.\nOnly NFTs with a known token ID can be listed.');
    }
    const feeData = fees[k];
    const mFee = feeData?.marketplaceFee ?? 1.0;
    const enforced = feeData?.enforcedRoyaltyFee ?? 0;
    const optional = feeData?.optionalRoyaltyFee ?? 0;
    const includeOptional = royaltyOn[k] !== false;
    const rFee = enforced + (includeOptional ? optional : 0);
    const totalFeePct = mFee + rFee;
    const proceeds = (parseFloat(price) * (1 - totalFeePct / 100)).toFixed(4);
    const royaltyNote = enforced > 0 && optional > 0
      ? `${enforced.toFixed(1)}% enforced + ${optional.toFixed(1)}% optional (${includeOptional ? 'ON' : 'OFF'})`
      : rFee > 0 ? `${rFee.toFixed(1)}%${enforced > 0 ? ' (enforced)' : ''}` : 'none';
    if (!window.confirm(
      `List ${nft.collectionName || nft.collectionSlug} #${nft.tokenId} for ${price} ETH?\n\n` +
      `OpenSea fee: ${mFee.toFixed(1)}%\nCreator royalty: ${royaltyNote}\nTotal: ${totalFeePct.toFixed(1)}%\n` +
      `You receive: ~${proceeds} ETH after fees`
    )) return;
    setBusy((p) => ({ ...p, [k]: true }));
    try {
      await tradesApi.sell(nft.contractAddress, nft.tokenId, parseFloat(price), nft.chain || 'ethereum');
      alert('Listed on OpenSea! It will sell when someone buys at your price.');
      closeAction(k);
      // Refresh so the card shows the listed badge + price
      const updated = await portfolioApi.get();
      if (setPortfolio) setPortfolio(updated);
    } catch (err) {
      alert(`List failed: ${err.response?.data?.error || err.message}`);
    }
    setBusy((p) => ({ ...p, [k]: false }));
  };

  const handleAcceptOffer = async (k, nft) => {
    const offerEth = bestOffers[k]?.priceEth;
    if (!nft.contractAddress || !nft.tokenId) {
      return alert('NFT is missing contract/token data — cannot accept offer');
    }
    if (!offerEth) return alert('No offer found for this NFT');
    if (!window.confirm(
      `Accept best offer of ${fmt(offerEth)} ETH for ${nft.collectionName || nft.collectionSlug} #${nft.tokenId}?\n\nThis sells the NFT immediately on-chain.`
    )) return;
    setBusy((p) => ({ ...p, [k]: true }));
    try {
      await tradesApi.acceptOffer(nft.contractAddress, nft.tokenId, nft.collectionSlug, nft.chain || 'ethereum');
      alert(`Sold for ${fmt(offerEth)} ETH! NFT removed from portfolio.`);
      closeAction(k);
    } catch (err) {
      alert(`Accept offer failed: ${err.response?.data?.error || err.message}`);
    }
    setBusy((p) => ({ ...p, [k]: false }));
  };

  const toggleSelected = (k) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  const exitBulkMode = () => { setBulkMode(false); setBulkAcceptMode(false); setSelected(new Set()); setBulkPrice(''); setBulkProgress(''); };

  const handleBulkAcceptOffer = async () => {
    const toAccept = (portfolio || []).filter((nft, i) => {
      const k = cardKey(nft, i);
      return selected.has(k) && nft.contractAddress && nft.tokenId && nft.collectionSlug;
    });
    if (!toAccept.length) return alert('No valid NFTs selected (need contract + token ID)');
    if (!window.confirm(`Accept best offers for ${toAccept.length} NFT${toAccept.length > 1 ? 's' : ''}?\n\nThis sells each immediately on-chain at the current best offer price.`)) return;
    setBulkBusy(true);
    let done = 0, failed = 0;
    for (const nft of toAccept) {
      const i = portfolio.indexOf(nft);
      const k = cardKey(nft, i);
      setBulkProgress(`Accepting offer ${done + failed + 1} / ${toAccept.length}…`);
      try {
        await tradesApi.acceptOffer(nft.contractAddress, nft.tokenId, nft.collectionSlug, nft.chain || 'ethereum');
        done++;
      } catch (err) {
        failed++;
        console.error(`Bulk accept failed for ${nft.tokenId}:`, err.response?.data?.error || err.message);
      }
    }
    setBulkBusy(false);
    setBulkProgress('');
    const updated = await portfolioApi.get();
    if (setPortfolio) setPortfolio(updated);
    exitBulkMode();
    alert(failed === 0
      ? `Accepted offers and sold ${done} NFT${done > 1 ? 's' : ''}!`
      : `${done} sold, ${failed} failed — check console for details`);
  };

  const handleBulkList = async () => {
    const price = parseFloat(bulkPrice);
    if (!price || isNaN(price) || price <= 0) return alert('Enter a valid price in ETH');
    const toList = (portfolio || []).filter((nft, i) => {
      const k = cardKey(nft, i);
      return selected.has(k) && nft.contractAddress && nft.tokenId;
    });
    if (!toList.length) return alert('No valid NFTs selected');
    if (!window.confirm(`List ${toList.length} NFT${toList.length > 1 ? 's' : ''} for ${price} ETH each?\n\nThis creates ${toList.length} separate listing${toList.length > 1 ? 's' : ''} on OpenSea.`)) return;
    setBulkBusy(true);
    let done = 0, failed = 0;
    for (const nft of toList) {
      setBulkProgress(`Listing ${done + 1} / ${toList.length}…`);
      try {
        await tradesApi.sell(nft.contractAddress, nft.tokenId, price, nft.chain || 'ethereum');
        done++;
      } catch (err) {
        failed++;
        console.error(`Bulk list failed for ${nft.tokenId}:`, err.response?.data?.error || err.message);
      }
    }
    setBulkBusy(false);
    setBulkProgress('');
    const updated = await portfolioApi.get();
    if (setPortfolio) setPortfolio(updated);
    exitBulkMode();
    alert(failed === 0
      ? `Listed ${done} NFT${done > 1 ? 's' : ''} on OpenSea!`
      : `${done} listed, ${failed} failed — check console for details`);
  };

  // Use live floor price from state; fall back to stale stored floor only if live not yet loaded
  const liveFloor = (nft) => {
    const slug = nft.collectionSlug;
    if (slug && slug in floorPrices) return floorPrices[slug];
    return nft.floorPriceEth ?? null;
  };

  const totalCost  = (portfolio || []).reduce((sum, n) => sum + (n.buyPriceEth || 0), 0);
  const totalValue = (portfolio || []).reduce((sum, n) => sum + (liveFloor(n) || 0), 0);
  const totalPnlEth = (portfolio || []).reduce((sum, n) => {
    const fp = liveFloor(n);
    if (!fp || !n.buyPriceEth) return sum;
    return sum + (fp * 0.925 - n.buyPriceEth);
  }, 0);
  const totalPnlPct = totalCost > 0 ? (totalPnlEth / totalCost) * 100 : null;
  const canSell = (nft) => !!(nft.contractAddress && nft.tokenId);

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Portfolio</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', marginTop: 4, fontSize: 13, color: '#94a3b8' }}>
            <span>{(portfolio || []).length} NFTs</span>
            <span>
              Cost: <strong style={{ color: '#f1f5f9' }}>{fmt(totalCost, 4)} ETH</strong>
              {ethPrice && totalCost > 0 && <span style={{ color: '#64748b' }}> ({fmtUsd(totalCost)})</span>}
            </span>
            {totalValue > 0 && (
              <span>
                Value: <strong style={{ color: '#f1f5f9' }}>{fmt(totalValue, 4)} ETH</strong>
                {ethPrice && <span style={{ color: '#64748b' }}> ({fmtUsd(totalValue)})</span>}
              </span>
            )}
            {totalPnlPct != null && (
              <span>
                P&amp;L:{' '}
                <strong style={{ color: totalPnlEth >= 0 ? '#22c55e' : '#ef4444' }}>
                  {totalPnlEth >= 0 ? '+' : ''}{fmt(totalPnlEth, 4)} ETH
                </strong>
                <span style={{ color: totalPnlEth >= 0 ? '#22c55e' : '#ef4444', marginLeft: 4 }}>
                  ({totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(1)}%)
                </span>
                <span style={{ color: '#475569', fontSize: 11, marginLeft: 4 }}>after fees</span>
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button style={styles.syncBtn} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? '...' : floorLoading ? '↻ Updating floors…' : '↻ Refresh'}
          </button>
          {!bulkMode && !bulkAcceptMode ? (
            <>
              <button style={{ ...styles.syncBtn, color: '#a855f7', borderColor: '#7c3aed' }} onClick={() => setBulkMode(true)} disabled={!portfolio?.length}>
                ☐ Bulk List
              </button>
              <button style={{ ...styles.syncBtn, color: '#22c55e', borderColor: '#16a34a' }} onClick={() => setBulkAcceptMode(true)} disabled={!portfolio?.length}>
                ⚡ Bulk Accept
              </button>
            </>
          ) : (
            <button style={{ ...styles.syncBtn, color: '#ef4444', borderColor: '#ef4444' }} onClick={exitBulkMode}>
              ✕ Cancel Bulk
            </button>
          )}
          <button style={styles.syncBtn} onClick={() => handleSync('ethereum')} disabled={syncing}>
            {syncing ? 'Syncing...' : '+ Sync ETH Wallet'}
          </button>
          <button style={styles.syncBtn} onClick={() => handleSync('base')} disabled={syncing}>
            {syncing ? '' : '+ Sync Base Wallet'}
          </button>
        </div>
      </div>

      {!portfolio?.length ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>◇</div>
          <div>No NFTs in portfolio yet.</div>
          <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
            NFTs appear here when the bot buys them or when you mark a bid as filled.
          </div>
        </div>
      ) : (
        <div style={styles.grid}>
          {portfolio.map((nft, i) => {
            const k = cardKey(nft, i);
            const mode = action[k];
            const offerData = bestOffers[k];
            const feeData = fees[k];
            const sellable = canSell(nft);
            // Use live floor price; fall back to best offer or stale floor
            const currentFloor = liveFloor(nft);
            const exitPrice = offerData?.priceEth ?? currentFloor;
            const profit = exitPrice && nft.buyPriceEth
              ? (((exitPrice * 0.925) - nft.buyPriceEth) / nft.buyPriceEth * 100)
              : null;
            // Floor delta vs stored purchase-time floor (shows how floor moved)
            const floorDelta = currentFloor != null && nft.floorPriceEth != null && nft.floorPriceEth > 0
              ? currentFloor - nft.floorPriceEth
              : null;

            const imgSrc = nft.collectionImage || (nftImages[k] !== 'loading' ? nftImages[k] : null);
            const isSelected = selected.has(k);

            return (
              <div
                key={k}
                style={{ ...styles.card, ...(isSelected ? styles.cardSelected : {}) }}
                onClick={(bulkMode || bulkAcceptMode) && sellable ? () => toggleSelected(k) : undefined}
              >
                {/* Bulk mode checkbox overlay */}
                {(bulkMode || bulkAcceptMode) && (
                  <div style={styles.checkboxOverlay}>
                    <div style={{ ...styles.checkbox, ...(isSelected ? styles.checkboxChecked : {}) }}>
                      {isSelected && '✓'}
                    </div>
                    {!sellable && <span style={styles.checkboxDisabledNote}>no token ID</span>}
                  </div>
                )}
                <div style={styles.cardTop}>
                  {imgSrc ? (
                    <img
                      src={imgSrc}
                      alt=""
                      style={styles.thumb}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{ ...styles.thumb, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e293b', color: '#334155', fontSize: 20 }}>
                      {nftImages[k] === 'loading' ? '' : '◇'}
                    </div>
                  )}
                  <div style={styles.cardTopText}>
                    <div style={styles.name}>{nft.collectionName || nft.collectionSlug}</div>
                    <div style={styles.tokenId} className="mono">
                      {nft.tokenId
                        ? `#${nft.tokenId}`
                        : <span style={{ color: '#475569' }}>token unknown</span>}
                    </div>
                  </div>
                </div>
                <div style={styles.info}>

                  {nft.listed && (
                    <div style={styles.listedBadge}>
                      <span style={styles.listedDot}>●</span>
                      Listed for {fmt(nft.listingPriceEth)} ETH
                    </div>
                  )}

                  <div style={styles.meta}>
                    <MetaItem label="Paid" value={`${fmt(nft.buyPriceEth)} ETH`} sub={fmtUsd(nft.buyPriceEth)} />
                    <MetaItem
                      label={floorLoading && currentFloor == null ? 'Floor…' : 'Floor (live)'}
                      value={
                        floorLoading && currentFloor == null
                          ? <span style={{ color: '#475569' }}>loading…</span>
                          : currentFloor != null
                            ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span>{fmt(currentFloor)} ETH</span>
                                {floorDelta != null && (
                                  <span style={{ fontSize: 10, fontWeight: 600, color: floorDelta >= 0 ? '#22c55e' : '#ef4444' }}>
                                    {floorDelta >= 0 ? '+' : ''}{fmt(floorDelta, 4)}
                                  </span>
                                )}
                              </span>
                            )
                            : <span style={{ color: '#475569' }}>—</span>
                      }
                      sub={currentFloor != null ? fmtUsd(currentFloor) : null}
                    />
                    {profit != null && (
                      <MetaItem
                        label={offerData?.priceEth ? 'P&L (bid)' : 'P&L (floor)'}
                        value={
                          <span style={{ color: profit >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                            {profit >= 0 ? '+' : ''}{profit.toFixed(1)}%
                            {nft.buyPriceEth && exitPrice && (
                              <span style={{ fontWeight: 400, marginLeft: 4, fontSize: 11 }}>
                                ({profit >= 0 ? '+' : ''}{fmt((exitPrice * 0.925) - nft.buyPriceEth, 4)} ETH)
                              </span>
                            )}
                          </span>
                        }
                        sub="after fees"
                      />
                    )}
                    {nft.acquiredAt && (
                      <MetaItem label="Acquired" value={format(new Date(nft.acquiredAt), 'MMM d HH:mm')} />
                    )}
                    {nft.acquiredVia === 'bid_fill' && (
                      <MetaItem label="Via" value="Bid fill" />
                    )}
                  </div>

                  {/* Sell buttons — hidden in bulk mode or when an action is open */}
                  {!mode && !bulkMode && !bulkAcceptMode && (
                    <div style={styles.btnRow}>
                      {sellable ? (
                        <button style={styles.btnOffer} onClick={() => openAction(k, nft, 'offer')}>
                          ⚡ Accept Offer
                        </button>
                      ) : (
                        <button style={styles.btnOfferDisabled} disabled title="Token ID unknown — cannot sell">
                          ⚡ Accept Offer
                        </button>
                      )}
                      {sellable ? (
                        <button style={styles.btnList} onClick={() => openAction(k, nft, 'list')}>
                          List for Price
                        </button>
                      ) : (
                        <button style={styles.btnListDisabled} disabled title="Token ID unknown — cannot list">
                          List for Price
                        </button>
                      )}
                    </div>
                  )}

                  {/* List for price form */}
                  {mode === 'list' && (
                    <div style={styles.actionBox}>
                      <div style={styles.actionLabel}>Set listing price (ETH)</div>
                      <div style={styles.inputRow}>
                        <input
                          style={styles.input}
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="0.00 ETH"
                          value={listPrice[k] || ''}
                          onChange={(e) => setListPrice((p) => ({ ...p, [k]: e.target.value }))}
                          autoFocus
                        />
                        <button
                          style={styles.btnConfirm}
                          onClick={() => handleList(k, nft)}
                          disabled={busy[k]}
                        >
                          {busy[k] ? '...' : 'List'}
                        </button>
                        <button style={styles.btnX} onClick={() => closeAction(k)}>✗</button>
                      </div>

                      {/* Fee breakdown */}
                      <FeeBreakdown
                        feeData={feeData}
                        listPrice={listPrice[k]}
                        royaltyOn={royaltyOn[k] !== false}
                        onToggleRoyalty={() => setRoyaltyOn((p) => ({ ...p, [k]: !(p[k] !== false) }))}
                      />
                    </div>
                  )}

                  {/* Accept offer form */}
                  {mode === 'offer' && (
                    <div style={styles.actionBox}>
                      <div style={styles.actionLabel}>Accept best offer — sell now</div>
                      {offerData?.loading && (
                        <div style={{ fontSize: 12, color: '#6366f1' }}>Fetching best offer...</div>
                      )}
                      {!offerData?.loading && offerData?.priceEth != null && (
                        <div style={styles.offerPrice}>
                          Best offer:{' '}
                          <span style={{ color: '#22c55e', fontWeight: 700 }}>{fmt(offerData.priceEth)} ETH</span>
                          {fmtUsd(offerData.priceEth) && (
                            <span style={{ color: '#64748b' }}> ({fmtUsd(offerData.priceEth)})</span>
                          )}
                          {nft.buyPriceEth && (
                            <span style={{ color: offerData.priceEth > nft.buyPriceEth ? '#22c55e' : '#ef4444', marginLeft: 8 }}>
                              {offerData.priceEth > nft.buyPriceEth ? '+' : ''}
                              {((offerData.priceEth - nft.buyPriceEth) / nft.buyPriceEth * 100).toFixed(1)}%
                            </span>
                          )}
                        </div>
                      )}
                      {!offerData?.loading && offerData && offerData.priceEth == null && (
                        <div style={{ fontSize: 12, color: '#ef4444', padding: '4px 0' }}>
                          No offers found for this NFT.
                        </div>
                      )}
                      <div style={styles.inputRow}>
                        <button
                          style={offerData?.priceEth ? styles.btnConfirmOffer : styles.btnConfirmOfferDisabled}
                          onClick={() => handleAcceptOffer(k, nft)}
                          disabled={busy[k] || !offerData?.priceEth}
                        >
                          {busy[k] ? 'Selling...' : '⚡ Accept & Sell Now'}
                        </button>
                        <button style={styles.btnX} onClick={() => closeAction(k)}>✗</button>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                        Executes on-chain immediately. NFT transfers out, WETH transfers in.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bulk listing bottom action bar */}
      {bulkMode && (
        <div style={styles.bulkBar}>
          <div style={styles.bulkBarInner}>
            <span style={styles.bulkCount}>
              {selected.size} NFT{selected.size !== 1 ? 's' : ''} selected
            </span>
            <div style={styles.bulkInputRow}>
              <input
                style={styles.bulkInput}
                type="number"
                step="0.001"
                min="0"
                placeholder="Price per NFT (ETH)"
                value={bulkPrice}
                onChange={(e) => setBulkPrice(e.target.value)}
              />
              <button
                style={{ ...styles.btnConfirm, opacity: (!selected.size || !bulkPrice || bulkBusy) ? 0.5 : 1 }}
                onClick={handleBulkList}
                disabled={!selected.size || !bulkPrice || bulkBusy}
              >
                {bulkBusy ? (bulkProgress || 'Listing…') : `List ${selected.size || ''} for ${bulkPrice || '?'} ETH each`}
              </button>
              <button style={styles.btnX} onClick={exitBulkMode}>✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk accept offer bottom action bar */}
      {bulkAcceptMode && (
        <div style={styles.bulkBar}>
          <div style={styles.bulkBarInner}>
            <span style={styles.bulkCount}>
              {selected.size} NFT{selected.size !== 1 ? 's' : ''} selected
            </span>
            <div style={styles.bulkInputRow}>
              <button
                style={{ ...styles.btnConfirm, background: '#16a34a', opacity: (!selected.size || bulkBusy) ? 0.5 : 1 }}
                onClick={handleBulkAcceptOffer}
                disabled={!selected.size || bulkBusy}
              >
                {bulkBusy ? (bulkProgress || 'Accepting…') : `⚡ Accept Best Offers for ${selected.size || 0} NFT${selected.size !== 1 ? 's' : ''}`}
              </button>
              <button style={styles.btnX} onClick={exitBulkMode}>✕</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeeBreakdown({ feeData, listPrice, royaltyOn, onToggleRoyalty }) {
  const mFee = feeData?.marketplaceFee ?? 1.0;
  const enforced = feeData?.enforcedRoyaltyFee ?? 0;
  const optional = feeData?.optionalRoyaltyFee ?? 0;
  const hasOptional = optional > 0;
  const isEnforced = enforced > 0 && optional === 0; // only enforced, no choice
  const activeRoyalty = enforced + (royaltyOn && hasOptional ? optional : 0);
  const total = mFee + activeRoyalty;
  const price = parseFloat(listPrice);

  if (feeData?.loading) {
    return <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Loading fees...</div>;
  }

  return (
    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Marketplace fee row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#94a3b8' }}>OpenSea fee:</span>
        <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{mFee.toFixed(1)}%</span>
      </div>

      {/* Creator royalty row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#94a3b8' }}>Creator royalty:</span>
        {enforced > 0 && (
          <span style={{ color: '#f59e0b', fontWeight: 600 }}>{enforced.toFixed(1)}% enforced</span>
        )}
        {hasOptional && (
          <>
            {enforced > 0 && <span style={{ color: '#475569' }}>+</span>}
            <span style={{ color: royaltyOn ? '#f1f5f9' : '#475569', fontWeight: 600 }}>{optional.toFixed(1)}% optional</span>
            <button
              onClick={onToggleRoyalty}
              style={{
                padding: '1px 7px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700,
                background: royaltyOn ? '#22c55e22' : '#33415555',
                color: royaltyOn ? '#22c55e' : '#64748b',
              }}
            >
              {royaltyOn ? 'ON' : 'OFF'}
            </button>
          </>
        )}
        {!enforced && !hasOptional && (
          <span style={{ color: '#475569' }}>none</span>
        )}
        {isEnforced && (
          <span style={{ color: '#f59e0b', fontSize: 10 }}> — cannot waive</span>
        )}
      </div>

      {/* Total + proceeds */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid #1e293b', paddingTop: 4 }}>
        <span style={{ color: '#94a3b8' }}>Total fees:</span>
        <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{total.toFixed(1)}%</span>
        {!isNaN(price) && price > 0 && (
          <span style={{ color: '#22c55e', marginLeft: 4 }}>
            → ~{(price * (1 - total / 100)).toFixed(4)} ETH to you
          </span>
        )}
      </div>
    </div>
  );
}

function MetaItem({ label, value, sub }) {
  return (
    <div style={{ marginRight: 16, marginBottom: 4 }}>
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b' }}>{sub}</div>}
    </div>
  );
}

const styles = {
  page: { padding: 28, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  h1: { fontSize: 24, fontWeight: 700 },
  sub: { color: '#64748b', fontSize: 13, marginTop: 2 },
  empty: { textAlign: 'center', padding: '60px 0', color: '#64748b', fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  emptyIcon: { fontSize: 40, color: '#334155' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  card: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', cursor: 'default' },
  cardTop: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #1e293b' },
  thumb: { width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: '#1e293b' },
  cardTopText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  info: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 },
  name: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tokenId: { fontSize: 12, color: '#64748b' },
  meta: { display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 4 },
  btnRow: { display: 'flex', gap: 8 },
  btnOffer: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnOfferDisabled: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#1e293b', color: '#475569', fontWeight: 700, fontSize: 13, cursor: 'not-allowed' },
  btnList: { flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  btnListDisabled: { flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#334155', fontWeight: 600, fontSize: 13, cursor: 'not-allowed' },
  actionBox: { background: '#0a1020', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #1e293b' },
  actionLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: { display: 'flex', gap: 6 },
  input: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, outline: 'none' },
  btnConfirm: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnConfirmOffer: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  btnConfirmOfferDisabled: { flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#1e293b', color: '#475569', fontWeight: 700, fontSize: 13, cursor: 'not-allowed' },
  btnX: { padding: '8px 10px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  offerPrice: { fontSize: 14, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  syncBtn: { padding: '8px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 12, cursor: 'pointer' },
  listedBadge: { display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: '#c084fc' },
  listedDot: { color: '#a855f7', fontSize: 8 },
  cardSelected: { border: '1px solid #7c3aed', boxShadow: '0 0 0 2px rgba(124,58,237,0.3)' },
  checkboxOverlay: { position: 'absolute', top: 10, right: 10, zIndex: 2, display: 'flex', alignItems: 'center', gap: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 6, border: '2px solid #334155', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' },
  checkboxChecked: { background: '#7c3aed', borderColor: '#7c3aed' },
  checkboxDisabledNote: { fontSize: 10, color: '#475569' },
  bulkBar: { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#0f172a', borderTop: '1px solid #334155', padding: '12px 24px', boxShadow: '0 -4px 24px rgba(0,0,0,0.5)' },
  bulkBarInner: { maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  bulkCount: { fontSize: 14, fontWeight: 700, color: '#a855f7', whiteSpace: 'nowrap' },
  bulkInputRow: { display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' },
  bulkInput: { width: 200, padding: '9px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#f1f5f9', fontSize: 13, outline: 'none' },
};
