import {
  AuditLog,
  AutonomyLevel,
  CapitalAccounting,
  GridConfiguration,
  MarketRegime,
  Order,
  Position,
  TradingMode
} from './types.js';
import { DataEngine, LivePairMarketData } from './dataEngine.js';
import { QuantEngine } from './quantEngine.js';
import { GridEngine } from './gridEngine.js';
import { ExchangeExecutionEngine } from './exchangeExecutionEngine.js';
import { RiskEngine } from './riskEngine.js';
import { ProfitAccountingEngine } from './profitAccounting.js';
import { ProfitSweepEngine } from './profitSweep.js';
import { AutonomousResearchAgent } from './researchAgent.js';
import { LearningLoopEngine } from './learningLoop.js';
import { StrategyValidatorEngine } from './scriptingEngine.js';
import { SystemMonitorSecurity } from './systemMonitor.js';
import { EmergencyKillSwitch } from './killSwitch.js';
import { bybitAdapter } from './bybitAdapter.js';
import { AutonomousProfitOptimizer } from './autonomousProfitOptimizer.js';
import { AutonomousOptimizationDecision } from './types.js';

export class TradingStore {
  // Modular Subsystems
  public dataEngine: DataEngine;
  public quantEngine: QuantEngine;
  public gridEngine: GridEngine;
  public exchangeExec: ExchangeExecutionEngine;
  public risk: RiskEngine;
  public profitAccounting: ProfitAccountingEngine;
  public sweeper: ProfitSweepEngine;
  public research: AutonomousResearchAgent;
  public learningLoop: LearningLoopEngine;
  public scripting: StrategyValidatorEngine;
  public monitor: SystemMonitorSecurity;
  public killSwitch: EmergencyKillSwitch;
  public profitOptimizer: AutonomousProfitOptimizer;

  // Runtime State
  public activeSymbol: string = 'BTC/USDT';
  public autonomyLevel: AutonomyLevel = 0; // Default LEVEL 0 (SAFETY: Observe only, zero orders)
  public previousAutonomyLevel: AutonomyLevel = 1;
  public GLOBAL_KILL_SWITCH_ACTIVE: boolean = true; // DEFAULT SAFE KILL SWITCH ENGAGED ON STARTUP
  public activeBotsDisabled: boolean = true;
  public readonly tradingMode: TradingMode = 'LIVE'; // STRICTLY LIVE ONLY
  public currentRegime: MarketRegime;
  public activeGrid: GridConfiguration | null = null;
  public ownerAuthenticated: boolean = false;
  public autonomousBotRunning: boolean = false;
  public autonomousAllocatedCapitalUsd: number = 0;
  public autonomousStartedAt?: string;

