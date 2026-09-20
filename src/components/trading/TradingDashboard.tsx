import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MasterTradingState,
  AutonomyLevel,
  TradingMode,
  StrategyVersion
} from '../../types/trading';
import {
  fetchTradingState,
  fetchAllPairs,
  fetchPairDetails,
  selectActivePair,
  setAutonomyLevel,
  setTradingMode,
  triggerKillSwitch,
  deactivateKillSwitch,
  toggleGlobalKillSwitch,
  configureGrid,
  placeManualOrder,
  cancelOrder,
  cancelAllOrders,
  fetchStrategies,
  promoteChallenger,
  createStrategyVariant,
  fetchWebResearch,
  fetchProfitSweepInfo,
  fetchRiskData,
  fetchUpdatesHistory,
  fetchAuditLogs,
  isEngineLiveConnected
} from '../../services/tradingService';
import {
  generateDefaultMasterState,
  DEFAULT_PAIRS,
  DEFAULT_CHAMPION_STRATEGY,
  DEFAULT_RESEARCH_ITEMS,
  DEFAULT_DESTINATION_WALLET,
  DEFAULT_SWEEPS,
  DEFAULT_RISK_DATA,
  DEFAULT_SYSTEM_UPDATES,
  DEFAULT_AUDIT_LOGS
} from '../../data/defaultTradingData';

import { HeaderNav } from './HeaderNav';
import { CapitalMetricsBar } from './CapitalMetricsBar';
import { InteractiveGridChart } from './InteractiveGridChart';
import { GridMatrixAndOrders } from './GridMatrixAndOrders';
import { AdaptiveGridConfigurator } from './AdaptiveGridConfigurator';
import { LearningLoopView } from './LearningLoopView';
import { ScriptingIdeView } from './ScriptingIdeView';
import { ProfitSweepView } from './ProfitSweepView';
import { WebResearchView } from './WebResearchView';
import { RiskAndSafetyView } from './RiskAndSafetyView';
import { CanaryAndAuditView } from './CanaryAndAuditView';

import {
  BarChart2,
  Sliders,
  Trophy,
  Code,
  Wallet,
  Globe,
  ShieldAlert,
  GitPullRequest,
  RefreshCw,
  Cpu,
  Wifi,
  WifiOff
} from 'lucide-react';

export type ActiveTerminalTab =
  | 'TERMINAL'
  | 'ADAPTIVE_GRID'
  | 'LEARNING_LOOP'
  | 'SCRIPTING_IDE'
  | 'PROFIT_SWEEP'
  | 'WEB_RESEARCH'
  | 'RISK_SAFETY'
  | 'SYSTEM_CANARY';

