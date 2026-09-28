import {
  Candle,
  GridRestrictionStatus,
  MarketRegimeType,
  OrderBook,
  RegimeTransitionCandidateNext,
  RegimeTransitionMetrics,
  RegimeTransitionPhase,
  RegimeTransitionState,
  TechnicalIndicators
} from './types.js';

interface SymbolTransitionTracking {
  currentPhase: RegimeTransitionPhase;
  sourceRegime: MarketRegimeType;
  transitionStartTimestamp: number;
  consecutiveBreakoutBars: number;
  /** Timestamp of the closed candle that was last counted, so counting is per-bar not per-tick. */
  lastBreakoutCandleTs: number;
  lastBreakoutSide: 'BULLISH' | 'BEARISH' | 'NONE';
  historicalAtrBaseline: number;
  historicalBbBandwidthBaseline: number;
}

export class RegimeTransitionDetector {
  private trackingBySymbol: Map<string, SymbolTransitionTracking> = new Map();

  /**
   * Evaluates market microstructure, technical indicators, and candle history
   * to explicitly detect whether the market is transitioning between regimes.
   */
  public detectTransition(
    symbol: string,
    currentPrice: number,
    candles: Candle[],
    currentRegime: MarketRegimeType,
    indicators: TechnicalIndicators,
    orderBook?: OrderBook
  ): RegimeTransitionState {
    const now = Date.now();
    let tracking = this.trackingBySymbol.get(symbol);
    if (!tracking) {
      tracking = {
        currentPhase: 'STABLE',
        sourceRegime: currentRegime,
        transitionStartTimestamp: now,
        consecutiveBreakoutBars: 0,
        lastBreakoutCandleTs: 0,
        lastBreakoutSide: 'NONE',
        historicalAtrBaseline: indicators.atr14 || 250,
        historicalBbBandwidthBaseline: indicators.bollingerBands.bandwidth || 2.5
      };
      this.trackingBySymbol.set(symbol, tracking);
    }

    // Rolling updates of baselines (exponential smooth during stable periods)
    if (tracking.currentPhase === 'STABLE') {
      tracking.historicalAtrBaseline = 0.95 * tracking.historicalAtrBaseline + 0.05 * indicators.atr14;
      tracking.historicalBbBandwidthBaseline = 0.95 * tracking.historicalBbBandwidthBaseline + 0.05 * indicators.bollingerBands.bandwidth;
      tracking.sourceRegime = currentRegime;
    }

    const baselineAtr = Math.max(1, tracking.historicalAtrBaseline);
    const baselineBbBandwidth = Math.max(0.5, tracking.historicalBbBandwidthBaseline);

    const volatilityExpansionRatio = Number((indicators.atr14 / baselineAtr).toFixed(2));
    const bbBandwidthExpansionPct = Number(
      (((indicators.bollingerBands.bandwidth - baselineBbBandwidth) / baselineBbBandwidth) * 100).toFixed(1)
    );

    const adxValue = indicators.adx ?? 18.5;
    const adxSlope = indicators.adxSlope ?? 0;

    // Boundaries
    const upperThreshold = indicators.bollingerBands.upper;
    const lowerThreshold = indicators.bollingerBands.lower;
    const middleThreshold = indicators.bollingerBands.middle;

    // Donchian 20-period channel
    const slice20 = candles.slice(-20);
    const donchianHigh = slice20.length > 0 ? Math.max(...slice20.map(c => c.high)) : upperThreshold;
    const donchianLow = slice20.length > 0 ? Math.min(...slice20.map(c => c.low)) : lowerThreshold;

    const effectiveUpper = Math.max(upperThreshold, donchianHigh * 0.999);
    const effectiveLower = Math.min(lowerThreshold, donchianLow * 1.001);

    // Breakout distance & side
    let breakoutSide: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
    let breakoutDistancePct = 0;

    const distToUpper = ((effectiveUpper - currentPrice) / currentPrice) * 100;
    const distToLower = ((currentPrice - effectiveLower) / currentPrice) * 100;

    if (currentPrice >= effectiveUpper * 0.998) {
      breakoutSide = 'BULLISH';
      breakoutDistancePct = Number(Math.abs(distToUpper).toFixed(2));
    } else if (currentPrice <= effectiveLower * 1.002) {
      breakoutSide = 'BEARISH';
      breakoutDistancePct = Number(Math.abs(distToLower).toFixed(2));
    } else {
      breakoutSide = 'NONE';
      breakoutDistancePct = Number(Math.min(distToUpper, distToLower).toFixed(2));
    }

    // Volume surge calculation
    let volumeSurgeRatio = 1.0;
    if (candles.length >= 20) {
      const avgVol = candles.slice(-20, -1).reduce((sum, c) => sum + (c.volume || 0), 0) / 19;
      const lastVol = candles[candles.length - 1]?.volume || avgVol;
      volumeSurgeRatio = avgVol > 0 ? Number((lastVol / avgVol).toFixed(2)) : 1.0;
    }

    // Recent candle shapes for rejection check (long wicks against boundary)
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles.length > 1 ? candles[candles.length - 2] : lastCandle;

    const isUpperRejectionWick = lastCandle
      ? (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) > (Math.abs(lastCandle.close - lastCandle.open) * 1.5) &&
        lastCandle.close < effectiveUpper
      : false;

    const isLowerRejectionWick = lastCandle
      ? (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) > (Math.abs(lastCandle.close - lastCandle.open) * 1.5) &&
        lastCandle.close > effectiveLower
      : false;

    // Check consecutive bars outside band
    const isCurrentlyOutsideUpper = currentPrice > effectiveUpper;
    const isCurrentlyOutsideLower = currentPrice < effectiveLower;

    // Count once per CLOSED candle, not once per polling tick. The live tick loop runs far more
    // often than the 1m candle interval, so per-tick counting reached "2 bars" in a few seconds
    // of price drift and then latched, permanently forcing BREAKOUT_CONFIRMED.
    const latestClosedCandleTs = Array.isArray(candles) && candles.length > 0
      ? Number(candles[candles.length - 1]?.timestamp) || 0
      : 0;

    if (isCurrentlyOutsideUpper || isCurrentlyOutsideLower) {
      if (latestClosedCandleTs > 0) {
        if (latestClosedCandleTs !== tracking.lastBreakoutCandleTs) {
          tracking.consecutiveBreakoutBars += 1;
          tracking.lastBreakoutCandleTs = latestClosedCandleTs;
        }
      } else if (tracking.consecutiveBreakoutBars === 0) {
        // No usable candle timestamps: count the first observation only, never per tick.
        tracking.consecutiveBreakoutBars = 1;
      }
      tracking.lastBreakoutSide = isCurrentlyOutsideUpper ? 'BULLISH' : 'BEARISH';
    } else {
      // Price is back inside the band: the breakout streak is broken and must not latch.
      if (tracking.consecutiveBreakoutBars > 0 && tracking.currentPhase === 'BREAKOUT_TESTING') {
        // Price was testing outside and is now back inside -> Rejection candidate!
      }
      tracking.consecutiveBreakoutBars = 0;
      tracking.lastBreakoutCandleTs = 0;
    }

    // =========================================================================
    // REGIME TRANSITION STATE MACHINE
    // =========================================================================
    let phase: RegimeTransitionPhase = 'STABLE';
    let resolution: 'BREAKOUT_CONFIRMED' | 'BREAKOUT_REJECTED' | 'PENDING' | undefined = undefined;
    let tentativeTargetRegime: MarketRegimeType | undefined = undefined;
    let confidence = 0.85;

    // Triggers for volatility expansion:
    const isVolExpanding = volatilityExpansionRatio >= 1.25 || bbBandwidthExpansionPct >= 30.0 || adxSlope >= 1.8;
    const isStrongVolExpansion = volatilityExpansionRatio >= 1.45 || bbBandwidthExpansionPct >= 50.0 || adxSlope >= 3.0;

    // Scenario 1: Currently in a Range regime experiencing breakout attempts
    const isRangeRegime = currentRegime === 'RANGE_BOUND_LOW_VOL' || currentRegime === 'RANGE_BOUND_HIGH_VOL';

    if (isRangeRegime) {
      if (tracking.consecutiveBreakoutBars >= 2 && adxValue >= 23 && isVolExpanding) {
        // Breakout sustained for multiple bars with expanding momentum -> CONFIRMED
        phase = 'BREAKOUT_CONFIRMED';
        resolution = 'BREAKOUT_CONFIRMED';
        tentativeTargetRegime = tracking.lastBreakoutSide === 'BULLISH' ? 'BULL_TREND_STRONG' : 'BEAR_TREND_STRONG';
        confidence = 0.90;
      } else if (
        (tracking.currentPhase === 'BREAKOUT_TESTING' || tracking.consecutiveBreakoutBars > 0) &&
        (!isCurrentlyOutsideUpper && !isCurrentlyOutsideLower) &&
        (isUpperRejectionWick || isLowerRejectionWick || indicators.rsi14 < 60 && indicators.rsi14 > 40)
      ) {
        // Breakout was attempted but rejected back inside range -> REJECTED (fakeout!)
        phase = 'BREAKOUT_REJECTED';
        resolution = 'BREAKOUT_REJECTED';
        tentativeTargetRegime = bbBandwidthExpansionPct > 20 ? 'RANGE_BOUND_HIGH_VOL' : 'RANGE_BOUND_LOW_VOL';
        confidence = 0.88;
      } else if (breakoutSide !== 'NONE' || isStrongVolExpansion) {
        // Active probing of breakout boundaries
        phase = 'BREAKOUT_TESTING';
        resolution = 'PENDING';
        tentativeTargetRegime = breakoutSide === 'BULLISH' ? 'BULL_TREND_STRONG' : (breakoutSide === 'BEARISH' ? 'BEAR_TREND_STRONG' : 'BREAKOUT_VOLATILITY');
        confidence = 0.82;
      } else if (isVolExpanding) {
        // Early volatility expansion without boundary touch yet
        phase = 'EXPANDING_VOLATILITY';
        resolution = 'PENDING';
        tentativeTargetRegime = 'BREAKOUT_VOLATILITY';
        confidence = 0.78;
      } else {
        phase = 'STABLE';
        tracking.consecutiveBreakoutBars = 0;
      }
    } 
    // Scenario 2: Currently in a Trend regime experiencing exhaustion or breakdown
    else if (currentRegime === 'BULL_TREND_STRONG' || currentRegime === 'BEAR_TREND_STRONG') {
      const isTrendExhausting = adxSlope < -2.5 && indicators.adx < 28 && Math.abs(currentPrice - middleThreshold) / middleThreshold < 0.015;
      
      if (isTrendExhausting) {
        phase = 'EXPANDING_VOLATILITY'; // Trend ending, transitioning to consolidation range
        resolution = 'PENDING';
        tentativeTargetRegime = 'RANGE_BOUND_HIGH_VOL';
        confidence = 0.80;
      } else if (currentRegime === 'BULL_TREND_STRONG' && currentPrice < effectiveLower) {
        // Bearish reversal transition
        phase = 'BREAKOUT_TESTING';
        resolution = 'PENDING';
        tentativeTargetRegime = 'BEAR_TREND_STRONG';
        confidence = 0.84;
      } else if (currentRegime === 'BEAR_TREND_STRONG' && currentPrice > effectiveUpper) {
        // Bullish reversal transition
        phase = 'BREAKOUT_TESTING';
        resolution = 'PENDING';
        tentativeTargetRegime = 'BULL_TREND_STRONG';
        confidence = 0.84;
      } else {
        phase = 'STABLE';
      }
    }
    // Scenario 3: Breakout volatility active
    else {
      if (tracking.consecutiveBreakoutBars >= 2 && adxValue >= 24) {
        phase = 'BREAKOUT_CONFIRMED';
        resolution = 'BREAKOUT_CONFIRMED';
        tentativeTargetRegime = tracking.lastBreakoutSide === 'BULLISH' ? 'BULL_TREND_STRONG' : 'BEAR_TREND_STRONG';
        confidence = 0.87;
      } else if (isVolExpanding) {
        phase = 'BREAKOUT_TESTING';
        resolution = 'PENDING';
        confidence = 0.81;
      } else {
        phase = 'STABLE';
      }
    }

    // State transition tracking timestamp management
    if (phase !== 'STABLE' && tracking.currentPhase === 'STABLE') {
      tracking.transitionStartTimestamp = now;
    } else if (phase === 'STABLE' && tracking.currentPhase !== 'STABLE') {
      // Transition completed and returned to stable
      tracking.consecutiveBreakoutBars = 0;
    }
    tracking.currentPhase = phase;

    const isTransitioning = phase !== 'STABLE';
    const timeInTransitionSeconds = isTransitioning
      ? Math.max(1, Math.floor((now - tracking.transitionStartTimestamp) / 1000))
      : 0;

    // Candidate Next Regimes with Probabilities
    const targetRegimes: RegimeTransitionCandidateNext[] = [];
    if (phase === 'BREAKOUT_TESTING' || phase === 'EXPANDING_VOLATILITY') {
      const probBreakout = isStrongVolExpansion || adxSlope > 2.5 ? 0.65 : 0.45;
      const probRange = Number((1.0 - probBreakout).toFixed(2));
      const trendTarget = breakoutSide === 'BEARISH' ? 'BEAR_TREND_STRONG' : 'BULL_TREND_STRONG';

      targetRegimes.push({
        regime: trendTarget,
        probability: probBreakout,
        triggerCondition: `Breakout sustained with ADX > 24 and 2+ consecutive closes outside boundary.`
      });
      targetRegimes.push({
        regime: 'RANGE_BOUND_HIGH_VOL',
        probability: probRange,
        triggerCondition: `Breakout rejected back inside band with volume contraction & mean reversion.`
      });
    } else if (phase === 'BREAKOUT_CONFIRMED') {
      const trendTarget = tracking.lastBreakoutSide === 'BEARISH' ? 'BEAR_TREND_STRONG' : 'BULL_TREND_STRONG';
      targetRegimes.push({
        regime: trendTarget,
        probability: 0.88,
        triggerCondition: `Sustained directional impulse. Trailing momentum rules active.`
      });
      targetRegimes.push({
        regime: 'RANGE_BOUND_HIGH_VOL',
        probability: 0.12,
        triggerCondition: `Climax reversal or sudden mean reversion.`
      });
    } else if (phase === 'BREAKOUT_REJECTED') {
      targetRegimes.push({
        regime: 'RANGE_BOUND_HIGH_VOL',
        probability: 0.82,
        triggerCondition: `Price accepted back into range. High-frequency geometric oscillating grid resumed.`
      });
      targetRegimes.push({
        regime: 'RANGE_BOUND_LOW_VOL',
        probability: 0.18,
        triggerCondition: `Volatility decays back to historical baseline.`
      });
    } else {
      targetRegimes.push({
        regime: currentRegime,
        probability: 0.92,
        triggerCondition: `Stable microstructure equilibrium maintained.`
      });
    }

    // =========================================================================
    // RISK SIZING & GRID RESTRICTION ACTIONS
    // =========================================================================
    let positionSizeMultiplier = 1.0;
    let gridRestrictionStatus: GridRestrictionStatus = 'NORMAL';
    let restrictionReason = 'Microstructure stable. Full 100% position sizing and bilateral grid rungs permitted.';
    let actionGuidance = 'Execute standard arithmetic or geometric grid capturing oscillatory round-trips.';

    if (phase === 'BREAKOUT_TESTING') {
      // 60% position size reduction to prevent building up large inventory into an unconfirmed breakout!
      positionSizeMultiplier = 0.40;

      if (breakoutSide === 'BULLISH') {
        gridRestrictionStatus = 'RESTRICTED_UPSIDE';
        restrictionReason = `Bullish breakout testing at $${effectiveUpper.toFixed(2)} (ATR surge ${volatilityExpansionRatio}x). Restricting sell limit rungs to avoid premature shorting.`;
        actionGuidance = 'Cut position sizing to 40%. Widen upper exit rungs by 2x. Hold base asset inventory until breakout confirmation or rejection.';
      } else if (breakoutSide === 'BEARISH') {
        gridRestrictionStatus = 'RESTRICTED_DOWNSIDE';
        restrictionReason = `Bearish breakdown testing at $${effectiveLower.toFixed(2)} (ATR surge ${volatilityExpansionRatio}x). Restricting buy limit rungs to avoid catching falling knife.`;
        actionGuidance = 'Cut position sizing to 40%. Freeze low-hanging buy limit orders. Require breakout rejection or stabilization before laddering.';
      } else {
        gridRestrictionStatus = 'WIDEN_DEFENSIVE';
        restrictionReason = `High volatility expansion testing boundaries. Widen grid spacing by 2.0x.`;
        actionGuidance = 'Cut position sizing to 40%. Double grid spacing to avoid rapid rung saturation.';
      }
    } else if (phase === 'EXPANDING_VOLATILITY') {
      positionSizeMultiplier = 0.50; // 50% cut
      gridRestrictionStatus = 'WIDEN_DEFENSIVE';
      restrictionReason = `Volatility expanding (ATR ratio ${volatilityExpansionRatio}x, ADX slope +${adxSlope}). Throttling capital allocation to 50%.`;
      actionGuidance = 'Widen rung spacing defensively by 1.5x. Halt aggressive ladder rebalancing.';
    } else if (phase === 'BREAKOUT_CONFIRMED') {
      positionSizeMultiplier = 0.60;
      gridRestrictionStatus = breakoutSide === 'BULLISH' ? 'RESTRICTED_UPSIDE' : 'RESTRICTED_DOWNSIDE';
      restrictionReason = `Breakout confirmed into ${tentativeTargetRegime}. Shift away from bilateral grid into directional momentum trailing mode.`;
      actionGuidance = 'Reallocate capital from Mean Reversion to Trend Grid / Momentum Breakout. Trail stops on breakout side.';
    } else if (phase === 'BREAKOUT_REJECTED') {
      positionSizeMultiplier = 0.85; // Safely restoring allocation
      gridRestrictionStatus = 'NORMAL';
      restrictionReason = `Breakout rejected (fakeout detected). Mean reversion resumed back inside Bollinger bounds.`;
      actionGuidance = 'Restore standard grid placement. Harvest mean reversion back to mid-price ($' + middleThreshold.toFixed(2) + ').';
    }

    const metrics: RegimeTransitionMetrics = {
      volatilityExpansionRatio,
      adxSlope,
      adxValue,
      bbBandwidthExpansionPct,
      breakoutThresholdUpper: effectiveUpper,
      breakoutThresholdLower: effectiveLower,
      breakoutDistancePct,
      breakoutSide,
      volumeSurgeRatio,
      confirmationBarsCount: tracking.consecutiveBreakoutBars
    };

    return {
      isTransitioning,
      phase,
      sourceRegime: tracking.sourceRegime,
      targetRegimes,
      tentativeTargetRegime,
      resolution,
      confidence,
      transitionStartTime: new Date(tracking.transitionStartTimestamp).toISOString(),
      timeInTransitionSeconds,
      metrics,
      positionSizeMultiplier,
      gridRestrictionStatus,
      restrictionReason,
      actionGuidance
    };
  }

  /**
   * Reset or simulate a transition state for testing/demonstration purposes
   */
  public resetTransition(symbol: string): void {
    this.trackingBySymbol.delete(symbol);
  }
}

// Global singleton instance
export const regimeTransitionDetector = new RegimeTransitionDetector();
