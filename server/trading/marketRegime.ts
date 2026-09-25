export function detectMarketRegime(candles: Candle[], orderBook?: OrderBook): MarketRegime {
  if (candles.length < 20) {
    return {
      regime: 'UNKNOWN',
      confidence: 0,
      atr: 0,
      rsi: 0,
      adx: 0,
      bbBandwidth: 0,
      orderBookImbalance: 0,
      trendDirection: 'NEUTRAL',
      recommendedGridSpacing: 0,
      suggestedAction: 'Insufficient live Bybit candle evidence. Trading decisions remain fail-closed.',
      detectedAt: new Date().toISOString()
    };
  }

  const indicators: TechnicalIndicators = computeAllIndicators(candles, orderBook);
  const currentPrice = candles[candles.length - 1].close;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || indicators.atr14 <= 0) {
    return {
      regime: 'UNKNOWN',
      confidence: 0,
      atr: 0,
      rsi: 0,
      adx: 0,
      bbBandwidth: 0,
      orderBookImbalance: 0,
      trendDirection: 'NEUTRAL',
      recommendedGridSpacing: 0,
      suggestedAction: 'Live market indicators are invalid. Trading decisions remain fail-closed.',
      detectedAt: new Date().toISOString()
    };
  }

  const imbalance = orderBook ? calculateOrderBookImbalance(orderBook) : 0;
  const ema9 = indicators.ema9;
  const ema21 = indicators.ema21;
  const ema50 = indicators.ema50;
  const isEmaBullish = ema9 > ema21 && ema21 > ema50;
  const isEmaBearish = ema9 < ema21 && ema21 < ema50;
  const bbWidth = indicators.bollingerBands.bandwidth;
  const rsi = indicators.rsi14;
  const atrRelative = (indicators.atr14 / currentPrice) * 100;

  let regime: MarketRegimeType = 'RANGE_BOUND_LOW_VOL';
  let confidence = 0.8;
  let trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let recommendedGridSpacing = 0.5;
  let suggestedAction = 'Run neutral range grid strategy';

  if (bbWidth > 6.0 || atrRelative > 3.0) {
    if (isEmaBullish && rsi > 65) {
      regime = 'BULL_TREND_STRONG'; confidence = 0.88; trendDirection = 'BULLISH'; recommendedGridSpacing = 1.2;
      suggestedAction = 'Shift grid upward; hold inventory only within live risk limits.';
    } else if (isEmaBearish && rsi < 35) {
      regime = 'BEAR_TREND_STRONG'; confidence = 0.89; trendDirection = 'BEARISH'; recommendedGridSpacing = 1.4;
      suggestedAction = 'Defensive spacing; reduce buy allocations and protect capital.';
    } else {
      regime = 'BREAKOUT_VOLATILITY'; confidence = 0.82;
      trendDirection = rsi > 50 ? 'BULLISH' : 'BEARISH'; recommendedGridSpacing = 1.5;
      suggestedAction = 'Widen grid spacing and require stronger net-edge evidence.';
    }
  } else if (orderBook && (orderBook.spreadBps > 15 || Math.abs(imbalance) > 0.65)) {
    regime = 'LIQUIDITY_SQUEEZE'; confidence = 0.85;
    trendDirection = imbalance > 0 ? 'BULLISH' : 'BEARISH'; recommendedGridSpacing = 1.1;
    suggestedAction = 'Liquidity is thin. Require maker-only execution and stronger edge.';
  } else if (bbWidth > 3.5 || atrRelative > 1.8) {
    regime = 'RANGE_BOUND_HIGH_VOL'; confidence = 0.84; recommendedGridSpacing = 0.85;
    suggestedAction = 'Wide range conditions; use measured spacing and inventory controls.';
  } else {
    regime = 'RANGE_BOUND_LOW_VOL'; confidence = 0.91; recommendedGridSpacing = 0.45;
    suggestedAction = 'Low-volatility range; trade only when live net edge exceeds costs.';
  }

  const transition = regimeTransitionDetector.detectTransition(
    orderBook?.symbol || 'UNKNOWN',
    currentPrice,
    candles,
    regime,
    indicators,
    orderBook
  );

  if (transition.phase === 'BREAKOUT_CONFIRMED' && transition.tentativeTargetRegime) regime = transition.tentativeTargetRegime;
  if (transition.isTransitioning) {
    suggestedAction = `[${transition.phase}] ${transition.actionGuidance}`;
    recommendedGridSpacing = Number((recommendedGridSpacing * (transition.phase === 'BREAKOUT_TESTING' ? 1.8 : 1.4)).toFixed(2));
  }

  return {
    regime,
    confidence,
    atr: indicators.atr14,
    rsi,
    adx: indicators.adx,
    adxSlope: indicators.adxSlope,
    bbBandwidth: bbWidth,
    orderBookImbalance: imbalance,
    trendDirection,
    recommendedGridSpacing,
    suggestedAction,
    detectedAt: new Date().toISOString(),
    transition
  };
}