  constructor() {
    // 1. Instantiate all 11 modular engines
    this.dataEngine = new DataEngine();
    this.quantEngine = new QuantEngine();
    this.gridEngine = new GridEngine();
    this.exchangeExec = new ExchangeExecutionEngine();
    this.risk = new RiskEngine();
    this.profitAccounting = new ProfitAccountingEngine();
    this.sweeper = new ProfitSweepEngine();
    this.research = new AutonomousResearchAgent();
    this.learningLoop = new LearningLoopEngine();
    this.scripting = new StrategyValidatorEngine();
    this.monitor = new SystemMonitorSecurity();
    this.killSwitch = new EmergencyKillSwitch();
    this.profitOptimizer = new AutonomousProfitOptimizer();

    // Fund sweeps must respect the same emergency halt as order placement.
    this.sweeper.setKillSwitchGuard(() => this.GLOBAL_KILL_SWITCH_ACTIVE || this.killSwitch.getState().isActive);

    // 2. Register all engines with Central Continuous Monitor
    this.monitor.registerEngine(this.dataEngine);
    this.monitor.registerEngine(this.quantEngine);
    this.monitor.registerEngine(this.gridEngine);
    this.monitor.registerEngine(this.research);
    this.monitor.registerEngine(this.learningLoop);
    this.monitor.registerEngine(this.scripting);
    this.monitor.registerEngine(this.exchangeExec);
    this.monitor.registerEngine(this.risk);
    this.monitor.registerEngine(this.profitAccounting);
    this.monitor.registerEngine(this.sweeper);
    this.monitor.registerEngine(this.profitOptimizer);

    // 3. Default safe kill switch engaged per live safety mandate
    this.killSwitch.activate(
      'RISK_ENGINE',
      'GLOBAL_KILL_SWITCH_ACTIVE=true on startup: Live fund protection engaged. All automated bots paused.',
      0,
      false
    );
    // Halt the execution engine itself so restart state also blocks direct order dispatch.
    this.exchangeExec.setHalted(true);

    // 4. No fabricated startup market regime. The system stays UNKNOWN until live evidence arrives.
    this.currentRegime = {
      regime: 'UNKNOWN',
      confidence: 0,
      atr: 0,
      rsi: 0,
      adx: 0,
      bbBandwidth: 0,
      orderBookImbalance: 0,
      trendDirection: 'NEUTRAL',
      recommendedGridSpacing: 0,
      suggestedAction: 'Waiting for fresh live market evidence; trading remains fail-closed.',
      detectedAt: new Date().toISOString()
    };

    // 5. Connect real-time tick listener from Data Engine
    this.dataEngine.registerTickCallback((symbol, price, liveData) => {
      if (symbol === this.activeSymbol) {
        this.handleLiveTick(symbol, price, liveData);
      }
    });

    // 6. Background capital sync & order reconciliation from real exchange account
    this.syncCapitalFromRealExchange().catch(() => {});
    this.exchangeExec.reconcileOpenOrders(this.activeSymbol).then(result => {
      if (result.error) {
        this.exchangeExec.setOffSwitch(false);
        this.triggerEmergencyKillSwitch(`Exchange reconciliation failed at startup: ${result.error}`);
      }
    }).catch((err: any) => {
      this.exchangeExec.setOffSwitch(false);
      this.triggerEmergencyKillSwitch(`Exchange reconciliation failed at startup: ${err?.message || 'unknown error'}`);
    });
    setInterval(() => {
      this.syncCapitalFromRealExchange().catch(() => {});
      this.exchangeExec.reconcileOpenOrders(this.activeSymbol).then(result => {
        if (result.error) {
          this.exchangeExec.setOffSwitch(false);
          this.triggerEmergencyKillSwitch(`Exchange reconciliation failed: ${result.error}`);
        }
      }).catch((err: any) => {
        this.exchangeExec.setOffSwitch(false);
        this.triggerEmergencyKillSwitch(`Exchange reconciliation failed: ${err?.message || 'unknown error'}`);
      });
    }, 15000);

    // 7. Continuous Autonomous AI Revenue Optimizer (Audit -> Decide -> Build -> Auto-Deploy)
    // Runs automatically every 45s without asking the operator to choose
    setInterval(() => {
      this.runAutonomousProfitOptimizationCycle().catch(() => {});
    }, 45000);

    this.monitor.logAudit({
      category: 'SYSTEM_BOOT',
      action: 'GigPilot Modular Engine Architecture Booted',
      details: {
        mode: 'LIVE',
        failClosedPolicy: true,
        killSwitchActive: true,
        modulesCount: 11,
        autonomousRevenueOptimizer: 'ACTIVE'
      }
    });
  }

  public get capital(): CapitalAccounting {
    return this.profitAccounting.getCapital();
  }

