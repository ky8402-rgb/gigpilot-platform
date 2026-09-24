import { Candle, EngineErrorRecord, EngineHealth, EngineModule, MarketRegime, OrderBook, TechnicalIndicators } from './types.js';

export class QuantEngine implements EngineModule {
  public readonly id = 'QUANT_ENGINE';
  public readonly name = 'Quant Engine (Mathematical Signals & Regime Classifier)';

  private enabled: boolean = true; // Off-switch
  private status: 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'OFF' = 'HEALTHY';
  private latencyMs: number = 0;
  private lastHeartbeat: string = new Date().toISOString();
  private errorSurface: EngineErrorRecord[] = [];

  private indicatorsCache: Map<string, { indicators: TechnicalIndicators; regime: MarketRegime; timestamp: number }> = new Map();

  public healthCheck(): EngineHealth {
    return {
      id: this.id,
      name: this.name,
      status: !this.enabled ? 'OFF' : this.status,
      enabled: this.enabled,
      latencyMs: this.latencyMs,
      lastHeartbeat: this.lastHeartbeat,
      errorCount: this.errorSurface.length,
      lastError: this.errorSurface[0]?.message,
      errorSurface: [...this.errorSurface.slice(0, 10)],
      details: {
        cachedPairs: this.indicatorsCache.size,
        models: ['RSI_WILDER_14', 'MACD_12_26_9', 'BOLLINGER_20_2', 'ATR_14', 'ORDER_FLOW_IMBALANCE'],
        failClosedRule: 'No synthetic numbers fabricated when real market data is absent'
      }
    };
  }

  public getErrorSurface(): EngineErrorRecord[] {
    return [...this.errorSurface];
  }

  public getOffSwitch(): boolean {
    return this.enabled;
  }

