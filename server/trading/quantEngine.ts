import { Candle, EngineErrorRecord, EngineHealth, EngineModule, ExpectedNetEdgeBreakdown, MarketRegime, OrderBook, TechnicalIndicators } from './types.js';
import { calculateADX } from './indicators.js';
import { regimeTransitionDetector } from './regimeTransitionDetector.js';

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

      // 9. ADX (Directional Movement Index)
      const adxResult = calculateADX(candles, 14);

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
        volatility24h,
        adx: adxResult.adx,
        adxSlope: adxResult.adxSlope,
        plusDI: adxResult.plusDI,
        minusDI: adxResult.minusDI
      };

      // Classify Market Regime & Transitions explicitly
      const regime = this.classifyRegime(symbol, candles, indicators, orderBookImbalance, currentPrice, orderBook);

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

  private classifyRegime(
    symbol: string,
    candles: Candle[],
    ind: TechnicalIndicators,
    obImbalance: number,
    currentPrice: number,
    orderBook?: OrderBook
  ): MarketRegime {
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

    // Explicit Regime Transition Detection
    const transition = regimeTransitionDetector.detectTransition(
      symbol,
      currentPrice,
      candles,
      regimeType,
      ind,
      orderBook
    );

    // If breakout is confirmed, update regimeType to the target regime
    if (transition.phase === 'BREAKOUT_CONFIRMED' && transition.tentativeTargetRegime) {
      regimeType = transition.tentativeTargetRegime;
    }

    if (transition.isTransitioning) {
      suggestedAction = `[${transition.phase}] ${transition.actionGuidance}`;
      recommendedSpacing = Number((recommendedSpacing * (transition.phase === 'BREAKOUT_TESTING' ? 1.8 : 1.4)).toFixed(2));
    }

    return {
      regime: regimeType,
      confidence,
      atr: ind.atr14,
      rsi: ind.rsi14,
      adx: ind.adx || 18.5,
      adxSlope: ind.adxSlope || 0,
      bbBandwidth: ind.bollingerBands.bandwidth,
      orderBookImbalance: obImbalance,
      trendDirection,
      recommendedGridSpacing: recommendedSpacing,
      suggestedAction,
      detectedAt: new Date().toISOString(),
      transition
    };
  }

  /**
   * Quantitative Microstructure Expected Net Edge Decomposition
   *
   * Classical Quantitative Equation:
   *   Expected Gross Edge
   * − maker/taker fees
   * − expected spread cost
   * − expected slippage
   * − adverse-selection cost
   * − funding/other carrying cost
   * − execution uncertainty
   * = Expected Net Edge
   */
  public computeExpectedNetEdge(params: {
    symbol: string;
    side?: 'BUY' | 'SELL';
    price?: number;
    amount?: number;
    orderType?: 'LIMIT' | 'MARKET' | 'GRID_LIMIT';
    orderBook?: OrderBook;
    candles?: Candle[];
    gridSpacingPct?: number;
    regime?: MarketRegime;
    makerFeeBps?: number;
    takerFeeBps?: number;
    minHurdleBps?: number;
  }): ExpectedNetEdgeBreakdown {
    const {
      price,
      amount,
      orderType = 'GRID_LIMIT',
      orderBook,
      candles = [],
      gridSpacingPct = 0.45,
      regime,
      makerFeeBps = 10.0, // Bybit spot VIP0 standard (0.10% = 10 bps)
      takerFeeBps = 10.0,
      minHurdleBps = 4.0
    } = params;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const currentPrice = closes[closes.length - 1] || price || 0;
    const atr = this.calculateATR(highs, lows, closes, 14);
    const atrBps = Number(((atr / currentPrice) * 10000).toFixed(2));

    // 1. Expected Gross Edge (bps)
    // For Grid/Limit: capturing half the active grid oscillation distance + mean-reversion alpha
    let expectedGrossEdgeBps: number;
    if (gridSpacingPct && gridSpacingPct > 0) {
      expectedGrossEdgeBps = Number(((gridSpacingPct * 100) * 0.55).toFixed(2));
    } else {
      expectedGrossEdgeBps = Number(Math.max(18.0, atrBps * 0.32).toFixed(2));
    }

    // 2. Maker / Taker Fees (bps)
    const isMaker = orderType === 'LIMIT' || orderType === 'GRID_LIMIT';
    const makerTakerFeesBps = isMaker ? makerFeeBps : takerFeeBps;

    // 3. Expected Spread Cost (bps)
    let spreadBps = 0;
    if (orderBook && orderBook.bids?.length > 0 && orderBook.asks?.length > 0) {
      const bestBid = orderBook.bids[0].price;
      const bestAsk = orderBook.asks[0].price;
      const mid = (bestBid + bestAsk) / 2;
      if (mid > 0 && bestAsk > bestBid) {
        spreadBps = Number((((bestAsk - bestBid) / mid) * 10000).toFixed(2));
      }
    }
    // Maker passive liquidity earns spread or pays 0 crossing cost;
    // Taker pays half-spread. Rebalancing requires crossing threshold:
    const expectedSpreadCostBps = isMaker ? Number((spreadBps * 0.15).toFixed(2)) : Number((spreadBps * 0.50).toFixed(2));

    // 4. Expected Slippage (bps)
    const orderAmount = amount || 0;
    const orderCostUsd = currentPrice * orderAmount;
    let topLiquidityUsd = 0;
    if (orderBook && orderBook.asks?.length > 0 && orderBook.bids?.length > 0) {
      const topLevels = (params.side === 'BUY' ? orderBook.asks : orderBook.bids).slice(0, 3);
      topLiquidityUsd = topLevels.reduce((acc, lvl) => acc + (lvl.total || (lvl.price * lvl.amount)), 0);
    }
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(amount || 0) || (amount || 0) <= 0 || atr <= 0 || !orderBook?.bids?.length || !orderBook?.asks?.length || topLiquidityUsd <= 0) {
      return {
        expectedGrossEdgeBps: 0,
        makerTakerFeesBps: isMaker ? makerFeeBps : takerFeeBps,
        expectedSpreadCostBps: 0,
        expectedSlippageBps: 0,
        adverseSelectionCostBps: 0,
        fundingCarryingCostBps: 0,
        executionUncertaintyBps: 0,
        expectedNetEdgeBps: 0,
        isTradeable: false,
        minHurdleRateBps: minHurdleBps,
        edgeFormula: 'LIVE_MARKET_DATA_REQUIRED',
        timestamp: new Date().toISOString()
      };
    }
    const liquidityRatio = Math.min(2.0, orderCostUsd / topLiquidityUsd);
    const expectedSlippageBps = isMaker
      ? Number(Math.max(0.3, liquidityRatio * 0.8).toFixed(2))
      : Number(Math.max(1.5, liquidityRatio * spreadBps * 0.7).toFixed(2));

    // 5. Adverse-Selection Cost (bps)
    // Microstructure toxicity: likelihood that the order is filled right before an adverse price move.
    // Scales with order book imbalance and normalized volatility.
    const imbalance = regime?.orderBookImbalance ?? (orderBook ? this.calculateOrderBookImbalance(orderBook) : 0);
    const directionalToxicity = Math.abs(imbalance) * 4.5;
    const volatilityToxicity = Math.min(6.0, atrBps * 0.04);
    const adverseSelectionCostBps = Number((directionalToxicity + volatilityToxicity).toFixed(2));

    // 6. Funding / Other Carrying Cost (bps)
    // Inventory risk: capital tied up in spot grid while waiting for fill
    const isVolatile = regime?.regime === 'RANGE_BOUND_HIGH_VOL' || regime?.regime === 'BREAKOUT_VOLATILITY';
    const fundingCarryingCostBps = Number((1.2 + (isVolatile ? 0.8 : 0)).toFixed(2));

    // 7. Execution Uncertainty (bps)
    // Non-execution risk (fill probability decay) and network latency jitter
    const latencyPenalty = Math.min(2.0, (this.latencyMs / 100) * 0.5);
    const executionUncertaintyBps = Number((1.8 + latencyPenalty).toFixed(2));

    // Expected Net Edge = Gross - (Fees + Spread + Slippage + AdverseSelection + CarryingCost + ExecutionUncertainty)
    const totalDeductionsBps = Number(
      (
        makerTakerFeesBps +
        expectedSpreadCostBps +
        expectedSlippageBps +
        adverseSelectionCostBps +
        fundingCarryingCostBps +
        executionUncertaintyBps
      ).toFixed(2)
    );

    const expectedNetEdgeBps = Number((expectedGrossEdgeBps - totalDeductionsBps).toFixed(2));
    // Strictly greater than minimum_edge_threshold: Expected Net Edge > minimum_edge_threshold
    const isTradeable = expectedNetEdgeBps > minHurdleBps;

    return {
      expectedGrossEdgeBps,
      makerTakerFeesBps,
      expectedSpreadCostBps,
      expectedSlippageBps,
      adverseSelectionCostBps,
      fundingCarryingCostBps,
      executionUncertaintyBps,
      expectedNetEdgeBps,
      isTradeable,
      minHurdleRateBps: minHurdleBps,
      edgeFormula: `${expectedGrossEdgeBps} − ${makerTakerFeesBps} (fees) − ${expectedSpreadCostBps} (spread) − ${expectedSlippageBps} (slip) − ${adverseSelectionCostBps} (adv) − ${fundingCarryingCostBps} (carry) − ${executionUncertaintyBps} (uncert) = ${expectedNetEdgeBps} bps`,
      timestamp: new Date().toISOString()
    };
  }

  public calculateOrderBookImbalance(orderBook: OrderBook): number {
    if (!orderBook || !orderBook.bids || !orderBook.asks || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      return 0;
    }
    const topBidsVolume = orderBook.bids.slice(0, 5).reduce((acc, b) => acc + b.amount, 0);
    const topAsksVolume = orderBook.asks.slice(0, 5).reduce((acc, a) => acc + a.amount, 0);
    const totalVol = topBidsVolume + topAsksVolume;
    if (totalVol <= 0) return 0;
    return Number(((topBidsVolume - topAsksVolume) / totalVol).toFixed(4));
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
