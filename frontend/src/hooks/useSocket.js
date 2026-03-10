import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// In production the socket connects to the same origin (Railway URL).
// In local dev, point to the backend dev port.
const SOCKET_URL = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:3001');

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);

  // State slices
  const [walletInfo, setWalletInfo] = useState(null);
  const [botRunning, setBotRunning] = useState(false);
  const [portfolio, setPortfolio] = useState([]);
  const [trades, setTrades] = useState([]);
  const [bids, setBids] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [stats, setStats] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [logs, setLogs] = useState([]);

  const addLog = useCallback((type, message, data) => {
    setLogs((prev) => [
      { id: Date.now(), type, message, data, time: new Date().toISOString() },
      ...prev.slice(0, 199),
    ]);
  }, []);

  useEffect(() => {
    const pw = sessionStorage.getItem('nftbot_auth') || '';
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: { token: pw },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      addLog('info', 'Connected to bot server');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      addLog('warn', 'Disconnected from bot server');
    });

    socket.on('init', (data) => {
      if (data.walletInfo) setWalletInfo(data.walletInfo);
      setBotRunning(data.botRunning || false);
      setPortfolio(data.portfolio || []);
      setTrades(data.trades || []);
      setBids(data.bids || []);
      setPendingApprovals(data.pendingApprovals || []);
      if (data.stats) setStats(data.stats);
      if (data.opportunities?.length) setOpportunities(data.opportunities);
      addLog('info', 'Bot state initialized');
    });

    // Bot events
    socket.on('bot:started', () => { setBotRunning(true); addLog('success', 'Bot started'); });
    socket.on('bot:stopped', () => { setBotRunning(false); addLog('info', 'Bot stopped'); });
    socket.on('bot:cycle', (d) => addLog('info', 'Scan cycle running...', d));
    socket.on('bot:balance', (d) => addLog('info', `Balance: ${d.balanceEth?.toFixed(4)} ETH`));
    socket.on('bot:warn', (d) => addLog('warn', d.message));
    socket.on('bot:error', (d) => addLog('error', d.message));

    // Scan events
    socket.on('scan:started', () => { setScanning(true); addLog('info', 'Scanning OpenSea...'); });
    socket.on('scan:opportunities', (d) => {
      setScanning(false);
      setOpportunities(d.opportunities || []);
      addLog('success', `Found ${d.count} opportunities`);
      setLastEvent({ type: 'scan:opportunities', data: d });
    });
    socket.on('scan:error', (d) => { setScanning(false); addLog('error', `Scan error: ${d.message}`); });

    // Trade events
    socket.on('trade:buy', (d) => {
      addLog('success', `Bought: ${d.collectionName} #${d.tokenId} @ ${d.listingPriceEth} ETH`);
      setPortfolio((prev) => [...prev, d]);
    });
    socket.on('trade:sell', (d) => {
      addLog('success', `Sell listed: ${d.collectionName} #${d.tokenId} @ ${d.priceEth} ETH (+${d.profitEth?.toFixed(4)} ETH profit)`);
      setPortfolio((prev) => prev.filter((n) => !(n.tokenId === d.tokenId && n.contractAddress === d.contractAddress)));
    });
    socket.on('trade:bid', (d) => {
      addLog('info', `Bid placed on ${d.collectionSlug} @ ${d.offerAmountEth} ETH`);
      setBids((prev) => [...prev, d]);
    });
    socket.on('trade:error', (d) => addLog('error', `Trade error (${d.action}): ${d.error}`));
    socket.on('trade:bid_filled', (d) => {
      addLog('success', `Bid filled! ${d.collectionSlug} acquired @ ${d.offerAmountEth} ETH`);
      if (d.trade) setTrades((prev) => [d.trade, ...prev]);
      if (d.portfolioEntry) setPortfolio((prev) => [...prev, d.portfolioEntry]);
      if (d.orderHash) setBids((prev) => prev.filter((b) => b.orderHash !== d.orderHash));
    });
    // Full portfolio sync (from sync endpoint or bid-fill poller)
    socket.on('portfolio:sync', (d) => {
      if (d.portfolio) setPortfolio(d.portfolio);
    });
    socket.on('trade:list', (d) => {
      addLog('info', `Listed: ${d.collectionSlug || ''} #${d.tokenId} for ${d.priceEth} ETH`);
      setTrades((prev) => [{
        type: 'list',
        contractAddress: d.contractAddress,
        tokenId: d.tokenId,
        collectionSlug: d.collectionSlug,
        priceEth: d.priceEth,
        orderHash: d.orderHash,
        timestamp: new Date().toISOString(),
      }, ...prev]);
      setPortfolio((prev) => prev.map((n) =>
        n.contractAddress?.toLowerCase() === d.contractAddress?.toLowerCase() && n.tokenId === d.tokenId
          ? { ...n, listed: true, listingPriceEth: d.priceEth, listingOrderHash: d.orderHash }
          : n
      ));
    });

    // Sniper events
    socket.on('sniper:fill', (d) => {
      addLog('success', `Sniper filled: ${d.id} @ ${d.priceEth} ETH — tx ${d.txHash?.slice(0, 16)}…`);
      setTrades((prev) => [{
        type: 'buy',
        collectionSlug: d.collectionSlug,
        priceEth: d.priceEth,
        txHash: d.txHash,
        source: 'sniper',
        timestamp: new Date().toISOString(),
      }, ...prev]);
    });
    socket.on('sniper:done', (d) => {
      addLog('success', `Sniper fully filled: ${d.collectionSlug}`);
    });
    socket.on('sniper:cancelled', (d) => {
      addLog('info', `Sniper cancelled: ${d.id}`);
    });
    socket.on('sniper:error', (d) => {
      addLog('error', `Sniper buy error (${d.id}): ${d.error}`);
    });

    // Wallet
    socket.on('wallet:connected', (d) => {
      setWalletInfo(d);
      addLog('success', `Wallet connected: ${d.address}`);
    });

    // Approvals
    socket.on('approval:queued', (d) => {
      addLog('warn', `Approval needed: ${d.action} — ${d.opportunity?.collectionName || d.collectionSlug}`);
      setPendingApprovals((prev) => {
        const exists = prev.find((a) => a.id === d.id);
        if (exists) return prev;
        return [...prev, { ...d, status: 'pending', createdAt: new Date().toISOString() }];
      });
    });
    socket.on('approval:resolved', (d) => {
      setPendingApprovals((prev) => prev.filter((a) => a.id !== d.id));
    });

    return () => socket.disconnect();
  }, [addLog]);

  return {
    connected,
    lastEvent,
    walletInfo,
    botRunning,
    portfolio,
    setPortfolio,
    trades,
    bids,
    setBids,
    pendingApprovals,
    stats,
    opportunities,
    scanning,
    logs,
  };
}