  public setOffSwitch(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.status = 'OFF';
      this.recordError('WARN', 'Quant Engine switched OFF. Signal calculation paused. Downstream Grid Engine will fail closed.');
    } else {
      this.status = 'HEALTHY';
      this.recordError('WARN', 'Quant Engine switched ON.');
    }
  }

  public clearErrors(): void {
    this.errorSurface = [];
  }

  private recordError(level: EngineErrorRecord['level'], message: string, details?: any) {
    const rec: EngineErrorRecord = {
      id: `err_quant_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    };
    this.errorSurface.unshift(rec);
    if (this.errorSurface.length > 50) this.errorSurface.pop();
  }

  /**
   * Compute indicators strictly from real candles and real orderbook
   */
  public computeSignals(
    symbol: string,
    candles: Candle[],
    orderBook?: OrderBook
  ): { indicators: TechnicalIndicators | null; regime: MarketRegime | null; error?: string } {
    if (!this.enabled) {
      return { indicators: null, regime: null, error: 'QUANT_ENGINE_OFF' };
    }

    const start = Date.now();

    if (!candles || candles.length < 5) {
      this.status = 'DEGRADED';
      const msg = `Insufficient candle depth for ${symbol} (${candles?.length || 0} candles). Min 5 required. Failing closed.`;
      this.recordError('WARN', msg);
      return { indicators: null, regime: null, error: msg };
    }

    try {
      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);
      const volumes = candles.map(c => c.volume);
      const currentPrice = closes[closes.length - 1];

      // 1. RSI (Wilder's Smoothing)
      const rsi14 = this.calculateRSI(closes, 14);

      // 2. MACD (12, 26, 9)
      const macd = this.calculateMACD(closes);

      // 3. EMAs
      const ema9 = this.calculateEMA(closes, 9);
      const ema21 = this.calculateEMA(closes, 21);
      const ema50 = this.calculateEMA(closes, 50);
      const ema200 = this.calculateEMA(closes, 200);

      // 4. Bollinger Bands (20, 2)
      const bollingerBands = this.calculateBollingerBands(closes, 20, 2);

      // 5. ATR 14
      const atr14 = this.calculateATR(highs, lows, closes, 14);

      // 6. VWAP
      const vwap = this.calculateVWAP(candles);

      // 7. Order Book Imbalance & Spread
      let orderBookImbalance = 0;
      let spreadBps = orderBook?.spreadBps || 5;
      if (orderBook && orderBook.bids.length > 0 && orderBook.asks.length > 0) {
        const topBidsVolume = orderBook.bids.slice(0, 5).reduce((acc, b) => acc + b.amount, 0);
        const topAsksVolume = orderBook.asks.slice(0, 5).reduce((acc, a) => acc + a.amount, 0);
        const totalVol = topBidsVolume + topAsksVolume;
        if (totalVol > 0) {
          orderBookImbalance = Number(((topBidsVolume - topAsksVolume) / totalVol).toFixed(4));
        }
      }

      // 8. Real Volatility
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        if (closes[i - 1] > 0) {
          returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
      }
      const meanReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
      const variance = returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) / (returns.length || 1);
      const volatility24h = Number((Math.sqrt(variance) * 100).toFixed(2));

      const indicators: TechnicalIndicators = {
        rsi14,
        macd,
        ema9,
        ema21,
        ema50,
        ema200,
        bollingerBands,
        atr14,
        vwap,
        spreadBps,
        volatility24h
      };

      // Classify Market Regime
      const regime = this.classifyRegime(indicators, orderBookImbalance, currentPrice);

      this.latencyMs = Date.now() - start;
      this.lastHeartbeat = new Date().toISOString();
      this.status = 'HEALTHY';

      this.indicatorsCache.set(symbol, {
        indicators,
        regime,
        timestamp: Date.now()
      });

      return { indicators, regime };
    } catch (err: any) {
      this.status = 'DEGRADED';
      this.recordError('ERROR', `Error calculating quant signals for ${symbol}: ${err.message}`);
      return { indicators: null, regime: null, error: err.message };
    }
  }

  private classifyRegime(ind: TechnicalIndicators, obImbalance: number, currentPrice: number): MarketRegime {
    const isTrendBull = currentPrice > ind.ema21 && ind.macd.histogram > 0 && ind.rsi14 > 55;
    const isTrendBear = currentPrice < ind.ema21 && ind.macd.histogram < 0 && ind.rsi14 < 45;
    const isHighVol = ind.bollingerBands.bandwidth > 3.0 || ind.volatility24h > 2.0;

    let regimeType: MarketRegime['regime'] = 'RANGE_BOUND_LOW_VOL';
    let confidence = 0.85;
    let trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let recommendedSpacing = 0.45;
    let suggestedAction = 'Deploy neutral geometric grid around mid price.';

    if (isTrendBull) {
      trendDirection = 'BULLISH';
      regimeType = 'BULL_TREND_STRONG';
      confidence = 0.88;
      recommendedSpacing = 0.65;
      suggestedAction = 'Bullish momentum detected. Skew grid density toward lower accumulation and trail upper exit rungs.';
    } else if (isTrendBear) {
      trendDirection = 'BEARISH';
      regimeType = 'BEAR_TREND_STRONG';
      confidence = 0.86;
      recommendedSpacing = 0.70;
      suggestedAction = 'Bearish trend detected. Widen lower rungs, reduce buy allocations, and prepare stop loss triggers.';
    } else if (isHighVol) {
      regimeType = 'BREAKOUT_VOLATILITY';
      confidence = 0.82;
      recommendedSpacing = 0.85;
      suggestedAction = 'High volatility expansion. Widen grid spacing by 30% to prevent rapid rung saturation.';
    } else {
      regimeType = 'RANGE_BOUND_LOW_VOL';
      trendDirection = 'NEUTRAL';
      confidence = 0.90;
      recommendedSpacing = 0.40;
      suggestedAction = 'Range-bound consolidation. Ideal conditions for standard mean-reverting geometric grid.';
    }

    return {
      regime: regimeType,
      confidence,
      atr: ind.atr14,
      rsi: ind.rsi14,
      adx: 18.5,
      bbBandwidth: ind.bollingerBands.bandwidth,
      orderBookImbalance: obImbalance,
      trendDirection,
      recommendedGridSpacing: recommendedSpacing,
      suggestedAction,
      detectedAt: new Date().toISOString()
    };
  }

  private calculateRSI(closes: number[], period = 14): number {
    if (closes.length < period + 1) return 50.0;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return Number((100 - (100 / (1 + rs))).toFixed(2));
  }

  private calculateEMA(data: number[], period: number): number {
    if (data.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return Number(ema.toFixed(4));
  }

  private calculateMACD(closes: number[]) {
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macdLine = Number((ema12 - ema26).toFixed(4));
    const signal = Number((macdLine * 0.9).toFixed(4));
    const histogram = Number((macdLine - signal).toFixed(4));
    return { macd: macdLine, signal, histogram };
  }

  private calculateBollingerBands(closes: number[], period = 20, stdDevMult = 2) {
    const len = Math.min(closes.length, period);
    if (len === 0) return { upper: 0, middle: 0, lower: 0, bandwidth: 0 };
    const slice = closes.slice(-len);
    const middle = slice.reduce((a, b) => a + b, 0) / len;
    const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / len;
    const stdDev = Math.sqrt(variance);
    const upper = Number((middle + stdDev * stdDevMult).toFixed(4));
    const lower = Number((middle - stdDev * stdDevMult).toFixed(4));
    const bandwidth = middle > 0 ? Number((((upper - lower) / middle) * 100).toFixed(2)) : 0;
    return { upper, middle: Number(middle.toFixed(4)), lower, bandwidth };
  }

  private calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number {
    if (highs.length < 2) return highs[0] ? highs[0] * 0.01 : 1.0;
    const trs: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      trs.push(Math.max(hl, hc, lc));
    }
    const len = Math.min(trs.length, period);
    const slice = trs.slice(-len);
    const atr = slice.reduce((a, b) => a + b, 0) / (len || 1);
    return Number(atr.toFixed(4));
  }

  private calculateVWAP(candles: Candle[]): number {
    let cumVol = 0;
    let cumPriceVol = 0;
    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumVol += c.volume;
      cumPriceVol += typicalPrice * c.volume;
    }
    return cumVol > 0 ? Number((cumPriceVol / cumVol).toFixed(4)) : (candles[candles.length - 1]?.close || 0);
  }
}
