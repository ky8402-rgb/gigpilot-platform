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
  public autonomyLevel: AutonomyLevel = 1; // Default LEVEL 1 (PAPER TRADING)
  public tradingMode: TradingMode = 'PAPER';
  public currentRegime: MarketRegime;
  public activeGrid: GridConfiguration | null = null;
  public capital: CapitalAccounting;
  public auditLogs: AuditLog[] = [];
  public ownerAuthenticated: boolean = true; // Authorized single-user owner

  constructor() {
    this.exchange = new ExchangeEngine();
    this.risk = new RiskEngine();
    this.killSwitch = new EmergencyKillSwitch();
    this.sweeper = new ProfitSweepSubsystem();
    this.learningLoop = new LearningLoopEngine();
    this.research = new AutonomousResearchAgent();
    this.scripting = new ScriptingSandboxEngine();
    this.updater = new SelfUpdaterManager();

    // Initial Capital Accounting
    this.capital = {
      initialCapital: 10000.00,
      totalEquity: 12480.50,
      tradingCapital: 10000.00,
      availableCash: 7240.20,
      lockedInOrders: 2759.80,
      profitReserve: 300.00,
      eligibleRealizedProfit: 2180.50,
      withdrawableProfit: 1880.50,
      totalSweptProfit: 1500.00,
      netRealizedProfit: 2480.50,
      unrealizedProfit: 320.10,
      grossProfit: 2795.80,
      totalTradingFees: 215.30,
      totalSlippageCost: 35.20,
      totalFundingCosts: 64.80,
      totalWithdrawalCosts: 5.00,
      roiPct: 24.8,
      annualizedReturnPct: 58.4,
      sharpeRatio: 2.52,
      sortinoRatio: 3.28,
      maxDrawdownPct: 4.2,
      currentDrawdownPct: 1.1,
      winRatePct: 79.2,
      profitFactor: 2.34,
      totalTrades: 214,
      winningTrades: 169,
      losingTrades: 45
    };

    // Calculate initial regime
    const btcState = this.exchange.getPairState(this.activeSymbol);
    this.currentRegime = detectMarketRegime(
      btcState?.candles || [], 
      btcState?.orderBook
    );

    // Initialize initial adaptive grid
    if (btcState) {
      this.activeGrid = generateAdaptiveGrid({
        symbol: this.activeSymbol,
        currentPrice: btcState.currentPrice,
        totalAllocatedUsd: 3500,
        levelsCount: 20,
        spacingType: 'GEOMETRIC',
        volatilityAdjustment: true,
        trendProtection: true,
        regime: this.currentRegime
      });

      // Place initial grid limit orders in exchange engine
      this.placeGridOrdersInExchange(this.activeGrid);
    }

    this.logAudit(
      'AUTONOMOUS_AGENT',
      'SYSTEM_INITIALIZED',
      {
        mode: this.tradingMode,
        autonomyLevel: this.autonomyLevel,
        pair: this.activeSymbol,
        initialCapital: this.capital.initialCapital,
        championStrategy: this.learningLoop.getChampion().id
      },
      'SUCCESS'
    );

    // Hook exchange tick event for regime updates and autonomous rebalancing
    this.exchange.registerTickCallback((symbol, price) => {
      if (symbol === this.activeSymbol) {
        this.handlePriceTick(price);
      }
    });
  }

  private placeGridOrdersInExchange(grid: GridConfiguration) {
    if (this.killSwitch.getState().isActive) return;

    for (const lvl of grid.activeLevels) {
      // Validate with risk engine first
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
    if (this.killSwitch.getState().isActive) return;

    const btcState = this.exchange.getPairState(this.activeSymbol);
    if (!btcState) return;

    // Recalculate regime every minute
    this.currentRegime = detectMarketRegime(btcState.candles, btcState.orderBook);

    // Check if grid needs dynamic rebalance
    if (this.activeGrid && (this.autonomyLevel >= 1)) {
      const check = checkRebalanceNeeded(currentPrice, this.activeGrid);
      if (check.needed) {
        // Cancel stale grid orders
        this.exchange.cancelAllOrders(this.activeSymbol);

        // Regenerate grid with updated volatility & regime bounds
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

    // Update real-time capital accounting
    const positions = this.exchange.getPositions();
    const activePos = positions.find(p => p.symbol === this.activeSymbol);
    if (activePos) {
      this.capital.unrealizedProfit = activePos.unrealizedPnL;
      this.capital.totalEquity = Number((this.capital.initialCapital + this.capital.netRealizedProfit + this.capital.unrealizedProfit).toFixed(2));
      this.capital.roiPct = Number(((this.capital.totalEquity - this.capital.initialCapital) / this.capital.initialCapital * 100).toFixed(2));
    }
  }

  public setAutonomyLevel(level: AutonomyLevel) {
    const prev = this.autonomyLevel;
    this.autonomyLevel = level;
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
    if (pairState) {
      this.currentRegime = detectMarketRegime(pairState.candles, pairState.orderBook);
      this.activeGrid = generateAdaptiveGrid({
        symbol,
        currentPrice: pairState.currentPrice,
        totalAllocatedUsd: 3500,
        levelsCount: 20,
        spacingType: 'GEOMETRIC',
        volatilityAdjustment: true,
        trendProtection: true,
        regime: this.currentRegime
      });
      this.exchange.cancelAllOrders();
      this.placeGridOrdersInExchange(this.activeGrid);
    }
  }

  public triggerEmergencyKillSwitch(reason = 'Manual operator emergency shutdown'): void {
    const cancelledCount = this.exchange.cancelAllOrders();
    this.killSwitch.activate('OWNER', reason, cancelledCount, false);
    this.logAudit(
      'OWNER',
      'GLOBAL_KILL_SWITCH_ENGAGED',
      { reason, cancelledOrdersCount: cancelledCount },
      'SUCCESS'
    );
  }

  public deactivateKillSwitch(): void {
    this.killSwitch.deactivate();
    this.logAudit('OWNER', 'GLOBAL_KILL_SWITCH_DEACTIVATED', {}, 'SUCCESS');
    
    // Re-seed grid
    if (this.activeGrid) {
      this.placeGridOrdersInExchange(this.activeGrid);
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
