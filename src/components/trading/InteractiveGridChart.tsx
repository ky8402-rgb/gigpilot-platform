import React, { useState, useMemo } from 'react';
import {
  Candle,
  GridConfiguration,
  OrderBook,
  TechnicalIndicators
} from '../../types/trading';
import {
  TrendingUp,
  Activity,
  Layers,
  Crosshair,
  BarChart2,
  Maximize2
} from 'lucide-react';

interface InteractiveGridChartProps {
  symbol: string;
  candles: Candle[];
  orderBook: OrderBook;
  grid: GridConfiguration | null;
  indicators: TechnicalIndicators | null;
  currentPrice: number;
}

const formatChartPrice = (val: number | undefined | null) => {
  if (val == null || isNaN(val)) return '—';
  if (val === 0) return '0.00';
  if (Math.abs(val) < 0.0001) return val.toFixed(6);
  if (Math.abs(val) < 0.01) return val.toFixed(5);
  if (Math.abs(val) < 1) return val.toFixed(4);
  if (Math.abs(val) < 10) return val.toFixed(3);
  if (Math.abs(val) < 1000) return val.toFixed(2);
  return val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
};

export const InteractiveGridChart: React.FC<InteractiveGridChartProps> = ({
  symbol,
  candles,
  orderBook,
  grid,
  indicators,
  currentPrice
}) => {
  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);
  const [showIndicators, setShowIndicators] = useState(true);
  const [showDepth, setShowDepth] = useState(true);

  // Compute price domain for SVG chart
  const { minPrice, maxPrice, recentCandles } = useMemo(() => {
    const slice = candles.slice(-45);
    const p = currentPrice > 0 ? currentPrice : 100;
    if (slice.length === 0) {
      return { minPrice: p * 0.95, maxPrice: p * 1.05, recentCandles: [] };
    }

    let low = Math.min(...slice.map(c => c.low));
    let high = Math.max(...slice.map(c => c.high));

    if (grid) {
      low = Math.min(low, grid.lowerBoundary * 0.995);
      high = Math.max(high, grid.upperBoundary * 1.005);
    }
    low = Math.min(low, p * 0.995);
    high = Math.max(high, p * 1.005);

    const padding = (high - low) * 0.05 || (p * 0.02);
    return {
      minPrice: low - padding,
      maxPrice: high + padding,
      recentCandles: slice
    };
  }, [candles, grid, currentPrice]);

  const svgWidth = 840;
  const svgHeight = 420;
  const priceRange = maxPrice - minPrice || 1;

  const getY = (price: number) => {
    return svgHeight - ((price - minPrice) / priceRange) * svgHeight;
  };

  const candleWidth = Math.max(6, (svgWidth - 60) / Math.max(1, recentCandles.length) - 5);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col h-full shadow-xl">
      {/* Chart Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            <span className="font-extrabold text-sm text-white font-mono">{symbol}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">1m SPOT</span>
          </div>
          <div className="text-xs font-mono text-slate-400 hidden sm:flex items-center gap-3">
            <span>O: <strong className="text-white">${candles[candles.length - 1]?.open != null ? formatChartPrice(candles[candles.length - 1].open) : '—'}</strong></span>
            <span>H: <strong className="text-white">${candles[candles.length - 1]?.high != null ? formatChartPrice(candles[candles.length - 1].high) : '—'}</strong></span>
            <span>L: <strong className="text-white">${candles[candles.length - 1]?.low != null ? formatChartPrice(candles[candles.length - 1].low) : '—'}</strong></span>
            <span>C: <strong className="text-white">${candles[candles.length - 1]?.close != null ? formatChartPrice(candles[candles.length - 1].close) : '—'}</strong></span>
          </div>
        </div>

        {/* Action Toggles */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <button
            onClick={() => setShowIndicators(!showIndicators)}
            className={`px-2.5 py-1 rounded border transition-colors ${
              showIndicators
                ? 'bg-cyan-950/60 border-cyan-700 text-cyan-300'
                : 'bg-slate-800/60 border-slate-700 text-slate-400'
            }`}
          >
            EMA / BB Overlay
          </button>
          <button
            onClick={() => setShowDepth(!showDepth)}
            className={`px-2.5 py-1 rounded border transition-colors ${
              showDepth
                ? 'bg-purple-950/60 border-purple-700 text-purple-300'
                : 'bg-slate-800/60 border-slate-700 text-slate-400'
            }`}
          >
            Orderbook Spread
          </button>
        </div>
      </div>

      {/* Main Chart Canvas & Grid Matrix */}
      <div className="relative w-full flex-1 min-h-[360px] overflow-hidden rounded-lg bg-slate-950 border border-slate-800/60">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-full select-none"
          preserveAspectRatio="none"
        >
          {/* Horizontal Price Grid Lines */}
          {[0.15, 0.35, 0.55, 0.75, 0.95].map((pct, idx) => {
            const y = svgHeight * pct;
            const priceVal = maxPrice - (pct * priceRange);
            return (
              <g key={idx} className="opacity-25">
                <line x1="0" y1={y} x2={svgWidth - 65} y2={y} stroke="#334155" strokeDasharray="3 3" />
                <text x={svgWidth - 60} y={y + 3} fill="#94a3b8" fontSize="10" fontFamily="monospace">
                  ${formatChartPrice(priceVal)}
                </text>
              </g>
            );
          })}

          {/* ACTIVE GRID OVERLAY */}
          {grid && (
            <g className="grid-overlay">
              {/* Upper Boundary */}
              <line
                x1="0"
                y1={getY(grid.upperBoundary)}
                x2={svgWidth - 65}
                y2={getY(grid.upperBoundary)}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="opacity-90"
              />
              <rect
                x={svgWidth - 65}
                y={getY(grid.upperBoundary) - 9}
                width="62"
                height="18"
                fill="#f59e0b"
                rx="3"
              />
              <text
                x={svgWidth - 62}
                y={getY(grid.upperBoundary) + 4}
                fill="#000"
                fontSize="9"
                fontWeight="bold"
                fontFamily="monospace"
              >
                UPPER ${formatChartPrice(grid.upperBoundary)}
              </text>

              {/* Lower Boundary */}
              <line
                x1="0"
                y1={getY(grid.lowerBoundary)}
                x2={svgWidth - 65}
                y2={getY(grid.lowerBoundary)}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="opacity-90"
              />
              <rect
                x={svgWidth - 65}
                y={getY(grid.lowerBoundary) - 9}
                width="62"
                height="18"
                fill="#f59e0b"
                rx="3"
              />
              <text
                x={svgWidth - 62}
                y={getY(grid.lowerBoundary) + 4}
                fill="#000"
                fontSize="9"
                fontWeight="bold"
                fontFamily="monospace"
              >
                LOWER ${formatChartPrice(grid.lowerBoundary)}
              </text>

              {/* Grid Rungs */}
              {grid.activeLevels.map(lvl => {
                const y = getY(lvl.price);
                const isBuy = lvl.side === 'BUY';
                return (
                  <g key={lvl.id} className="opacity-75">
                    <line
                      x1="0"
                      y1={y}
                      x2={svgWidth - 65}
                      y2={y}
                      stroke={isBuy ? '#10b981' : '#f43f5e'}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <circle
                      cx={15 + (lvl.index * 12) % (svgWidth - 100)}
                      cy={y}
                      r="2.5"
                      fill={isBuy ? '#10b981' : '#f43f5e'}
                    />
                  </g>
                );
              })}
            </g>
          )}

          {/* CANDLESTICKS */}
          {recentCandles.map((c, i) => {
            const x = 20 + i * (candleWidth + 5);
            const isBull = c.close >= c.open;
            const bodyTop = getY(Math.max(c.open, c.close));
            const bodyHeight = Math.max(2, Math.abs(getY(c.open) - getY(c.close)));
            const wickTop = getY(c.high);
            const wickBottom = getY(c.low);
            const color = isBull ? '#10b981' : '#f43f5e';

            return (
              <g
                key={c.timestamp}
                className="cursor-pointer hover:opacity-100 transition-opacity"
                onMouseEnter={() => setHoverCandle(c)}
                onMouseLeave={() => setHoverCandle(null)}
              >
                {/* Wick */}
                <line
                  x1={x + candleWidth / 2}
                  y1={wickTop}
                  x2={x + candleWidth / 2}
                  y2={wickBottom}
                  stroke={color}
                  strokeWidth="1"
                />
                {/* Body */}
                <rect
                  x={x}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={isBull ? '#10b981' : '#f43f5e'}
                  rx="1"
                />
              </g>
            );
          })}

          {/* CURRENT PRICE MARKER */}
          {currentPrice && (
            <g>
              <line
                x1="0"
                y1={getY(currentPrice)}
                x2={svgWidth - 65}
                y2={getY(currentPrice)}
                stroke="#06b6d4"
                strokeWidth="1.8"
              />
              <circle
                cx={svgWidth - 75}
                cy={getY(currentPrice)}
                r="4"
                fill="#06b6d4"
                className="animate-ping"
              />
              <rect
                x={svgWidth - 65}
                y={getY(currentPrice) - 10}
                width="62"
                height="20"
                fill="#06b6d4"
                rx="3"
              />
              <text
                x={svgWidth - 62}
                y={getY(currentPrice) + 4}
                fill="#082f49"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                ${formatChartPrice(currentPrice)}
              </text>
            </g>
          )}
        </svg>

        {/* Overlay Badges (Top Left & Bottom) */}
        {grid && (
          <div className="absolute top-2 left-2 bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 rounded text-[11px] font-mono text-slate-300 backdrop-blur-sm shadow flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>GRID: <strong>{grid.levelsCount} Levels</strong> ({grid.spacingType})</span>
            <span className="text-slate-500">|</span>
            <span>Allocated: <strong>${(grid.totalAllocatedUsd ?? 0).toLocaleString()}</strong></span>
            <span className="text-slate-500">|</span>
            <span className="text-amber-400">Step: {typeof grid.gridSpacingPct === 'number' ? grid.gridSpacingPct.toFixed(2) : '0.50'}%</span>
          </div>
        )}

        {/* Order Book Depth & Spread Meter */}
        {showDepth && orderBook && (
          <div className="absolute bottom-2 left-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded text-[11px] font-mono text-slate-300 backdrop-blur-sm shadow flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">SPREAD:</span>
              <span className="text-purple-300 font-bold">${formatChartPrice(orderBook.spread)}</span>
              <span className="text-[10px] text-purple-400">({orderBook.spreadBps ?? 0} bps)</span>
            </div>
            <span className="text-slate-700">|</span>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-semibold">BID: ${orderBook.bids?.[0]?.price != null ? formatChartPrice(orderBook.bids[0].price) : '—'}</span>
              <span className="text-rose-400 font-semibold">ASK: ${orderBook.asks?.[0]?.price != null ? formatChartPrice(orderBook.asks[0].price) : '—'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Technical Indicators Mini Footer */}
      {indicators && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-xs font-mono">
          <div className="bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded">
            <span className="text-slate-500 block text-[10px]">RSI (14)</span>
            <span className={`font-bold ${
              (indicators.rsi14 ?? 50) > 70 ? 'text-rose-400' : (indicators.rsi14 ?? 50) < 30 ? 'text-emerald-400' : 'text-slate-200'
            }`}>
              {typeof indicators.rsi14 === 'number' ? indicators.rsi14.toFixed(1) : '50.0'} {(indicators.rsi14 ?? 50) > 70 ? '(Overbought)' : (indicators.rsi14 ?? 50) < 30 ? '(Oversold)' : ''}
            </span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded">
            <span className="text-slate-500 block text-[10px]">ATR (14)</span>
            <span className="font-bold text-white">${typeof indicators.atr14 === 'number' ? indicators.atr14.toFixed(2) : '0.00'}</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded">
            <span className="text-slate-500 block text-[10px]">EMA 21 / 50</span>
            <span className="font-bold text-cyan-300">${typeof indicators.ema21 === 'number' ? indicators.ema21.toFixed(0) : '0'} / ${typeof indicators.ema50 === 'number' ? indicators.ema50.toFixed(0) : '0'}</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded">
            <span className="text-slate-500 block text-[10px]">BB BANDWIDTH</span>
            <span className="font-bold text-amber-300">{typeof indicators.bollingerBands?.bandwidth === 'number' ? indicators.bollingerBands.bandwidth.toFixed(2) : '0.00'}%</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded">
            <span className="text-slate-500 block text-[10px]">VWAP</span>
            <span className="font-bold text-white">${typeof indicators.vwap === 'number' ? indicators.vwap.toFixed(1) : '0.0'}</span>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded">
            <span className="text-slate-500 block text-[10px]">24H VOLATILITY</span>
            <span className="font-bold text-emerald-400">{typeof indicators.volatility24h === 'number' ? indicators.volatility24h.toFixed(2) : '0.00'}%</span>
          </div>
        </div>
      )}
    </div>
  );
};
