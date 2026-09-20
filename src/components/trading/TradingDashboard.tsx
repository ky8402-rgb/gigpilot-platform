import React, { useState, useEffect, useCallback } from 'react';
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
  fetchAuditLogs
} from '../../services/tradingService';

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
  Cpu
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
  const [state, setState] = useState<MasterTradingState | null>(null);
  const [pairs, setPairs] = useState<Array<{ symbol: string; price: number; change24hPct: number }>>([]);
  const [pairDetails, setPairDetails] = useState<any>(null);
  const [strategies, setStrategies] = useState<{
    champion: StrategyVersion;
    challengers: StrategyVersion[];
    history: StrategyVersion[];
  } | null>(null);
  const [researchItems, setResearchItems] = useState<any[]>([]);
  const [profitSweepInfo, setProfitSweepInfo] = useState<any>(null);
  const [riskData, setRiskData] = useState<any>(null);
  const [updatesHistory, setUpdatesHistory] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Load state from backend with graceful degradation
  const loadFullState = useCallback(async () => {
    try {
      // 1. Fetch Core System State first
      const masterState = await fetchTradingState();
      setState(masterState);
      setConnectionError(null);

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
      console.warn('[TradingDashboard] Sync notice:', err.message || err);
      if (!state) {
        setConnectionError(err.message || 'Connecting to trading engine...');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [state]);

  useEffect(() => {
    loadFullState();

    // 2.5s polling loop for high-density live telemetry
    const interval = setInterval(() => {
      loadFullState();
    }, 2500);

    return () => clearInterval(interval);
  }, [loadFullState]);

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-[#070B14] flex flex-col items-center justify-center text-slate-200 font-mono p-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center animate-pulse mb-4 shadow-xl shadow-emerald-500/20">
          <Cpu className="w-6 h-6 text-white" />
        </div>
        <div className="font-extrabold text-base tracking-wider text-white">AEGIS QUANT ENGINE</div>
        <div className="text-xs text-slate-400 mt-1">Booting Autonomous Grid Trading Platform...</div>

        {connectionError && (
          <div className="mt-4 p-4 rounded-xl bg-slate-900 border border-slate-700 text-center max-w-md shadow-2xl">
            <div className="text-amber-400 text-xs font-bold mb-1">Engine Initializing</div>
            <div className="text-slate-400 text-[11px] mb-3">{connectionError}</div>
            <button
              onClick={() => {
                setLoading(true);
                loadFullState();
              }}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg"
            >
              Retry Connection Now
            </button>
          </div>
        )}
      </div>
    );
  }

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
        onTriggerKillSwitch={async (reason) => {
          await triggerKillSwitch(reason);
          loadFullState();
        }}
        onDeactivateKillSwitch={async () => {
          await deactivateKillSwitch();
          loadFullState();
        }}
        marketRegime={state.currentRegime}
      />

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