  /**
   * Continuous Autonomous Profit Optimization Loop:
   * 1. Audits live revenue, trading fees, and spread efficiency (filtering vanity metrics).
   * 2. Decides on optimal parameter/grid mutation.
   * 3. Builds improved strategy variant.
   * 4. Automatically applies the improvement to the active grid and exchange without asking.
   */
  public async runAutonomousProfitOptimizationCycle(forceImmediate = false): Promise<AutonomousOptimizationDecision> {
    const failStatus = this.monitor.isSystemFailClosed();
    const isKill = this.GLOBAL_KILL_SWITCH_ACTIVE || this.killSwitch.getState().isActive;
    const midPrice = this.dataEngine.getPairData(this.activeSymbol)?.currentPrice;

    const decision = await this.profitOptimizer.auditAndOptimize({
      capital: this.capital,
      grid: this.activeGrid,
      regime: this.currentRegime,
      research: this.research.getResearchItems(),
      champion: this.learningLoop.getChampionStrategy(),
      systemHealthy: !failStatus.failClosed && !isKill,
      midPrice,
      forceImmediate
    });

    // Auto-Deploy the improvement if applied
    if (decision.applied && decision.newGridSpacingPct && this.activeGrid) {
      const oldSpacing = this.activeGrid.gridSpacingPct;
      this.activeGrid.gridSpacingPct = decision.newGridSpacingPct;

      // If a strategy build was produced, automatically promote into the Champion slot!
      if (decision.strategyBuildId) {
        const builds = this.profitOptimizer.getStrategyBuilds();
        const build = builds.find(b => b.id === decision.strategyBuildId);
        if (build && build.status === 'BUILT') {
          this.learningLoop.registerAndPromoteBuiltStrategy({
            id: build.id,
            strategyName: build.strategyName,
            parameters: build.parameters,
            rationale: build.rationale,
            expectedEffect: build.expectedEffect
          });
        }
      }

      // If Strategy Allocator allocated capital to a champion strategy
      if (decision.strategyAllocation) {
        const top = decision.strategyAllocation.strategies.find(s => s.strategyId === decision.strategyAllocation?.topRecipientStrategyId);
        if (top && top.allocatedCapitalUsd > 0) {
          this.activeGrid.totalAllocatedUsd = top.allocatedCapitalUsd;
        }
      }

      // Rebalance live grid on exchange if active trading is running
      if (!isKill && this.autonomyLevel >= 2 && midPrice) {
        const pairData = this.dataEngine.getPairData(this.activeSymbol);
        const newGridRes = this.gridEngine.generateGrid({
          symbol: this.activeSymbol,
          currentPrice: midPrice,
          totalAllocatedUsd: this.activeGrid.totalAllocatedUsd,
          levelsCount: this.activeGrid.levelsCount,
          spacingType: this.activeGrid.spacingType,
          volatilityAdjustment: true,
          trendProtection: true,
          regime: this.currentRegime,
          positions: this.exchangeExec.getPositions(),
          orderBook: pairData?.orderBook,
          candles: pairData?.candles,
          totalEquityUsd: this.capital.totalEquity || this.capital.tradingCapital
        });

        if (newGridRes.grid) {
          newGridRes.grid.gridSpacingPct = decision.newGridSpacingPct;
          this.activeGrid = newGridRes.grid;
          // Await the cancel before re-placing: an in-flight cancel-all would otherwise race the
          // new order/create calls and cancel freshly placed rungs.
          await this.exchangeExec.cancelAllOrders(this.activeSymbol);
          this.placeGridOrdersInExchange(this.activeGrid, midPrice);
        }
      }

      this.monitor.logAudit({
        category: 'AUTONOMOUS_OPTIMIZATION',
        action: decision.strategyAllocation 
          ? `Strategy Allocator Allocated Capital: ${decision.strategyAllocation.topRecipientStrategyName} (${decision.strategyAllocation.strategies[0]?.targetWeightPct}% - $${this.activeGrid.totalAllocatedUsd} USDT)`
          : `AI Auto-Applied Improvement: Spacing ${oldSpacing}% -> ${decision.newGridSpacingPct}% (${decision.decision})`,
        details: {
          decisionId: decision.id,
          objective: decision.objective,
          confidence: decision.confidence,
          reason: decision.reason,
          expectedEffect: decision.expectedEffect,
          strategyBuildId: decision.strategyBuildId,
          topStrategyRecipient: decision.strategyAllocation?.topRecipientStrategyName
        }
      });
    }

    return decision;
  }

