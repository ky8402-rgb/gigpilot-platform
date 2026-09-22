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
import { AutonomousProfitOptimizer } from './autonomousProfitOptimizer.js';
import { ScriptingSandboxEngine } from './scriptingEngine.js';
import { SystemMonitorSecurity } from './systemMonitor.js';
import { EmergencyKillSwitch } from './killSwitch.js';
import { bybitAdapter } from './bybitAdapter.js';

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
  public autonomousProfitOptimizer: AutonomousProfitOptimizer;
  public scripting: ScriptingSandboxEngine;
  public monitor: SystemMonitorSecurity;
  public killSwitch: EmergencyKillSwitch;

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

  constructor() {
    // 1. Instantiate all 10 modular engines
    this.dataEngine = new DataEngine();
    this.quantEngine = new QuantEngine();
    this.gridEngine = new GridEngine();
    this.exchangeExec = new ExchangeExecutionEngine();
    this.risk = new RiskEngine();
    this.profitAccounting = new ProfitAccountingEngine();
    this.sweeper = new ProfitSweepEngine();
    this.research = new AutonomousResearchAgent();
    this.learningLoop = new LearningLoopEngine();
    this.autonomousProfitOptimizer = new AutonomousProfitOptimizer();
    this.scripting = new ScriptingSandboxEngine();
    this.monitor = new SystemMonitorSecurity();
    this.killSwitch = new EmergencyKillSwitch();

    // 2. Register all engines with Central Continuous Monitor
    this.monitor.registerEngine(this.dataEngine);
    this.monitor.registerEngine(this.quantEngine);
    this.monitor.registerEngine(this.gridEngine);
    this.monitor.registerEngine(this.research);
    this.monitor.registerEngine(this.learningLoop);
    this.monitor.registerEngine(this.autonomousProfitOptimizer);
    this.monitor.registerEngine(this.scripting);
    this.monitor.registerEngine(this.exchangeExec);
    this.monitor.registerEngine(this.risk);
    this.monitor.registerEngine(this.profitAccounting);
    this.monitor.registerEngine(this.sweeper);

    // 3. Default safe kill switch engaged per live safety mandate
    this.killSwitch.activate(
      'RISK_ENGINE',
      'GLOBAL_KILL_SWITCH_ACTIVE=true on startup: Live fund protection engaged. All automated bots paused.',
      0,
      false
    );

    // 4. Default regime placeholder until first real tick
    this.currentRegime = {
      regime: 'RANGE_BOUND_LOW_VOL',
      confidence: 0.85,
      atr: 420.0,
      rsi: 51.2,
      adx: 18.5,
      bbBandwidth: 2.1,
      orderBookImbalance: 0.05,
      trendDirection: 'NEUTRAL',
      recommendedGridSpacing: 0.45,
      suggestedAction: 'System running in strict LIVE-ONLY fail-closed posture. Release Kill Switch to activate live grid.',
      detectedAt: new Date().toISOString()
    };

    // 5. Connect real-time tick listener from Data Engine
    this.dataEngine.registerTickCallback((symbol, price, liveData) => {
      if (symbol === this.activeSymbol) {
        this.handleLiveTick(symbol, price, liveData);
      }
    });

    // 6. Background capital sync from real exchange account
    this.syncCapitalFromRealExchange();
    setInterval(() => {
      this.syncCapitalFromRealExchange().catch(() => {});
    }, 10000);
    // Autonomous AI audit loop: live state only; fail-closed and bounded parameter changes.
    setInterval(() => {
      if (this.autonomyLevel >= 2 && !this.GLOBAL_KILL_SWITCH_ACTIVE) {
        this.runAutonomousProfitOptimization().catch(() => {});
      }
    }, 60000);

    this.monitor.logAudit({
      category: 'SYSTEM_BOOT',
      action: 'GigPilot Modular Engine Architecture Booted',
      details: {
        mode: 'LIVE',
        failClosedPolicy: true,
        killSwitchActive: true,
        modulesCount: 10
      }
    });
  }

  public get capital(): CapitalAccounting {
    return this.profitAccounting.getCapital();
  }

  public async runAutonomousProfitOptimization(): Promise<any> {
    const failStatus = this.monitor.isSystemFailClosed();
    const decision = await this.autonomousProfitOptimizer.auditAndOptimize({
      capital: this.capital,
      grid: this.activeGrid,
      regime: this.currentRegime,
      research: this.research.getResearchItems(),
      champion: this.learningLoop.getChampionStrategy(),
      systemHealthy: !failStatus.failClosed && !this.GLOBAL_KILL_SWITCH_ACTIVE
    });

    if (decision.applied && this.activeGrid && this.autonomyLevel >= 2 && !this.GLOBAL_KILL_SWITCH_ACTIVE) {
      const liveData = this.dataEngine.getPairData(this.activeSymbol);
      if (liveData?.currentPrice) {
        await this.exchangeExec.cancelAllOrders(this.activeSymbol);
        const nextSpacing = decision.newGridSpacingPct || this.activeGrid.gridSpacingPct;
        const build = decision.strategyBuildId
          ? this.autonomousProfitOptimizer.getStrategyBuilds().find(b => b.id === decision.strategyBuildId)
          : undefined;
        const nextLevels = build?.status === 'BUILT' && build.parameters.gridLevels
          ? build.parameters.gridLevels
          : this.activeGrid.levelsCount;
        const gridRes = this.gridEngine.generateGrid({
          symbol: this.activeSymbol,
          currentPrice: liveData.currentPrice,
          totalAllocatedUsd: this.activeGrid.totalAllocatedUsd,
          levelsCount: nextLevels,
          spacingType: this.activeGrid.spacingType,
          volatilityAdjustment: true,
          trendProtection: true,
          regime: this.currentRegime,
          targetGridSpacingPct: nextSpacing
        });
        if (gridRes.grid) {
          this.activeGrid = gridRes.grid;
          this.placeGridOrdersInExchange(this.activeGrid, liveData.currentPrice);
          this.monitor.logAudit({
            category: 'AUTONOMOUS_OPTIMIZATION',
            operator: 'AUTONOMOUS_AGENT',
            action: `Applied AI-selected grid spacing change ${decision.previousGridSpacingPct}% -> ${nextSpacing}%`,
            details: { decisionId: decision.id, confidence: decision.confidence, objective: decision.objective },
            result: 'SUCCESS'
          });
        }
      }
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
          lockedInOrdersUsd: acct.lockedInOrdersUsd,
          recentTradesCount: acct.recentTrades?.length || 0
        });
      }
    } catch {
      // Handled gracefully
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
        this.exchangeExec.cancelAllOrders(symbol);

        const newGridRes = this.gridEngine.generateGrid({
          symbol,
          currentPrice,
          totalAllocatedUsd: this.activeGrid.totalAllocatedUsd,
          levelsCount: this.activeGrid.levelsCount,
          spacingType: this.activeGrid.spacingType,
          volatilityAdjustment: true,
          trendProtection: true,
          regime: this.currentRegime
        });

        if (newGridRes.grid) {
          this.activeGrid = newGridRes.grid;
          this.placeGridOrdersInExchange(this.activeGrid, currentPrice);

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

    for (const lvl of grid.activeLevels) {
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
        midPrice
      );

      if (validation.allowed) {
        this.exchangeExec.executeOrder({
          symbol: grid.symbol,
          side: lvl.side,
          type: 'GRID_LIMIT',
          price: lvl.price,
          amount: lvl.orderSize,
          isGridOrder: true,
          gridLevelId: lvl.id,
          strategyId: this.learningLoop.getChampionStrategy().id
        });
      }
    }
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

  public setActiveSymbol(symbol: string) {
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
        regime: this.currentRegime
      });

      if (gRes.grid) {
        this.activeGrid = gRes.grid;
        if (!this.GLOBAL_KILL_SWITCH_ACTIVE && this.autonomyLevel >= 2) {
          this.exchangeExec.cancelAllOrders(norm);
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
        regime: this.currentRegime
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
