import React, { useState } from 'react';
import {
  Fill,
  GridConfiguration,
  Order,
  Position
} from '../../types/trading';
import {
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  XCircle,
  PlusCircle,
  History,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface GridMatrixAndOrdersProps {
  grid: GridConfiguration | null;
  currentPrice: number;
  openOrders: Order[];
  recentFills: Fill[];
  position?: Position;
  onCancelOrder: (orderId: string) => void;
  onCancelAllOrders: () => void;
  onPlaceManualOrder: (order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    price: number;
    amount: number;
  }) => Promise<{ success: boolean; error?: string }>;
}

const formatOrderPrice = (val: number | undefined | null) => {
  if (val == null || isNaN(val)) return '—';
  if (val === 0) return '0.00';
  if (Math.abs(val) < 0.0001) return val.toFixed(6);
  if (Math.abs(val) < 0.01) return val.toFixed(5);
  if (Math.abs(val) < 1) return val.toFixed(4);
  if (Math.abs(val) < 10) return val.toFixed(3);
  if (Math.abs(val) < 1000) return val.toFixed(2);
  return val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
};

export const GridMatrixAndOrders: React.FC<GridMatrixAndOrdersProps> = ({
  grid,
  currentPrice,
  openOrders,
  recentFills,
  position,
  onCancelOrder,
  onCancelAllOrders,
  onPlaceManualOrder
}) => {
  const [activeTab, setActiveTab] = useState<'GRID' | 'ORDERS' | 'FILLS' | 'MANUAL'>('GRID');

  // Manual Order Form State
  const [manualSide, setManualSide] = useState<'BUY' | 'SELL'>('BUY');
  const [manualType, setManualType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [manualPrice, setManualPrice] = useState(currentPrice > 0 ? currentPrice.toString() : '85859.20');
  const [manualAmount, setManualAmount] = useState('0.05');
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (currentPrice > 0) {
      setManualPrice(currentPrice.toString());
    }
  }, [currentPrice]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError(null);
    setOrderSuccess(null);
    setIsSubmitting(true);

    try {
      const res = await onPlaceManualOrder({
        symbol: grid?.symbol || 'BTC/USDT',
        side: manualSide,
        type: manualType,
        price: Number(manualPrice),
        amount: Number(manualAmount)
      });

      if (!res.success) {
        setOrderError(res.error || 'Failed to place order');
      } else {
        setOrderSuccess(`Order placed successfully (${manualSide} ${manualAmount} @ $${manualPrice})`);
      }
    } catch (err: any) {
      setOrderError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col h-full shadow-xl">
      {/* Tab Navigation */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
        <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('GRID')}
            className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
              activeTab === 'GRID'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Grid Matrix ({grid?.activeLevels.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('ORDERS')}
            className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
              activeTab === 'ORDERS'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Open Orders ({openOrders.length})
          </button>
          <button
            onClick={() => setActiveTab('FILLS')}
            className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
              activeTab === 'FILLS'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Execution Fills ({recentFills.length})
          </button>
          <button
            onClick={() => {
              setManualPrice(currentPrice.toString());
              setActiveTab('MANUAL');
            }}
            className={`px-3 py-1 text-xs font-mono font-bold rounded transition-colors ${
              activeTab === 'MANUAL'
                ? 'bg-cyan-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Manual Ticket
          </button>
        </div>

        {activeTab === 'ORDERS' && openOrders.length > 0 && (
          <button
            onClick={onCancelAllOrders}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/80 text-rose-300 text-xs font-mono font-semibold transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>Cancel All</span>
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto max-h-[380px] custom-scrollbar">
        {/* 1. GRID MATRIX VIEW */}
        {activeTab === 'GRID' && (
          <div>
            {grid?.inventoryAwareness && (
              <div className="p-2 mb-2 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between text-[11px] font-mono gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-300">Inventory Skew:</span>
                  <span className={`px-1.5 py-0.2 rounded font-bold ${
                    grid.inventoryAwareness.inventorySkew >= 0.25 ? 'bg-amber-950 text-amber-300 border border-amber-600/60' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {grid.inventoryAwareness.inventorySkew >= 0 ? `+${grid.inventoryAwareness.inventorySkew}` : grid.inventoryAwareness.inventorySkew} ({grid.inventoryAwareness.inventoryPosturing.replace('_', ' ')})
                  </span>
                </div>
                <div className="flex items-center gap-3 text-slate-400">
                  <span>BUY Budget: <strong className="text-emerald-400">{Math.round(grid.inventoryAwareness.asymmetricBudgeting.buyAllocationPct * 100)}%</strong></span>
                  <span>SELL Budget: <strong className="text-rose-400">{Math.round(grid.inventoryAwareness.asymmetricBudgeting.sellAllocationPct * 100)}%</strong></span>
                  <span>Liq Buffer: <strong className="text-cyan-400">{grid.inventoryAwareness.distanceFromLiquidationPct}%</strong></span>
                </div>
              </div>
            )}
            {!grid || grid.activeLevels.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                No active grid configuration found. Set up boundaries in the Adaptive Grid tab.
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead className="sticky top-0 bg-slate-900 text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-2">Level</th>
                    <th className="py-2 px-2">Side</th>
                    <th className="py-2 px-2">Grid Price</th>
                    <th className="py-2 px-2">Distance</th>
                    <th className="py-2 px-2">Size</th>
                    <th className="py-2 px-2">Mult</th>
                    <th className="py-2 px-2">Req Edge</th>
                    <th className="py-2 px-2">USD Value</th>
                    <th className="py-2 px-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {grid.activeLevels.map(lvl => {
                    const isBuy = lvl.side === 'BUY';
                    const distPct = ((lvl.price - currentPrice) / currentPrice) * 100;

                    return (
                      <tr key={lvl.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2 px-2 text-slate-400">#{lvl.index + 1}</td>
                        <td className="py-2 px-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isBuy ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80' : 'bg-rose-950/80 text-rose-300 border border-rose-800/80'
                          }`}>
                            {lvl.side}
                          </span>
                        </td>
                        <td className="py-2 px-2 font-bold text-white">${formatOrderPrice(lvl.price)}</td>
                        <td className={`py-2 px-2 ${distPct >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {distPct >= 0 ? '+' : ''}{distPct.toFixed(2)}%
                        </td>
                        <td className="py-2 px-2 text-slate-300">{lvl.orderSize}</td>
                        <td className="py-2 px-2 text-slate-400">{lvl.orderSizeMultiplier ? `${lvl.orderSizeMultiplier}x` : '1.0x'}</td>
                        <td className="py-2 px-2 font-bold text-yellow-400">{lvl.requiredEdgeHurdleBps ? `${lvl.requiredEdgeHurdleBps} bps` : '4.0 bps'}</td>
                        <td className="py-2 px-2 text-slate-300">${lvl.valueUsd.toFixed(1)}</td>
                        <td className="py-2 px-2">
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            PLACED
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 2. OPEN ORDERS */}
        {activeTab === 'ORDERS' && (
          <div>
            {openOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                No active open orders on the order book.
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead className="sticky top-0 bg-slate-900 text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-2">Order ID</th>
                    <th className="py-2 px-2">Side</th>
                    <th className="py-2 px-2">Price</th>
                    <th className="py-2 px-2">Amount</th>
                    <th className="py-2 px-2">Cost (USD)</th>
                    <th className="py-2 px-2">Strategy</th>
                    <th className="py-2 px-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {openOrders.map((ord, oIdx) => (
                    <tr key={ord.id || `ord-${oIdx}`} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 px-2 text-slate-400">
                        {typeof ord.id === 'string' && ord.id.length > 0 ? `${ord.id.substring(0, 10)}...` : 'ORDER'}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          ord.side === 'BUY' ? 'bg-emerald-950/80 text-emerald-300' : 'bg-rose-950/80 text-rose-300'
                        }`}>
                          {ord.side}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-bold text-white">${formatOrderPrice(ord.price)}</td>
                      <td className="py-2 px-2 text-slate-300">{ord.amount}</td>
                      <td className="py-2 px-2 text-slate-300">${ord.costUsd.toFixed(2)}</td>
                      <td className="py-2 px-2 text-[10px] text-slate-400">{ord.strategyId}</td>
                      <td className="py-2 px-2 text-right">
                        <button
                          onClick={() => onCancelOrder(ord.id)}
                          className="text-rose-400 hover:text-rose-300 text-[11px] font-bold underline"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 3. EXECUTION FILLS */}
        {activeTab === 'FILLS' && (
          <div>
            {recentFills.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                No fills recorded yet. Grid match events will stream here automatically.
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono">
                <thead className="sticky top-0 bg-slate-900 text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-2">Fill ID</th>
                    <th className="py-2 px-2">Side</th>
                    <th className="py-2 px-2">Price</th>
                    <th className="py-2 px-2">Amount</th>
                    <th className="py-2 px-2">Fee Paid</th>
                    <th className="py-2 px-2">Slippage</th>
                    <th className="py-2 px-2">Realized PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {recentFills.map((f, fIdx) => (
                    <tr key={f.id || `fill-${fIdx}`} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 px-2 text-slate-400">
                        {typeof f.id === 'string' && f.id.length > 0 ? `${f.id.substring(0, 10)}...` : 'FILL'}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          f.side === 'BUY' ? 'bg-emerald-950/80 text-emerald-300' : 'bg-rose-950/80 text-rose-300'
                        }`}>
                          {f.side}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-bold text-white">${formatOrderPrice(f.price)}</td>
                      <td className="py-2 px-2 text-slate-300">{f.amount}</td>
                      <td className="py-2 px-2 text-slate-400">-${f.feeUsd.toFixed(4)}</td>
                      <td className="py-2 px-2 text-slate-400">{f.slippageBps} bps</td>
                      <td className={`py-2 px-2 font-bold ${
                        f.realizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {f.realizedPnL !== 0 ? `${f.realizedPnL >= 0 ? '+' : ''}$${f.realizedPnL.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 4. MANUAL ORDER TICKET (RISK VALIDATED) */}
        {activeTab === 'MANUAL' && (
          <form onSubmit={handleManualSubmit} className="p-2 space-y-3 font-mono text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                <span>Manual Execution Ticket</span>
                <span className="text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded">
                  BYBIT SPOT (PERSONAL)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-slate-400 block mb-1">Side</label>
                  <div className="flex rounded bg-slate-900 p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setManualSide('BUY')}
                      className={`flex-1 py-1 rounded font-bold transition-colors ${
                        manualSide === 'BUY' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      BUY
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualSide('SELL')}
                      className={`flex-1 py-1 rounded font-bold transition-colors ${
                        manualSide === 'SELL' ? 'bg-rose-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      SELL
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Type</label>
                  <div className="flex rounded bg-slate-900 p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setManualType('LIMIT')}
                      className={`flex-1 py-1 rounded font-bold transition-colors ${
                        manualType === 'LIMIT' ? 'bg-cyan-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      LIMIT
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualType('MARKET')}
                      className={`flex-1 py-1 rounded font-bold transition-colors ${
                        manualType === 'MARKET' ? 'bg-cyan-600 text-white' : 'text-slate-400'
                      }`}
                    >
                      MARKET
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-slate-400 block mb-1">Price (USD)</label>
                  <input
                    type="number"
                    step="0.1"
                    disabled={manualType === 'MARKET'}
                    value={manualPrice}
                    onChange={e => setManualPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-bold disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.001"
                    value={manualAmount}
                    onChange={e => setManualAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-bold"
                  />
                </div>
              </div>

              <div className="text-[11px] text-slate-400 mb-2 flex justify-between">
                <span>Estimated Value:</span>
                <span className="text-white font-bold">
                  ${(Number(manualPrice) * Number(manualAmount)).toFixed(2)} USD
                </span>
              </div>

              {Number(manualPrice) * Number(manualAmount) > 0 && Number(manualPrice) * Number(manualAmount) < 1.0 && (
                <div className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-800/50 p-1.5 rounded mb-3">
                  ⚠️ Minimum notional for Bybit Spot is $1.00 USD. Increase amount or price.
                </div>
              )}

              {orderError && (
                <div className="p-2 rounded bg-rose-950/60 border border-rose-800/80 text-rose-300 text-[11px] mb-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{orderError}</span>
                </div>
              )}

              {orderSuccess && (
                <div className="p-2 rounded bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-[11px] mb-3 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{orderSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full py-2 rounded font-bold uppercase tracking-wider text-white shadow transition-all ${
                  manualSide === 'BUY'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                    : 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                }`}
              >
                {isSubmitting ? 'Validating & Routing...' : `Place ${manualSide} Order`}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Position Status Strip Footer */}
      {position && (
        <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">Inventory:</span>
            <span className="text-white font-bold">{position.baseAmount >= 1000 ? position.baseAmount.toLocaleString() : position.baseAmount.toFixed(4)} {position.symbol.split('/')[0]}</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">Entry:</span>
            <span className="text-white">${formatOrderPrice(position.entryPrice)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Unrealized PnL:</span>
            <span className={`font-bold ${position.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {position.unrealizedPnL >= 0 ? '+' : ''}${position.unrealizedPnL.toFixed(2)} ({position.unrealizedPnLPct}%)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