  public async syncCapitalFromRealExchange(): Promise<void> {
    try {
      const acct = await bybitAdapter.getRealAccountState();
      if (acct.status === 'CONNECTED') {
        this.profitAccounting.syncFromRealAccount({
          totalEquityUsd: acct.totalEquityUsd,
          availableCashUsd: acct.availableCashUsd,
          lockedInOrdersUsd: acct.lockedInOrdersUsd
        });
        for (const fill of acct.recentTrades || []) {
          this.profitAccounting.recordFill(fill);
        }
        const positionSync = await this.exchangeExec.syncLiveFuturesPositions(this.activeSymbol);
        if (positionSync.error) {
          this.exchangeExec.setOffSwitch(false);
          this.triggerEmergencyKillSwitch('Bybit futures position reconciliation failed: ' + positionSync.error);
          return;
        }

        // Every authoritative open futures position must have native exchange TP/SL.
        // The active strategy grid supplies the live protection boundaries; if those
        // boundaries are unavailable or invalid, fail closed instead of trading naked.
        const position = this.exchangeExec.getPosition(this.activeSymbol);
        // A live position with no grid (e.g. restart before grid regeneration) previously skipped
        // this whole protection block, leaving the position running with no exchange-side stop.
        if (position && Math.abs(position.baseAmount) > 0 && !this.activeGrid) {
          this.exchangeExec.setOffSwitch(false);
          this.triggerEmergencyKillSwitch('FAIL-CLOSED: authoritative futures position exists but no active grid is available to derive TP/SL boundaries.');
          return;
        }
        if (position && Math.abs(position.baseAmount) > 0 && this.activeGrid) {
          const isLong = position.baseAmount > 0;
          const takeProfit = isLong ? this.activeGrid.upperBoundary : this.activeGrid.lowerBoundary;
          const stopLoss = isLong ? this.activeGrid.lowerBoundary : this.activeGrid.upperBoundary;
          const validProtection =
            Number.isFinite(takeProfit) && takeProfit > 0 &&
            Number.isFinite(stopLoss) && stopLoss > 0 &&
            (isLong ? (takeProfit > position.entryPrice && stopLoss < position.entryPrice)
                    : (takeProfit < position.entryPrice && stopLoss > position.entryPrice));

          if (!validProtection) {
            this.exchangeExec.setOffSwitch(false);
            this.triggerEmergencyKillSwitch('FAIL-CLOSED: authoritative futures position exists without valid strategy-derived TP/SL boundaries.');
            return;
          }

          const protection = await this.exchangeExec.applyFuturesProtection(this.activeSymbol, takeProfit, stopLoss);
          if (!protection.success) {
            this.exchangeExec.setOffSwitch(false);
            this.triggerEmergencyKillSwitch('FAIL-CLOSED: Bybit futures TP/SL protection could not be applied: ' + (protection.error || 'unknown error'));
          }
        }
        return;
      }

      const exchangeCred = this.exchangeExec.getExchangeCredentials().find(c => c.exchange === 'BYBIT');
      if (exchangeCred?.isConfigured) {
        const reason = acct.message || `Bybit account state is ${acct.status}`;
        this.exchangeExec.setOffSwitch(false);
        this.triggerEmergencyKillSwitch(`Bybit account reconciliation unavailable: ${reason}`);
      }
    } catch (err: any) {
      const exchangeCred = this.exchangeExec.getExchangeCredentials().find(c => c.exchange === 'BYBIT');
      if (exchangeCred?.isConfigured) {
        this.exchangeExec.setOffSwitch(false);
        this.triggerEmergencyKillSwitch(`Bybit account reconciliation failed: ${err?.message || 'unknown error'}`);
      }
    }
  }

  private handleLiveTick(symbol: string, currentPrice: number, liveData: LivePairMarketData) {
    // 1. Calculate real quant signals strictly from live candles and depth
    const quantResult = this.quantEngine.computeSignals(symbol, liveData.candles, liveData.orderBook);
    if (quantResult.regime) {
      this.currentRegime = quantResult.regime;
    }

    // 2. If active grid exists and system is not in kill switch
    if (!this.GLOBAL_KILL_SWITCH_ACTIVE && this.activeGrid && this.autonomyLevel >= 2) {
      // Check for fail-closed system condition
      const failStatus = this.monitor.isSystemFailClosed();
      if (failStatus.failClosed) {
        return; // Fail closed: do not execute orders while critical engines are degraded or down
      }

      const check = this.gridEngine.checkRebalanceNeeded(currentPrice, this.activeGrid);
      if (check.needed) {
        const previousGrid = this.activeGrid;

        const newGridRes = this.gridEngine.generateGrid({
          symbol,
          currentPrice,
          totalAllocatedUsd: this.activeGrid.totalAllocatedUsd,
          levelsCount: this.activeGrid.levelsCount,
          spacingType: this.activeGrid.spacingType,
          volatilityAdjustment: true,
          trendProtection: true,
          regime: this.currentRegime,
          positions: this.exchangeExec.getPositions(),
          orderBook: liveData?.orderBook,
          candles: liveData?.candles,
          totalEquityUsd: this.capital.totalEquity || this.capital.tradingCapital
        });

        if (newGridRes.grid) {
          this.activeGrid = newGridRes.grid;
          // Serialize cancel -> place on the promise chain (handleLiveTick is synchronous). An
          // in-flight cancel-all would otherwise race the new order/create calls and cancel
          // freshly placed rungs, or leave stale rungs working.
          this.exchangeExec
            .cancelAllOrders(symbol)
            .then(() => {
              if (this.activeGrid && this.activeGrid !== previousGrid) {
                this.placeGridOrdersInExchange(this.activeGrid, currentPrice);
              }
            })
            .catch((err: any) => {
              console.error('Grid rebalance cancel failed; skipping re-placement to avoid duplicate live orders:', err?.message || err);
            });

          this.monitor.logAudit({
            category: 'AUTONOMOUS_REBALANCE',
            action: `Auto-rebalanced grid for ${symbol}`,
            details: {
              price: currentPrice,
              reason: check.reason,
              upper: this.activeGrid.upperBoundary,
              lower: this.activeGrid.lowerBoundary
            }
          });
        }
      }
    }
  }