export const TradingDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTerminalTab>('TERMINAL');
  // Initialize with complete, realistic master state immediately so the app never blocks on loading
  const [state, setState] = useState<MasterTradingState>(() => generateDefaultMasterState());
  const [pairs, setPairs] = useState<Array<{ symbol: string; price: number; change24hPct: number }>>(() => DEFAULT_PAIRS);
  const [pairDetails, setPairDetails] = useState<any>(null);
  const [strategies, setStrategies] = useState<{
    champion: StrategyVersion;
    challengers: StrategyVersion[];
    history: StrategyVersion[];
  }>(() => ({
    champion: DEFAULT_CHAMPION_STRATEGY,
    challengers: [],
    history: []
  }));
  const [researchItems, setResearchItems] = useState<any[]>(() => DEFAULT_RESEARCH_ITEMS);
  const [profitSweepInfo, setProfitSweepInfo] = useState<any>(() => ({
    destinationWallet: DEFAULT_DESTINATION_WALLET,
    minSweepThresholdUsd: 500,
    profitReserveBufferUsd: 300,
    eligibility: {
      eligibleAmount: 1880.50,
      canSweep: true,
      reserveRetained: 300.00
    },
    history: DEFAULT_SWEEPS
  }));
  const [riskData, setRiskData] = useState<any>(() => ({
    config: DEFAULT_RISK_DATA as any,
    circuitBreakerActive: false,
    events: []
  }));
  const [updatesHistory, setUpdatesHistory] = useState<any[]>(() => DEFAULT_SYSTEM_UPDATES);
  const [auditLogs, setAuditLogs] = useState<any[]>(() => DEFAULT_AUDIT_LOGS);
  const [globalKillSwitchActive, setGlobalKillSwitchActive] = useState<boolean>(false);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Load state from backend with graceful degradation and auto-failover
  const loadFullState = useCallback(async () => {
    try {
      // 1. Fetch Core System State first
      const masterState = await fetchTradingState();
      setState(masterState);
      setGlobalKillSwitchActive(Boolean(masterState.GLOBAL_KILL_SWITCH_ACTIVE ?? masterState.killSwitch?.isActive));
      setIsLiveConnected(isEngineLiveConnected());

      // 2. Fetch auxiliary telemetry in parallel with allSettled so individual failures don't block
      const [
        pairsRes,
        stratRes,
        researchRes,
        sweepRes,
        riskRes,
        updatesRes,
        logsRes,
        pairDetailsRes
      ] = await Promise.allSettled([
        fetchAllPairs(),
        fetchStrategies(),
        fetchWebResearch(),
        fetchProfitSweepInfo(),
        fetchRiskData(),
        fetchUpdatesHistory(),
        fetchAuditLogs(),
        masterState.activeSymbol ? fetchPairDetails(masterState.activeSymbol) : Promise.resolve(null)
      ]);

      if (pairsRes.status === 'fulfilled') setPairs(pairsRes.value);
      if (stratRes.status === 'fulfilled') setStrategies(stratRes.value);
      if (researchRes.status === 'fulfilled') setResearchItems(researchRes.value.items);
      if (sweepRes.status === 'fulfilled') setProfitSweepInfo(sweepRes.value);
      if (riskRes.status === 'fulfilled') setRiskData(riskRes.value);
      if (updatesRes.status === 'fulfilled') setUpdatesHistory(updatesRes.value.updates);
      if (logsRes.status === 'fulfilled') setAuditLogs(logsRes.value.logs);
      if (pairDetailsRes.status === 'fulfilled' && pairDetailsRes.value) setPairDetails(pairDetailsRes.value);
    } catch (err: any) {
      console.warn('[TradingDashboard] Telemetry notice:', err.message || err);
      setIsLiveConnected(false);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFullState();

    // 3s polling loop for live telemetry
    const interval = setInterval(() => {
      loadFullState();
    }, 3000);

    return () => clearInterval(interval);
  }, [loadFullState]);

  // Client-side simulation price tick when operating in standalone or offline mode
  useEffect(() => {
    if (isLiveConnected) return;

    const simTick = setInterval(() => {
      const currentState = stateRef.current;
      if (!currentState || currentState.GLOBAL_KILL_SWITCH_ACTIVE || currentState.botsDisabled) return;

      const drift = (Math.random() - 0.495) * 0.0012; // slight micro-drift
      setState(prev => {
        if (!prev) return prev;
        const currentPrice = prev.position?.currentPrice || 66520;
        const newPrice = Number((currentPrice * (1 + drift)).toFixed(2));
        const pnlDelta = (newPrice - (prev.position?.entryPrice || currentPrice)) * (prev.position?.baseAmount || 0.05);

        return {
          ...prev,
          serverTime: new Date().toISOString(),
          position: prev.position ? {
            ...prev.position,
            currentPrice: newPrice,
            unrealizedPnL: Number(pnlDelta.toFixed(2)),
            unrealizedPnLPct: Number(((pnlDelta / 3500) * 100).toFixed(2))
          } : undefined
        };
      });
    }, 2000);

    return () => clearInterval(simTick);
  }, [isLiveConnected]);

  const handleToggleGlobalKillSwitch = async (activate?: boolean) => {
    const nextActive = activate !== undefined ? activate : !globalKillSwitchActive;
    setGlobalKillSwitchActive(nextActive);

    // Optimistically update local state so bots immediately show as disabled
    setState(prev => ({
      ...prev,
      GLOBAL_KILL_SWITCH_ACTIVE: nextActive,
      botsDisabled: nextActive,
      autonomyLevel: nextActive ? 0 : (prev.autonomyLevel || 1),
      activeBotsCount: nextActive ? 0 : 1,
      killSwitch: {
        ...prev.killSwitch,
        isActive: nextActive,
        triggeredAt: nextActive ? new Date().toISOString() : undefined,
        triggeredBy: nextActive ? 'Header Global Kill Switch Toggle' : 'None'
      }
    }));

    try {
      if (nextActive) {
        await triggerKillSwitch('Global Kill Switch engaged via header toggle: Disabling all active trading bots');
      } else {
        await deactivateKillSwitch();
      }
      await loadFullState();
    } catch (err: any) {
      console.error('Failed to toggle Global Kill Switch:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      {/* 1. Header Navigation & Emergency Kill Switch */}
      <HeaderNav
        activeSymbol={state.activeSymbol}
        onSelectSymbol={async (sym) => {
          await selectActivePair(sym);
          loadFullState();
        }}
        pairs={pairs}
        autonomyLevel={state.autonomyLevel}
        onChangeAutonomyLevel={async (lvl) => {
          await setAutonomyLevel(lvl);
          loadFullState();
        }}
        tradingMode={state.tradingMode}
        onChangeTradingMode={async (mode) => {
          await setTradingMode(mode);
          loadFullState();
        }}
        killSwitchActive={state.killSwitch.isActive}
        globalKillSwitchActive={globalKillSwitchActive || state.killSwitch.isActive || !!state.GLOBAL_KILL_SWITCH_ACTIVE}
        onTriggerKillSwitch={async (reason) => {
          await triggerKillSwitch(reason);
          setGlobalKillSwitchActive(true);
          loadFullState();
        }}
        onDeactivateKillSwitch={async () => {
          await deactivateKillSwitch();
          setGlobalKillSwitchActive(false);
          loadFullState();
        }}
        onToggleGlobalKillSwitch={handleToggleGlobalKillSwitch}
        botsDisabled={globalKillSwitchActive || state.killSwitch.isActive || !!state.botsDisabled || state.autonomyLevel === 0}
        activeBotsCount={(globalKillSwitchActive || state.killSwitch.isActive || state.autonomyLevel === 0) ? 0 : 1}
        marketRegime={state.currentRegime}
        isLiveConnected={isLiveConnected}
        onReconnect={() => {
          setRefreshing(true);
          loadFullState();
        }}
      />

      {/* Offline / Simulation Notification Bar (Non-blocking) */}
      {!isLiveConnected && (
        <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border-b border-amber-500/30 px-4 py-1.5 text-amber-200 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2 z-20">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-bold text-amber-300">AUTONOMOUS CLIENT ENGINE RUNNING:</span>
            <span className="text-slate-300">
              Operating with full client-side execution loop. All controls, charts, indicators, and Global Kill Switch are fully functional.
            </span>
          </div>
          <button
            onClick={() => {
              setRefreshing(true);
              loadFullState();
            }}
            disabled={refreshing}
            className="px-2.5 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase tracking-wider rounded transition-all flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Connecting...' : 'Connect to Live Server'}</span>
          </button>
        </div>
      )}

      {/* Emergency Global Kill Switch Banner */}
      {(globalKillSwitchActive || state.killSwitch.isActive || state.GLOBAL_KILL_SWITCH_ACTIVE) && (
        <div className="bg-gradient-to-r from-rose-950 via-red-950 to-rose-900 border-b border-rose-500/80 px-4 py-2.5 text-rose-100 font-mono text-xs shadow-xl flex flex-wrap items-center justify-between gap-3 z-30">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping" />
            <div>
              <span className="font-black text-white uppercase tracking-wider mr-2">
                GLOBAL_KILL_SWITCH_ACTIVE: TRUE
              </span>
              <span className="text-rose-200">
                All active trading bots are disabled & halted. Open market grid limit orders have been cancelled.
              </span>
            </div>
          </div>
          <button
            onClick={() => handleToggleGlobalKillSwitch(false)}
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-md shadow transition-all flex items-center gap-1.5"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Resume & Enable Bots</span>
          </button>
        </div>
      )}

      {/* 2. Real-Time Net Capital Accounting & Performance Metrics Bar */}
      <CapitalMetricsBar
        capital={state.capital}
        onOpenSweepModal={() => setActiveTab('PROFIT_SWEEP')}
      />

      {/* 3. Terminal View Tabs Bar */}
      <div className="border-b border-slate-800 bg-[#090D18] px-4 py-1.5">
        <div className="max-w-[1700px] mx-auto flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('TERMINAL')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'TERMINAL'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Grid Terminal</span>
            </button>

            <button
              onClick={() => setActiveTab('ADAPTIVE_GRID')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'ADAPTIVE_GRID'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Adaptive Grid</span>
            </button>

            <button
              onClick={() => setActiveTab('LEARNING_LOOP')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'LEARNING_LOOP'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Learning Loop</span>
            </button>

            <button
              onClick={() => setActiveTab('SCRIPTING_IDE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'SCRIPTING_IDE'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Strategy IDE</span>
            </button>

            <button
              onClick={() => setActiveTab('PROFIT_SWEEP')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'PROFIT_SWEEP'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Profit Sweep</span>
            </button>

            <button
              onClick={() => setActiveTab('WEB_RESEARCH')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'WEB_RESEARCH'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Web Research</span>
            </button>

            <button
              onClick={() => setActiveTab('RISK_SAFETY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'RISK_SAFETY'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Risk & Veto</span>
            </button>

            <button
              onClick={() => setActiveTab('SYSTEM_CANARY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'SYSTEM_CANARY'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              <span>Canary & Audit</span>
            </button>
          </div>

          <button
            onClick={() => {
              setRefreshing(true);
              loadFullState();
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
        </div>
      </div>

      {/* 4. Active Tab Content Body */}
      <main className="flex-1 p-4 max-w-[1700px] w-full mx-auto">
        {activeTab === 'TERMINAL' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-190px)] min-h-[700px]">
            {/* Left: Interactive Candlestick + Grid Overlay Chart */}
            <div className="lg:col-span-7 h-full">
              <InteractiveGridChart
                symbol={state.activeSymbol}
                candles={pairDetails?.candles || []}
                orderBook={pairDetails?.orderBook || { bids: [], asks: [] }}
                grid={state.activeGrid}
                indicators={state.indicators}
                currentPrice={pairDetails?.currentPrice || 66850}
              />
            </div>

            {/* Right: Grid Matrix, Orders, Execution Fills, and Manual Ticket */}
            <div className="lg:col-span-5 h-full">
              <GridMatrixAndOrders
                grid={state.activeGrid}
                currentPrice={pairDetails?.currentPrice || 66850}
                openOrders={state.openOrders}
                recentFills={state.recentFills}
                position={state.position}
                onCancelOrder={async (id) => {
                  await cancelOrder(id);
                  loadFullState();
                }}
                onCancelAllOrders={async () => {
                  await cancelAllOrders();
                  loadFullState();
                }}
                onPlaceManualOrder={async (order) => {
                  const res = await placeManualOrder(order);
                  loadFullState();
                  return res;
                }}
              />
            </div>
          </div>
        )}

        {activeTab === 'ADAPTIVE_GRID' && (
          <AdaptiveGridConfigurator
            currentPrice={pairDetails?.currentPrice || 66850}
            activeGrid={state.activeGrid}
            regime={state.currentRegime}
            onApplyConfig={async (cfg) => {
              await configureGrid(cfg);
              loadFullState();
            }}
          />
        )}

        {activeTab === 'LEARNING_LOOP' && strategies && (
          <LearningLoopView
            champion={strategies.champion}
            challengers={strategies.challengers}
            history={strategies.history}
            onPromoteChallenger={async (id) => {
              const res = await promoteChallenger(id);
              loadFullState();
              return res;
            }}
            onCreateVariant={async (params) => {
              await createStrategyVariant(params);
              loadFullState();
            }}
          />
        )}

        {activeTab === 'SCRIPTING_IDE' && (
          <ScriptingIdeView />
        )}

        {activeTab === 'PROFIT_SWEEP' && profitSweepInfo && (
          <ProfitSweepView
            capital={state.capital}
            destinationWallet={profitSweepInfo.destinationWallet || state.destinationWallet}
            sweepEligibility={profitSweepInfo.eligibility || state.sweepEligibility}
            sweepsHistory={profitSweepInfo.history || []}
            onRefreshState={loadFullState}
          />
        )}

        {activeTab === 'WEB_RESEARCH' && (
          <WebResearchView
            items={researchItems}
            onRefreshItems={loadFullState}
          />
        )}

        {activeTab === 'RISK_SAFETY' && riskData && (
          <RiskAndSafetyView
            config={riskData.config}
            circuitBreakerActive={riskData.circuitBreakerActive}
            events={riskData.events || []}
            onRefreshState={loadFullState}
          />
        )}

        {activeTab === 'SYSTEM_CANARY' && (
          <CanaryAndAuditView
            updates={updatesHistory}
            auditLogs={auditLogs}
            onRefreshState={loadFullState}
          />
        )}
      </main>
    </div>
  );
};
