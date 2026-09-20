import {
  AuditLog,
  AutonomyLevel,
  CapitalAccounting,
  GridConfiguration,
  MarketRegime,
  TradingMode
} from './types.js';
import { ExchangeEngine } from './exchangeEngine.js';
import { RiskEngine } from './riskEngine.js';
import { EmergencyKillSwitch } from './killSwitch.js';
import { ProfitSweepSubsystem } from './profitSweep.js';
import { LearningLoopEngine } from './learningLoop.js';
import { AutonomousResearchAgent } from './researchAgent.js';
import { ScriptingSandboxEngine } from './scriptingEngine.js';
import { SelfUpdaterManager } from './selfUpdater.js';
import { detectMarketRegime } from './marketRegime.js';
import { generateAdaptiveGrid, checkRebalanceNeeded } from './adaptiveGridEngine.js';
import { binanceAdapter } from './binanceAdapter.js';

export class TradingStore {
  public exchange: ExchangeEngine;
  public risk: RiskEngine;
  public killSwitch: EmergencyKillSwitch;
  public sweeper: ProfitSweepSubsystem;
  public learningLoop: LearningLoopEngine;
  public research: AutonomousResearchAgent;
  public scripting: ScriptingSandboxEngine;
  public updater: SelfUpdaterManager;

  public activeSymbol: string = 'BTC/USDT';
  public autonomyLevel: AutonomyLevel = 0; // Default LEVEL 0 (SAFETY: Observe only, zero orders)
  public previousAutonomyLevel: AutonomyLevel = 1;
  public GLOBAL_KILL_SWITCH_ACTIVE: boolean = true; // DEFAULT SAFE KILL SWITCH ENGAGED
  public activeBotsDisabled: boolean = true;
  public tradingMode: TradingMode = 'LIVE'; // Real live trading on personal Binance account
  public currentRegime: MarketRegime;
  public activeGrid: GridConfiguration | null = null;
  public capital: CapitalAccounting;
  public auditLogs: AuditLog[] = [];
  public ownerAuthenticated: boolean = false;

  constructor() {
    this.exchange = new ExchangeEngine();
    this.risk = new RiskEngine();
    this.killSwitch = new EmergencyKillSwitch();
    this.sweeper = new ProfitSweepSubsystem();
    this.learningLoop = new LearningLoopEngine();
    this.research = new AutonomousResearchAgent();
    this.scripting = new ScriptingSandboxEngine();
    this.updater = new SelfUpdaterManager();

    // Kill switch initialized to ACTIVE per user requirement
    this.killSwitch.activate(
      'RISK_ENGINE',
      'GLOBAL_KILL_SWITCH_ACTIVE=true on startup: Live real fund protection engaged. All automated bots paused.',
      0,
      false
    );

    // Initial Capital Accounting (All values derived from real exchange)
    this.capital = {
      initialCapital: 0.0,
      totalEquity: 0.0,
      tradingCapital: 0.0,
      availableCash: 0.0,
      lockedInOrders: 0.0,
      profitReserve: 0.0,
      eligibleRealizedProfit: 0.0,
      withdrawableProfit: 0.0,
      totalSweptProfit: 0.0,
      netRealizedProfit: 0.0,
      unrealizedProfit: 0.0,
      grossProfit: 0.0,
      totalTradingFees: 0.0,
      totalSlippageCost: 0.0,
      totalFundingCosts: 0.0,
      totalWithdrawalCosts: 0.0,
      roiPct: 0.0,
      annualizedReturnPct: 0.0,
      sharpeRatio: 0.0,
      sortinoRatio: 0.0,
      maxDrawdownPct: 0.0,
      currentDrawdownPct: 0.0,
      winRatePct: 0.0,
      profitFactor: 0.0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0
    };

    // Initialize initial default regime
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
      suggestedAction: 'Awaiting operator release of GLOBAL_KILL_SWITCH to initiate live grid allocation.',
      detectedAt: new Date().toISOString()
    };