  public placeGridOrdersInExchange(grid: GridConfiguration, midPrice?: number) {
    if (this.GLOBAL_KILL_SWITCH_ACTIVE || this.killSwitch.getState().isActive) return;
    if (this.autonomyLevel < 2) return;

    // Fail closed check:
    const failStatus = this.monitor.isSystemFailClosed();
    if (failStatus.failClosed) {
      this.monitor.logAudit({
        category: 'SECURITY_ALERT',
        action: 'Grid order placement blocked: System in Fail-Closed posture',
        details: { downEngines: failStatus.downEngines }
      });
      return;
    }

    const validSpecs: any[] = [];
    const pairData = this.dataEngine.getPairData(grid.symbol);
    const transition = this.currentRegime?.transition;

    // Check if new rungs are completely halted by transition state
    if (transition?.isTransitioning && transition.gridRestrictionStatus === 'HALT_NEW_RUNGS') {
      this.monitor.logAudit({
        category: 'SAFETY_REJECT',
        action: `Halted grid order placement: ${transition.restrictionReason}`,
        details: { symbol: grid.symbol, phase: transition.phase }
      });
      return;
    }

    for (const lvl of grid.activeLevels) {
      if (lvl.status !== 'PENDING') continue;

      // Regime Transition Protection Filters:
      // If market is testing a downside breakdown, avoid placing aggressive buy orders near mid-price
      if (transition?.isTransitioning) {
        if (transition.gridRestrictionStatus === 'RESTRICTED_DOWNSIDE' && lvl.side === 'BUY') {
          const distPct = ((midPrice - lvl.price) / midPrice) * 100;
          if (distPct < 2.0) {
            // Guard against falling knife: skip proximate buy rungs
            continue;
          }
        } else if (transition.gridRestrictionStatus === 'RESTRICTED_UPSIDE' && lvl.side === 'SELL') {
          const distPct = ((lvl.price - midPrice) / midPrice) * 100;
          if (distPct < 2.0) {
            // Guard against premature shorting into upside breakout
            continue;
          }
        }
      }

      // Microstructure Expected Net Edge evaluation with Inventory Hurdle
      const minHurdleBps = lvl.requiredEdgeHurdleBps ?? 4.0;
      const edge = this.quantEngine.computeExpectedNetEdge({
        symbol: grid.symbol,
        side: lvl.side,
        price: lvl.price,
        amount: lvl.orderSize,
        orderType: 'GRID_LIMIT',
        orderBook: pairData?.orderBook,
        candles: pairData?.candles,
        gridSpacingPct: grid.gridSpacingPct,
        regime: this.currentRegime,
        minHurdleBps
      });

      // 5-Gate Sequential Decision Tree:
      // Signal -> Is regime suitable? -> Is expected edge > costs? -> Is liquidity sufficient? -> Is inventory acceptable? -> Is portfolio risk acceptable?
      // TRADE (BUY/SELL) or NO TRADE (DO NOTHING)
      const decision = this.learningLoop.evaluateAndLogDecision({
        symbol: grid.symbol,
        side: lvl.side,
        price: lvl.price,
        amount: lvl.orderSize,
        source: `GRID_RUNG_${lvl.index}`,
        confidence: this.currentRegime.confidence,
        regime: this.currentRegime,
        orderBook: pairData?.orderBook,
        candles: pairData?.candles,
        positions: this.exchangeExec.getPositions(),
        capital: this.capital,
        inventory: grid.inventoryAwareness,
        expectedNetEdge: edge,
        riskConfig: this.risk.getConfig(),
        circuitBreakerActive: this.risk.isCircuitBreakerActive(),
        failClosed: failStatus.failClosed
      });

      if (decision.finalOutcome === 'DO_NOTHING') {
        // DO NOTHING is a legitimate optimized action: avoid fee drag, negative edge, or inventory imbalance
        continue;
      }

      const validation = this.risk.validateOrder(
        {
          symbol: grid.symbol,
          side: lvl.side,
          price: lvl.price,
          amount: lvl.orderSize,
          isGridOrder: true
        },
        this.capital,
        this.exchangeExec.getPositions(),
        this.exchangeExec.getOpenOrders().length,
        midPrice,
        edge
      );

      if (validation.allowed) {
        validSpecs.push({
          symbol: grid.symbol,
          side: lvl.side,
          type: 'GRID_LIMIT' as const,
          price: lvl.price,
          amount: lvl.orderSize,
          isGridOrder: true,
          gridLevelId: lvl.id,
          strategyId: this.learningLoop.getChampionStrategy().id,
          expectedNetEdge: edge,
          leverage: this.risk.getConfig().maxLeverage
        });
      }
    }

    if (validSpecs.length > 0) {
      this.exchangeExec.executeBatchOrders(validSpecs).then(res => {
        if (res.executed.length > 0) {
          for (const ord of res.executed) {
            const matchedLvl = grid.activeLevels.find(l => l.id === ord.gridLevelId);
            if (matchedLvl) matchedLvl.status = 'PLACED';
          }
        }
      }).catch(err => {
        this.monitor.logAudit({
          category: 'SECURITY_ALERT',
          action: 'Batch order dispatch error',
          details: { error: err.message }
        });
      });
    }
  }

