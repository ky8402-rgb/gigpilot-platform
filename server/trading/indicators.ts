import { Candle, OrderBook, TechnicalIndicators } from './types.js';

export function calculateSMA(data: number[], period: number): number {
  if (data.length < period || period <= 0) return data[data.length - 1] || 0;
  const slice = data.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return sum / period;
}

export function calculateEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) return calculateSMA(data, data.length);
  
  const multiplier = 2 / (period + 1);
  let ema = calculateSMA(data.slice(0, period), period);
  
  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }
  return ema;
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      const absLoss = Math.abs(diff);
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + absLoss) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;
  
  // Approximate signal line
  const macdSeries: number[] = [];
  for (let i = Math.max(0, closes.length - 18); i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    if (slice.length >= 26) {
      macdSeries.push(calculateEMA(slice, 12) - calculateEMA(slice, 26));
    }
  }
  
  const signal = macdSeries.length >= 9 ? calculateEMA(macdSeries, 9) : macd * 0.9;
  return {
    macd: Number(macd.toFixed(2)),
    signal: Number(signal.toFixed(2)),
    histogram: Number((macd - signal).toFixed(2))
  };
}

export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 100;
  
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
    trueRanges.push(tr);
  }
  
  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / (trueRanges.length || 1);
  }
  
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return Number(atr.toFixed(2));
}

export function calculateBollingerBands(closes: number[], period = 20, stdDev = 2): {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
} {
  const middle = calculateSMA(closes, Math.min(period, closes.length));
  const slice = closes.slice(-Math.min(period, closes.length));
  
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / (slice.length || 1);
  const standardDeviation = Math.sqrt(variance);
  
  const upper = middle + standardDeviation * stdDev;
  const lower = middle - standardDeviation * stdDev;
  const bandwidth = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
  
  return {
    upper: Number(upper.toFixed(2)),
    middle: Number(middle.toFixed(2)),
    lower: Number(lower.toFixed(2)),
    bandwidth: Number(bandwidth.toFixed(3))
  };
}

export function calculateVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  let cumulativeTypicalPriceVolume = 0;
  let cumulativeVolume = 0;
  
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeTypicalPriceVolume += typicalPrice * c.volume;
    cumulativeVolume += c.volume;
  }
  
  return cumulativeVolume > 0 ? Number((cumulativeTypicalPriceVolume / cumulativeVolume).toFixed(2)) : candles[candles.length - 1].close;
}

export function calculateOrderBookImbalance(orderBook: OrderBook): number {
  const bidVolume = orderBook.bids.slice(0, 10).reduce((sum, level) => sum + level.amount, 0);
  const askVolume = orderBook.asks.slice(0, 10).reduce((sum, level) => sum + level.amount, 0);
  const totalVolume = bidVolume + askVolume;
  
  if (totalVolume === 0) return 0;
  // Imbalance score from -1 (total sell pressure) to +1 (total buy pressure)
  return Number(((bidVolume - askVolume) / totalVolume).toFixed(3));
}

export function computeAllIndicators(candles: Candle[], orderBook?: OrderBook): TechnicalIndicators {
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1] || 0;
  
  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, Math.min(200, closes.length));
  const bollingerBands = calculateBollingerBands(closes, 20, 2);
  const atr14 = calculateATR(candles, 14);
  const vwap = calculateVWAP(candles);
  
  const spreadBps = orderBook?.spreadBps ?? 0;
  const recentSlice = candles.slice(-24);
  const high24h = recentSlice.length > 0 ? Math.max(...recentSlice.map(c => c.high || currentPrice)) : currentPrice;
  const low24h = recentSlice.length > 0 ? Math.min(...recentSlice.map(c => c.low || currentPrice)) : currentPrice;
  const rawVol = currentPrice > 0 ? (((high24h - low24h) / currentPrice) * 100) : 0;
  const volatility24h = Number.isFinite(rawVol) ? Number(rawVol.toFixed(2)) : 0;

  return {
    rsi14: Number.isFinite(rsi14) ? Number(rsi14.toFixed(2)) : 0,
    macd: {
      macd: Number.isFinite(macd?.macd) ? macd.macd : 0,
      signal: Number.isFinite(macd?.signal) ? macd.signal : 0,
      histogram: Number.isFinite(macd?.histogram) ? macd.histogram : 0,
    },
    ema9: Number.isFinite(ema9) ? Number(ema9.toFixed(2)) : 0,
    ema21: Number.isFinite(ema21) ? Number(ema21.toFixed(2)) : 0,
    ema50: Number.isFinite(ema50) ? Number(ema50.toFixed(2)) : 0,
    ema200: Number.isFinite(ema200) ? Number(ema200.toFixed(2)) : 0,
    bollingerBands: {
      upper: Number.isFinite(bollingerBands?.upper) ? bollingerBands.upper : 0,
      middle: Number.isFinite(bollingerBands?.middle) ? bollingerBands.middle : 0,
      lower: Number.isFinite(bollingerBands?.lower) ? bollingerBands.lower : 0,
      bandwidth: Number.isFinite(bollingerBands?.bandwidth) ? bollingerBands.bandwidth : 0,
    },
    atr14: Number.isFinite(atr14) ? atr14 : 0,
    vwap: Number.isFinite(vwap) ? vwap : 0,
    spreadBps: Number.isFinite(spreadBps) ? spreadBps : 0,
    volatility24h: Number.isFinite(volatility24h) ? volatility24h : 0
  };
}