    this.logAudit(
      'AUTONOMOUS_AGENT',
      'SYSTEM_INITIALIZED',
      {
        mode: this.tradingMode,
        autonomyLevel: this.autonomyLevel,
        GLOBAL_KILL_SWITCH_ACTIVE: this.GLOBAL_KILL_SWITCH_ACTIVE,
        activeBotsDisabled: this.activeBotsDisabled,
        exchange: 'BINANCE_SPOT',
        note: 'Live Binance Spot architecture loaded with zero simulation.'
      },
      'SUCCESS'
    );

    // Sync real Binance account capital
    this.syncCapitalFromBinance();

    // Hook exchange tick event for regime updates and autonomous rebalancing
    this.exchange.registerTickCallback((symbol, price) => {
      if (symbol === this.activeSymbol) {
        this.handlePriceTick(price);
      }
    });

    // Periodic capital sync from Binance (every 10 seconds)
    setInterval(() => {
      this.syncCapitalFromBinance().catch(() => {});
    }, 10000);
  }

  public async syncCapitalFromBinance(): Promise<void> {
    try {
      const acct = await binanceAdapter.getRealAccountState();
      if (acct.status === 'CONNECTED') {
        this.capital.totalEquity = acct.totalEquityUsd;
        this.capital.availableCash = acct.availableCashUsd;
        this.capital.lockedInOrders = acct.lockedInOrdersUsd;
        this.capital.tradingCapital = acct.totalEquityUsd;
        if (this.capital.initialCapital === 0 && acct.totalEquityUsd > 0) {
          this.capital.initialCapital = acct.totalEquityUsd;
        }

        // Update real trades count
        if (acct.recentTrades && acct.recentTrades.length > 0) {
          this.capital.totalTrades = acct.recentTrades.length;
        }
      }
    } catch (e) {
      // Handled gracefully in adapter
    }
  }

  private placeGridOrdersInExchange(grid: GridConfiguration) {
    if (this.GLOBAL_KILL_SWITCH_ACTIVE || this.killSwitch.getState().isActive) return;
    if (this.autonomyLevel < 2) return; // Only place in exchange if authorized

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
        this.exchange.getPositions(),
        this.exchange.getOpenOrders().length
      );

      if (validation.allowed) {
        this.exchange.placeOrder({
          symbol: grid.symbol,
          side: lvl.side,
          type: 'GRID_LIMIT',
          price: lvl.price,
          amount: lvl.orderSize,
          isGridOrder: true,
          gridLevelId: lvl.id,
          strategyId: this.learningLoop.getChampion().id
        });
      }
    }
  }

  private handlePriceTick(currentPrice: number) {
    const pairState = this.exchange.getPairState(this.activeSymbol);
    if (!pairState || pairState.candles.length === 0) return;

    // Recalculate regime from real Binance candles & depth
    this.currentRegime = detectMarketRegime(pairState.candles, pairState.orderBook);

    // If active grid exists and bots enabled
    if (!this.GLOBAL_KILL_SWITCH_ACTIVE && this.activeGrid && this.autonomyLevel >= 2) {
      const check = checkRebalanceNeeded(currentPrice, this.activeGrid);
      if (check.needed) {
        this.exchange.cancelAllOrders(this.activeSymbol);

        this.activeGrid = generateAdaptiveGrid({
          symbol: this.activeSymbol,
          currentPrice,
          totalAllocatedUsd: this.activeGrid.totalAllocatedUsd,
          levelsCount: this.activeGrid.levelsCount,
          spacingType: this.activeGrid.spacingType,
          volatilityAdjustment: true,
          trendProtection: true,
          regime: this.currentRegime
        });

        this.placeGridOrdersInExchange(this.activeGrid);

        this.logAudit(
          'AUTONOMOUS_AGENT',
          'GRID_AUTO_REBALANCED',
          {
            symbol: this.activeSymbol,
            price: currentPrice,
            reason: check.reason,
            newUpper: this.activeGrid.upperBoundary,
            newLower: this.activeGrid.lowerBoundary
          },
          'SUCCESS'
        );
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
    this.logAudit('OWNER', 'AUTONOMY_LEVEL_CHANGED', { previous: prev, newLevel: level }, 'SUCCESS');
  }

  public setTradingMode(mode: TradingMode) {
    const prev = this.tradingMode;
    this.tradingMode = mode;
    this.exchange.setMode(mode);
    this.logAudit('OWNER', 'TRADING_MODE_CHANGED', { previous: prev, newMode: mode }, 'SUCCESS');
  }

  public setActiveSymbol(symbol: string) {
    this.activeSymbol = symbol;
    const pairState = this.exchange.getPairState(symbol);
    if (pairState && pairState.currentPrice > 0) {
      this.currentRegime = detectMarketRegime(pairState.candles, pairState.orderBook);
      this.activeGrid = generateAdaptiveGrid({
        symbol,
        currentPrice: pairState.currentPrice,
        totalAllocatedUsd: Math.min(3500, this.capital.availableCash > 0 ? this.capital.availableCash * 0.5 : 1000),
        levelsCount: 16,
        spacingType: 'GEOMETRIC',
        volatilityAdjustment: true,
        trendProtection: true,
        regime: this.currentRegime
      });

      if (!this.GLOBAL_KILL_SWITCH_ACTIVE && this.autonomyLevel >= 2) {
        this.exchange.cancelAllOrders();
        this.placeGridOrdersInExchange(this.activeGrid);
      }
    }
  }

  public async triggerEmergencyKillSwitch(reason = 'Manual operator emergency shutdown: Disabling all active trading bots'): Promise<void> {
    this.GLOBAL_KILL_SWITCH_ACTIVE = true;
    this.activeBotsDisabled = true;
    this.previousAutonomyLevel = this.autonomyLevel;
    this.autonomyLevel = 0; // Disable all bots
    const cancelledCount = await this.exchange.cancelAllOrders();
    this.killSwitch.activate('OWNER', reason, cancelledCount, false);
    this.logAudit(
      'OWNER',
      'GLOBAL_KILL_SWITCH_ENGAGED',
      { reason, cancelledOrdersCount: cancelledCount, GLOBAL_KILL_SWITCH_ACTIVE: true, botsDisabled: true },
      'SUCCESS'
    );
  }

  public deactivateKillSwitch(): void {
    this.GLOBAL_KILL_SWITCH_ACTIVE = false;
    this.activeBotsDisabled = false;
    this.killSwitch.deactivate();
    this.autonomyLevel = this.previousAutonomyLevel > 0 ? this.previousAutonomyLevel : 1;
    this.logAudit('OWNER', 'GLOBAL_KILL_SWITCH_DEACTIVATED', { GLOBAL_KILL_SWITCH_ACTIVE: false, botsRestored: true }, 'SUCCESS');

    // Generate fresh adaptive grid with real live price
    const pairState = this.exchange.getPairState(this.activeSymbol);
    if (pairState && pairState.currentPrice > 0) {
      this.activeGrid = generateAdaptiveGrid({
        symbol: this.activeSymbol,
        currentPrice: pairState.currentPrice,
        totalAllocatedUsd: Math.min(3500, this.capital.availableCash > 0 ? this.capital.availableCash * 0.5 : 1000),
        levelsCount: 16,
        spacingType: 'GEOMETRIC',
        volatilityAdjustment: true,
        trendProtection: true,
        regime: this.currentRegime
      });

      if (this.autonomyLevel >= 2) {
        this.placeGridOrdersInExchange(this.activeGrid);
      }
    }
  }

  public logAudit(
    operator: AuditLog['operator'],
    action: string,
    details: Record<string, any>,
    result: AuditLog['result']
  ) {
    const log: AuditLog = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      operator,
      action,
      details,
      result
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 300) this.auditLogs.pop();
  }
}

// Global Singleton Instance
export const globalTradingStore = new TradingStore();