  public async startAutonomousTrading(symbol: string, allocatedCapitalUsd: number): Promise<void> {
    const killState = this.killSwitch.getState();
    const startupSafetyLatch = killState.isActive &&
      killState.triggeredBy === 'RISK_ENGINE' &&
      killState.reason?.startsWith('GLOBAL_KILL_SWITCH_ACTIVE=true on startup:');

    if ((this.GLOBAL_KILL_SWITCH_ACTIVE || killState.isActive) && !startupSafetyLatch) {
      throw new Error('GLOBAL KILL SWITCH is active. Resolve the safety halt before autonomous trading can start.');
    }

    const norm = this.dataEngine.normalizeSymbol(symbol);
    const allocation = Number(allocatedCapitalUsd);
    if (!Number.isFinite(allocation) || allocation <= 0) {
      throw new Error('Trading capital must be a positive live amount.');
    }

    const liveData = this.dataEngine.getPairData(norm);
    if (!liveData || !Number.isFinite(liveData.currentPrice) || liveData.currentPrice <= 0 ||
        !liveData.orderBook?.bids?.length || !liveData.orderBook?.asks?.length ||
        !Array.isArray(liveData.candles) || liveData.candles.length < 5) {
      throw new Error('FAIL-CLOSED: authoritative live price, order book, and minimum candle depth are required before autonomous trading can start.');
    }

    const failStatus = this.monitor.isSystemFailClosed();
    if (failStatus.failClosed) {
      throw new Error(`FAIL-CLOSED: critical engine(s) are degraded or offline: ${failStatus.downEngines.join(', ')}`);
    }
    if (this.risk.isCircuitBreakerActive()) {
      throw new Error('Risk circuit breaker is active. Autonomous trading cannot start.');
    }

    const cred = this.exchangeExec.getExchangeCredentials().find(c => c.exchange === 'BYBIT');
    if (!cred?.isConfigured || cred.status !== 'CONNECTED' || !cred.canTrade) {
      throw new Error(`Bybit trading credentials are not trade-ready (status: ${cred?.status || 'UNCONFIGURED'}).`);
    }

    const riskConfig = this.risk.getConfig();
    const leverageReady = await this.exchangeExec.ensureFuturesLeverage(norm, riskConfig.maxLeverage);
    if (!leverageReady.success) {
      throw new Error(`FAIL-CLOSED: futures leverage could not be configured within the risk limit: ${leverageReady.error || 'exchange rejected leverage configuration'}`);
    }
    const availableCash = Number(this.capital.availableCash || 0);
    const maxByPct = availableCash * (riskConfig.maxCapitalAllocationPct / 100);
    const maxAllowed = Math.max(0, Math.min(availableCash - riskConfig.minAccountReserveUsd, maxByPct));
    if (allocation > maxAllowed + 1e-9) {
      throw new Error(`Allocated capital ${allocation.toFixed(2)} USDT exceeds the current risk-approved maximum ${maxAllowed.toFixed(2)} USDT after reserve and allocation limits.`);
    }

    const qResult = this.quantEngine.computeSignals(norm, liveData.candles, liveData.orderBook);
    if (qResult.regime) this.currentRegime = qResult.regime;

    const gridResult = this.gridEngine.generateGrid({
      symbol: norm,
      currentPrice: liveData.currentPrice,
      totalAllocatedUsd: allocation,
      levelsCount: 16,
      spacingType: 'GEOMETRIC',
      volatilityAdjustment: true,
      trendProtection: true,
      regime: this.currentRegime,
      positions: this.exchangeExec.getPositions(),
      orderBook: liveData.orderBook,
      candles: liveData.candles,
      totalEquityUsd: this.capital.totalEquity || this.capital.tradingCapital
    });
    if (!gridResult.grid) {
      throw new Error(gridResult.error || 'Autonomous strategy could not produce a risk-valid grid from live market evidence.');
    }

    if (startupSafetyLatch) {
      this.GLOBAL_KILL_SWITCH_ACTIVE = false;
      this.killSwitch.deactivate();
    }

    this.activeSymbol = norm;
    this.activeGrid = gridResult.grid;
    this.autonomousAllocatedCapitalUsd = allocation;
    this.autonomousBotRunning = true;
    this.autonomousStartedAt = new Date().toISOString();
    this.autonomyLevel = 2;
    this.activeBotsDisabled = false;

    this.monitor.logAudit({
      category: 'CONFIG_CHANGE',
      action: 'AUTONOMOUS_TRADING_STARTED',
      details: {
        symbol: norm,
        allocatedCapitalUsd: allocation,
        autonomyLevel: this.autonomyLevel,
        requiredNetEdgeBps: riskConfig.minimum_edge_threshold ?? riskConfig.minExpectedNetEdgeBps ?? 4.0
      }
    });

    this.placeGridOrdersInExchange(this.activeGrid, liveData.currentPrice);
  }

