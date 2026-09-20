import React, { useState, useEffect } from 'react';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Key,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
  Search,
  SlidersHorizontal,
  Lock,
  DollarSign,
  PieChart,
  TrendingUp,
  Clock
} from 'lucide-react';
import { BinanceAccountState, BinanceAssetWithUsd, Fill } from '../../types/trading';
import { fetchLiveAssets, updateBinanceKeys } from '../../services/tradingService';

interface AssetDashboardProps {
  onNavigateToTrade?: () => void;
  isOwnerAuthenticated?: boolean;
  onOpenOwnerLogin?: () => void;
}

export const AssetDashboard: React.FC<AssetDashboardProps> = ({
  onNavigateToTrade,
  isOwnerAuthenticated,
  onOpenOwnerLogin
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [account, setAccount] = useState<BinanceAccountState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hideSmallBalances, setHideSmallBalances] = useState<boolean>(true);
  const [copiedIp, setCopiedIp] = useState<boolean>(false);
  const [tradeAsset, setTradeAsset] = useState<string | null>(null);

  // Key update modal state
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [newApiKey, setNewApiKey] = useState<string>('');
  const [newApiSecret, setNewApiSecret] = useState<string>('');
  const [updatingKeys, setUpdatingKeys] = useState<boolean>(false);
  const [keyUpdateFeedback, setKeyUpdateFeedback] = useState<string | null>(null);

  const loadAssets = async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetchLiveAssets(force);
      setAccount(res.assets);
      if (!res.success && res.assets.message) {
        setErrorMsg(res.assets.message);
      } else {
        setErrorMsg(null);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load exchange assets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAssets(false);
    const interval = setInterval(() => {
      loadAssets(false);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleCopyIp = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApiKey.trim() || !newApiSecret.trim()) {
      setKeyUpdateFeedback('Both API Key and Secret are required.');
      return;
    }

    setUpdatingKeys(true);
    setKeyUpdateFeedback(null);
    try {
      const res = await updateBinanceKeys(newApiKey.trim(), newApiSecret.trim());
      if (res.success) {
        setKeyUpdateFeedback('Success! Binance credentials applied.');
        setTimeout(() => {
          setShowKeyModal(false);
          setNewApiKey('');
          setNewApiSecret('');
          setKeyUpdateFeedback(null);
          loadAssets(true);
        }, 1200);
      } else {
        setKeyUpdateFeedback(res.error || 'Failed to update credentials.');
      }
    } catch (err: any) {
      setKeyUpdateFeedback(err.message || 'Error communicating with server.');
    } finally {
      setUpdatingKeys(false);
    }
  };

  // Filter balances
  const filteredBalances = (account?.spotBalances || []).filter((item: BinanceAssetWithUsd) => {
    const matchesSearch = item.asset.toLowerCase().includes(searchQuery.toLowerCase().trim());
    if (!matchesSearch) return false;
    if (hideSmallBalances && item.usdValue < 1.0) return false;
    return true;
  });

  const isRestricted = account?.status === 'RESTRICTED';
  const isConnected = account?.status === 'CONNECTED';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. TOP HEADER & SYNC BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">Real Binance Spot Assets</h1>
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                LIVE EXCHANGE
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Personal portfolio balances and verified trade executions from Binance Spot REST API.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowKeyModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>API Credentials</span>
          </button>

          <button
            onClick={() => loadAssets(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold transition shadow-md shadow-emerald-950"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Syncing...' : 'Sync from Binance'}</span>
          </button>
        </div>
      </div>

      {/* 2. CONNECTION DIAGNOSTICS & IP WHITELIST NOTIFICATION */}
      {isRestricted ? (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-700/60 text-amber-200 text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-300">Binance API Notice (Error Code -2015: Restricted IP or Permissions)</p>
              <p className="text-amber-300/80 mt-1 leading-relaxed">
                Your Binance API keys are configured, but Binance requires your EC2 Server IP to be added to your IP Whitelist,
                or set to "Unrestricted" in Binance API Management.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 bg-slate-900/90 border border-amber-800/80 px-3 py-2 rounded-lg">
            <span className="text-[11px] text-slate-400">Server Public IP:</span>
            <code className="text-xs font-mono font-bold text-amber-300">{account?.serverIp || '3.222.149.9'}</code>
            <button
              onClick={() => handleCopyIp(account?.serverIp || '3.222.149.9')}
              className="p-1 text-slate-400 hover:text-white transition"
              title="Copy Server IP"
            >
              {copiedIp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      ) : isConnected ? (
        <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">Binance Spot Connected</span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-300 font-mono">Key: {account?.keyMask}</span>
          </div>
          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
            <span>Trading Permissions: <strong className="text-emerald-400">{account?.canTrade ? 'Enabled' : 'Read-Only'}</strong></span>
            <span>•</span>
            <span>Account Type: <strong className="text-slate-300">{account?.accountType || 'SPOT'}</strong></span>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-300 text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="font-semibold text-slate-200">Connect Your Binance Spot Account</p>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Enter your Binance API key and Secret to stream real balances and manage orders with real capital.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowKeyModal(true)}
            className="px-3.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs transition"
          >
            Configure Keys
          </button>
        </div>
      )}

      {/* 3. CORE ASSET METRICS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Equity */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Total Portfolio Value</span>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-slate-100">
              ${account ? account.totalEquityUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>Real-time Binance Spot Mark</span>
            </div>
          </div>
        </div>

        {/* Free Cash / USDT */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Available Free Cash</span>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-slate-100">
              ${account ? account.availableCashUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-blue-400">
              <span>Ready for grid deployment</span>
            </div>
          </div>
        </div>

        {/* Locked in Orders */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Locked in Open Orders</span>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Lock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-slate-100">
              ${account ? account.lockedInOrdersUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-amber-400">
              <span>{account?.openOrdersCount || 0} active exchange orders</span>
            </div>
          </div>
        </div>

        {/* Withdrawable Profit */}
        <div className="bg-slate-900/80 border border-emerald-800/50 rounded-xl p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-400">Withdrawable Profit</span><div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400"><TrendingUp className="w-4 h-4" /></div></div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-emerald-400">${account ? account.withdrawableProfitUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}</div>
            <div className="mt-1 text-[11px] text-slate-500">Equity − initial capital − reserve buffer</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 rounded-xl p-4">
        <div><div className="text-sm font-bold text-slate-200">Binance Spot Wallet</div><div className="text-[11px] text-slate-500 mt-0.5">Deposits and withdrawals are handled only by Binance. GigPilot does not custody funds.</div></div>
        <div className="flex gap-2">
          <a href="https://www.binance.com/en/my/wallet/account/main/deposit/crypto" target="_blank" rel="noopener noreferrer" className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5"><ArrowDownRight className="w-3.5 h-3.5" /> Deposit</a>
          <a href="https://www.binance.com/en/my/wallet/account/main/withdrawal/crypto" target="_blank" rel="noopener noreferrer" className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 inline-flex items-center gap-1.5"><ArrowUpRight className="w-3.5 h-3.5" /> Withdraw</a>
        </div>
      </div>

      {/* 4. REAL SPOT ASSETS TABLE */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Spot Portfolio Balances</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              {filteredBalances.length} shown
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter coin (e.g. BTC, USDT)..."
                className="pl-8 pr-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 w-44"
              />
            </div>

            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideSmallBalances}
                onChange={(e) => setHideSmallBalances(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0 focus:ring-offset-0"
              />
              <span>Hide &lt; $1</span>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Asset</th><th className="py-3 px-4 text-right">Amount</th><th className="py-3 px-4 text-right">Value (USD)</th><th className="py-3 px-4 text-right">% of Portfolio</th><th className="py-3 px-4 text-right">24h Change</th><th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredBalances.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 font-sans">
                    {loading ? (
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
                        <span>Querying live Binance spot balances...</span>
                      </div>
                    ) : isRestricted ? (
                      <div className="max-w-md mx-auto p-4 rounded-lg bg-amber-950/20 border border-amber-800/40 text-amber-300 text-xs">
                        <p className="font-semibold">Binance API Key is Restricted</p>
                        <p className="mt-1 text-slate-400 font-normal">
                          Please whitelist server IP <strong className="text-amber-300 font-mono">{account?.serverIp}</strong> in Binance or update your keys to load your live balances.
                        </p>
                      </div>
                    ) : (
                      <span>No spot balances found matching filter.</span>
                    )}
                  </td>
                </tr>
              ) : (
                filteredBalances.map((item) => (
                  <tr key={item.asset} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-bold text-slate-100 flex items-center gap-2.5"><div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-[10px] text-amber-400">{item.asset.slice(0, 3)}</div><span className="font-sans font-bold">{item.asset}</span></td>
                    <td className="py-3 px-4 text-right text-slate-200">{item.total.toLocaleString("en-US", { maximumFractionDigits: 8 })}</td>
                    <td className="py-3 px-4 text-right font-bold text-emerald-400">${item.usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="py-3 px-4 text-right text-slate-300">{item.allocationPct.toFixed(2)}%</td>
                    <td className={`py-3 px-4 text-right font-semibold ${item.change24hPct !== undefined && item.change24hPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{item.change24hPct !== undefined ? `${item.change24hPct >= 0 ? "+" : ""}${item.change24hPct.toFixed(2)}%` : "—"}</td>
                    <td className="py-3 px-4 text-center font-sans"><div className="flex justify-center gap-2"><button onClick={() => setTradeAsset(item.asset)} className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-[11px] font-semibold border border-emerald-700/50">Trade</button><a href={`https://www.binance.com/en/trade/${item.asset}_USDT`} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 inline-flex items-center gap-1">Binance <ExternalLink className="w-3 h-3" /></a></div></td>
                  </tr>              ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. BINANCE TRANSACTION HISTORY */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Transaction History</h2><p className="text-[11px] text-slate-500 mt-1">Deposits, withdrawals, trades and fees from Binance. Trades include Binance order IDs.</p></div><span className="text-[11px] text-slate-500 font-mono">Last 30 days</span></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs text-slate-300"><thead className="bg-slate-950/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800"><tr><th className="py-3 px-4">Type</th><th className="py-3 px-4">Asset</th><th className="py-3 px-4 text-right">Amount</th><th className="py-3 px-4 text-right">Value (USD)</th><th className="py-3 px-4">Status</th><th className="py-3 px-4">Timestamp</th><th className="py-3 px-4">Binance Order ID / TxID</th></tr></thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">{!account?.transactions?.length ? <tr><td colSpan={7} className="py-10 text-center text-slate-500 font-sans">No Binance transactions returned for the selected period.</td></tr> : account.transactions.map(tx => <tr key={tx.id} className="hover:bg-slate-800/40"><td className="py-2.5 px-4"><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">{tx.type}</span></td><td className="py-2.5 px-4 font-bold text-slate-200">{tx.asset}</td><td className="py-2.5 px-4 text-right">{tx.amount.toLocaleString("en-US",{maximumFractionDigits:8})}</td><td className="py-2.5 px-4 text-right text-emerald-400">${tx.valueUsd.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td className="py-2.5 px-4 text-slate-400">{tx.status}</td><td className="py-2.5 px-4 text-slate-500">{new Date(tx.timestamp).toLocaleString()}</td><td className="py-2.5 px-4 text-slate-500 text-[11px]">{tx.orderId || tx.txId || "—"}</td></tr>)}</tbody>
        </table></div>
      </div>
      {tradeAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4"><h3 className="text-base font-bold text-slate-100">Trade {tradeAsset}</h3><button onClick={() => setTradeAsset(null)} className="text-slate-400 hover:text-white">✕</button></div>
            <p className="text-xs text-slate-400 mb-5">Execution remains protected by owner authentication, the global kill switch, trading mode and the risk engine.</p>
            <div className="flex justify-end gap-2"><button onClick={() => setTradeAsset(null)} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold">Close</button>{onNavigateToTrade && <button onClick={() => { setTradeAsset(null); onNavigateToTrade(); }} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">Open Trade Terminal</button>}</div>
          </div>
        </div>
      )}

      {/* 6. MODAL: UPDATE BINANCE API CREDENTIALS */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-slate-100">Binance API Configuration</h3>
              </div>
              <button
                onClick={() => setShowKeyModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter your personal Binance Spot API credentials. Keys are saved securely server-side for personal algorithmic execution.
            </p>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs space-y-1">
              <span className="text-slate-400">Server Whitelist IP:</span>
              <div className="flex items-center justify-between">
                <code className="text-amber-300 font-mono font-bold">{account?.serverIp || '3.222.149.9'}</code>
                <button
                  onClick={() => handleCopyIp(account?.serverIp || '3.222.149.9')}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                >
                  {copiedIp ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedIp ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveKeys} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Binance API Key</label>
                <input
                  type="text"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="Paste your Binance API Key..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Binance API Secret</label>
                <input
                  type="password"
                  value={newApiSecret}
                  onChange={(e) => setNewApiSecret(e.target.value)}
                  placeholder="Paste your Binance API Secret..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              {keyUpdateFeedback && (
                <div className={`p-2.5 rounded text-xs font-medium ${
                  keyUpdateFeedback.startsWith('Success') ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                }`}>
                  {keyUpdateFeedback}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowKeyModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingKeys}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold transition shadow-md"
                >
                  {updatingKeys ? 'Validating...' : 'Save & Verify'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