  public async stopAutonomousTrading(): Promise<{ cancelledEntryOrders: number; reconciledCount: number }> {
    this.autonomousBotRunning = false;
    this.autonomyLevel = 0;
    this.activeBotsDisabled = true;

    const cancelledEntryOrders = await this.exchangeExec.cancelNewEntryOrders(this.activeSymbol);
    const reconciliation = await this.exchangeExec.reconcileOpenOrders(this.activeSymbol);
    await this.syncCapitalFromRealExchange();

    this.monitor.logAudit({
      category: 'EMERGENCY_SHUTDOWN',
      action: 'AUTONOMOUS_TRADING_STOPPED',
      details: {
        symbol: this.activeSymbol,
        cancelledEntryOrders,
        reconciledCount: reconciliation.reconciledCount,
        existingPositionsRemainUnderExchangeRiskControls: true
      }
    });

    return { cancelledEntryOrders, reconciledCount: reconciliation.reconciledCount };
  }

  public setAutonomyLevel(level: AutonomyLevel) {
    if (this.GLOBAL_KILL_SWITCH_ACTIVE && level > 0) {
      throw new Error('Cannot increase autonomy level while GLOBAL_KILL_SWITCH_ACTIVE is engaged. Disengage kill switch first.');
    }
    const prev = this.autonomyLevel;
    this.autonomyLevel = level;
    this.activeBotsDisabled = level === 0;
    this.monitor.logAudit({
      category: 'CONFIG_CHANGE',
      action: `Autonomy level changed from ${prev} to ${level}`,
      details: { previous: prev, newLevel: level }
    });
  }

  public async setActiveSymbol(symbol: string): Promise<void> {
    const norm = this.dataEngine.normalizeSymbol(symbol);
    this.activeSymbol = norm;

    const liveData = this.dataEngine.getPairData(norm);
    if (liveData && liveData.currentPrice > 0) {
      const qRes = this.quantEngine.computeSignals(norm, liveData.candles, liveData.orderBook);
      if (qRes.regime) this.currentRegime = qRes.regime;

      const gRes = this.gridEngine.generateGrid({
        symbol: norm,
        currentPrice: liveData.currentPrice,
        totalAllocatedUsd: Math.min(3500, this.capital.availableCash > 0 ? this.capital.availableCash * 0.5 : 1000),
        levelsCount: 16,
        spacingType: 'GEOMETRIC',
        volatilityAdjustment: true,
        trendProtection: true,
        regime: this.currentRegime,
        positions: this.exchangeExec.getPositions(),
        orderBook: liveData.orderBook,
        candles: liveData.candles,
        totalEquityUsd: this.capital.totalEquity || this.capital.tradingCapital
      });

      if (gRes.grid) {
        this.activeGrid = gRes.grid;
        if (!this.GLOBAL_KILL_SWITCH_ACTIVE && this.autonomyLevel >= 2) {
          // Await the cancel so the replacement grid is not raced by the in-flight cancel-all.
          await this.exchangeExec.cancelAllOrders(norm);
          this.placeGridOrdersInExchange(this.activeGrid, liveData.currentPrice);
        }
      }
    }
  }

  public async triggerEmergencyKillSwitch(reason = 'Manual operator emergency shutdown: Disabling all active trading bots'): Promise<void> {
    this.GLOBAL_KILL_SWITCH_ACTIVE = true;
    this.activeBotsDisabled = true;
    this.previousAutonomyLevel = this.autonomyLevel;
    this.autonomyLevel = 0;
    // Halt the execution engine itself: the kill switch must gate order dispatch directly, not
    // only the pre-trade gate in placeGridOrdersInExchange.
    this.exchangeExec.setHalted(true);
    const cancelledCount = await this.exchangeExec.cancelAllOrders();
    this.killSwitch.activate('OWNER', reason, cancelledCount, false);

    this.monitor.logAudit({
      category: 'EMERGENCY_SHUTDOWN',
      action: 'GLOBAL_KILL_SWITCH_ENGAGED',
      details: { reason, cancelledOrdersCount: cancelledCount }
    });
  }

  public deactivateKillSwitch(): void {
    this.GLOBAL_KILL_SWITCH_ACTIVE = false;
    this.activeBotsDisabled = false;
    this.exchangeExec.setHalted(false);
    this.killSwitch.deactivate();
    this.autonomyLevel = this.previousAutonomyLevel > 0 ? this.previousAutonomyLevel : 1;

    this.monitor.logAudit({
      category: 'CONFIG_CHANGE',
      action: 'GLOBAL_KILL_SWITCH_DEACTIVATED',
      details: { botsRestored: true, autonomyLevel: this.autonomyLevel }
    });

    const liveData = this.dataEngine.getPairData(this.activeSymbol);
    if (liveData && liveData.currentPrice > 0) {
      const gRes = this.gridEngine.generateGrid({
        symbol: this.activeSymbol,
        currentPrice: liveData.currentPrice,
        totalAllocatedUsd: Math.min(3500, this.capital.availableCash > 0 ? this.capital.availableCash * 0.5 : 1000),
        levelsCount: 16,
        spacingType: 'GEOMETRIC',
        volatilityAdjustment: true,
        trendProtection: true,
        regime: this.currentRegime,
        positions: this.exchangeExec.getPositions(),
        orderBook: liveData.orderBook,
        candles: liveData.candles,
        totalEquityUsd: this.capital.totalEquity || this.capital.tradingCapital
      });

      if (gRes.grid) {
        this.activeGrid = gRes.grid;
        if (this.autonomyLevel >= 2) {
          this.placeGridOrdersInExchange(this.activeGrid, liveData.currentPrice);
        }
      }
    }
  }
}

// Global Singleton Instance
export const globalTradingStore = new TradingStore();
