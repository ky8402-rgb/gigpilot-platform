import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Bot,
  Terminal,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  ShieldCheck,
  Zap,
  ArrowDown,
  ArrowRight,
  RefreshCw,
  Copy,
  Check,
  Clock,
  History,
  Activity,
  Layers,
  Cpu,
  CornerDownRight,
  Undo2,
  X,
  ExternalLink,
  ChevronRight,
  Code2,
  Bug,
  MessageSquareCode,
  GitPullRequest,
  GitBranch,
  Search,
  Crosshair,
  CheckCheck
} from 'lucide-react';
import {
  PipelineSource,
  StructuredSpec,
  SandboxPatch,
  TestTelemetryResult,
  LiveUpdateResult,
  PipelineLog,
  PipelineExecutionRun,
  runOrchestratorPipeline,
  fetchOrchestratorPresets,
  fetchOrchestratorRuns,
  rollbackOrchestratorUpdate
} from '../services/api';

interface SelfUpdatingPipelineConsoleProps {
  onClose?: () => void;
  initialSource?: PipelineSource;
  initialContent?: string;
  onToast?: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SelfUpdatingPipelineConsole: React.FC<SelfUpdatingPipelineConsoleProps> = ({
  onClose,
  initialSource = 'user_chat',
  initialContent = '',
  onToast
}) => {
  // State: Trigger Mode
  const [source, setSource] = useState<PipelineSource>(initialSource);
  const [inputContent, setInputContent] = useState<string>(initialContent);
  const [simulateFailure, setSimulateFailure] = useState<boolean>(false);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  // State: Active Run & History
  const [currentRun, setCurrentRun] = useState<PipelineExecutionRun | null>(null);
  const [historyRuns, setHistoryRuns] = useState<PipelineExecutionRun[]>([]);
  const [presets, setPresets] = useState<{ userChat: any[]; aiopsErrorLogs: any[] }>({
    userChat: [],
    aiopsErrorLogs: []
  });

  // State: Active View & Focus Node
  const [activeTab, setActiveTab] = useState<'flow' | 'spec' | 'sandbox' | 'tests' | 'live' | 'logs'>('flow');
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [copiedSpec, setCopiedSpec] = useState<boolean>(false);
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);

  // Load Presets and History on Mount
  useEffect(() => {
    loadPresetsAndRuns();
  }, []);

  const loadPresetsAndRuns = async () => {
    const [presetsRes, runsRes] = await Promise.all([
      fetchOrchestratorPresets(),
      fetchOrchestratorRuns()
    ]);

    if (presetsRes?.presets) {
      setPresets(presetsRes.presets);
      if (!inputContent) {
        if (source === 'user_chat' && presetsRes.presets.userChat.length > 0) {
          setInputContent(presetsRes.presets.userChat[0].prompt);
        } else if (source === 'aiops_error_log' && presetsRes.presets.aiopsErrorLogs.length > 0) {
          setInputContent(presetsRes.presets.aiopsErrorLogs[0].prompt);
        }
      }
    }

    if (runsRes?.runs && runsRes.runs.length > 0) {
      setHistoryRuns(runsRes.runs);
      if (!currentRun) {
        setCurrentRun(runsRes.runs[0]);
      }
    }
  };

  // Switch source mode
  const handleSelectSource = (newSource: PipelineSource) => {
    setSource(newSource);
    if (newSource === 'user_chat' && presets.userChat.length > 0) {
      setInputContent(presets.userChat[0].prompt);
    } else if (newSource === 'aiops_error_log' && presets.aiopsErrorLogs.length > 0) {
      setInputContent(presets.aiopsErrorLogs[0].prompt);
    }
  };

  // Run full closed-loop pipeline
  const handleExecutePipeline = async () => {
    if (!inputContent.trim()) {
      onToast?.('Please enter a user prompt or AIOps error log to execute the pipeline.', 'warning');
      return;
    }

    setIsExecuting(true);
    onToast?.('🚀 Starting closed-loop Orchestrator & Self-Updating Pipeline...', 'info');

    try {
      const res = await runOrchestratorPipeline({
        source,
        content: inputContent,
        maxIterations: 3,
        simulateFailureOnFirstIteration: simulateFailure
      });

      if (res.run) {
        setCurrentRun(res.run);
        setHistoryRuns(prev => [res.run, ...prev.filter(r => r.id !== res.run.id)]);

        if (res.run.status === 'live_deployed') {
          onToast?.(
            `✅ Pipeline completed! Live App Update deployed (Version: ${res.run.liveUpdate?.versionHash}) across ${res.run.liveUpdate?.appliedFiles.length} file(s).`,
            'success'
          );
        } else {
          onToast?.(`⚠️ Pipeline run ended with status: ${res.run.status}`, 'warning');
        }
      } else {
        onToast?.(res.error || 'Failed to execute pipeline', 'error');
      }
    } catch (err: any) {
      onToast?.(err.message || 'Pipeline execution failed', 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  // Handle Rollback
  const handleRollback = async () => {
    if (!currentRun?.id) return;
    setIsRollingBack(true);
    try {
      const res = await rollbackOrchestratorUpdate(currentRun.id);
      if (res.success) {
        onToast?.(res.message, 'success');
        // Refresh run state
        setCurrentRun(prev => prev ? { ...prev, status: 'rolled_back' } : null);
        loadPresetsAndRuns();
      } else {
        onToast?.(res.message || 'Rollback failed', 'error');
      }
    } catch (err: any) {
      onToast?.(err.message || 'Rollback failed', 'error');
    } finally {
      setIsRollingBack(false);
    }
  };

  // Copy Spec JSON
  const handleCopySpec = () => {
    if (!currentRun?.spec) return;
    navigator.clipboard.writeText(JSON.stringify(currentRun.spec, null, 2));
    setCopiedSpec(true);
    setTimeout(() => setCopiedSpec(false), 2000);
    onToast?.('Structured Spec JSON copied to clipboard!', 'info');
  };

  // Determine stage active states for diagram visualization
  const getStageStatus = (stage: 'input' | 'prompt_1' | 'prompt_2' | 'tests' | 'live') => {
    if (isExecuting) {
      return 'active';
    }
    if (!currentRun) return 'idle';

    switch (stage) {
      case 'input':
        return 'completed';
      case 'prompt_1':
        return currentRun.spec ? 'completed' : 'idle';
      case 'prompt_2':
        return currentRun.patches.length > 0 ? 'completed' : 'idle';
      case 'tests':
        return currentRun.testResults.length > 0
          ? currentRun.testResults.some(t => t.passed) ? 'completed' : 'failed'
          : 'idle';
      case 'live':
        return currentRun.liveUpdate ? 'completed' : currentRun.status === 'failed' ? 'failed' : 'idle';
    }
  };

  const latestPatch = currentRun?.patches[currentRun.patches.length - 1];
  const latestTest = currentRun?.testResults[currentRun.testResults.length - 1];
  const hasRetryLoop = (currentRun?.currentIteration || 0) > 1;

  return (
    <div className="flex flex-col h-full bg-[#0a0d14] text-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0d121f] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                Autonomous Self-Updating &amp; Orchestrator Pipeline
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">
                CLOSED-LOOP ACTIVE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              [ User Chat / AIOps Error Log ] ➔ [ Prompt 1: Orchestrator ] ➔ [ Prompt 2: Self-Updating Engine ] ➔ [ Sandbox &amp; Tests ] ➔ [ Live App Updates ]
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
              title="Close Console"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Side: Dual-Trigger Input & Pipeline Controls (400px / 30%) */}
        <div className="w-full lg:w-[420px] shrink-0 border-r border-slate-800 bg-[#0c101a] flex flex-col overflow-y-auto p-5 space-y-5">
          
          {/* Input Source Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              1. Pipeline Trigger Input Source
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleSelectSource('user_chat')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  source === 'user_chat'
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-sm shadow-emerald-500/20'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <MessageSquareCode className="w-4 h-4 text-emerald-400" />
                <span>[ User Chat ]</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectSource('aiops_error_log')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  source === 'aiops_error_log'
                    ? 'bg-rose-500/15 border-rose-500 text-rose-300 shadow-sm shadow-rose-500/20'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Bug className="w-4 h-4 text-rose-400" />
                <span>[ AIOps Error Log ]</span>
              </button>
            </div>
          </div>

          {/* Quick Scenario Presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Quick Presets
              </label>
              <span className="text-[11px] text-slate-500 font-mono">1-click test</span>
            </div>
            <div className="space-y-1.5">
              {(source === 'user_chat' ? presets.userChat : presets.aiopsErrorLogs).map((p, idx) => (
                <button
                  key={p.id || idx}
                  onClick={() => setInputContent(p.prompt)}
                  className="w-full text-left p-2.5 rounded-lg bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 transition-all text-xs group cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300 group-hover:text-emerald-300 truncate">
                      {p.title}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5 font-mono">
                    {p.prompt}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Input Textarea */}
          <div className="flex-1 flex flex-col min-h-[140px]">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              {source === 'user_chat' ? 'User Instruction / Requirement' : 'Error Log / Stack Trace'}
            </label>
            <textarea
              value={inputContent}
              onChange={(e) => setInputContent(e.target.value)}
              placeholder={
                source === 'user_chat'
                  ? 'Describe feature, enhancement or fix to autonomously implement...'
                  : 'Paste AIOps runtime error stack trace, telemetry breach or log...'
              }
              rows={5}
              className="w-full flex-1 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 resize-none"
            />
          </div>

          {/* Test Failure Simulation Toggle (Demonstrates loopback to Prompt 2) */}
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={simulateFailure}
                onChange={(e) => setSimulateFailure(e.target.checked)}
                className="mt-0.5 rounded border-amber-500 text-amber-500 focus:ring-amber-500/30"
              />
              <div className="text-xs">
                <span className="font-bold text-amber-300">Simulate Test/Telemetry Failure</span>
                <p className="text-[11px] text-amber-400/80 mt-0.5">
                  Forces Iteration 1 to fail validation, visibly triggering the feedback loop: <span className="font-mono underline">Prompt 2 ➔ Sandbox ➔ Tests ➔ Loopback ➔ Live App Update</span>.
                </p>
              </div>
            </label>
          </div>

          {/* Run Button */}
          <button
            type="button"
            onClick={handleExecutePipeline}
            disabled={isExecuting || !inputContent.trim()}
            className={`w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer ${
              isExecuting
                ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/25 active:scale-[0.99]'
            }`}
          >
            {isExecuting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Executing Closed-Loop Pipeline...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current text-white" />
                <span>Run Autonomous Self-Updating Pipeline</span>
              </>
            )}
          </button>

          {/* Recent Runs History */}
          {historyRuns.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-slate-500" />
                  Past Pipeline Runs ({historyRuns.length})
                </span>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {historyRuns.slice(0, 5).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setCurrentRun(r)}
                    className={`w-full text-left p-2 rounded-lg text-xs border transition-all cursor-pointer ${
                      currentRun?.id === r.id
                        ? 'bg-slate-800/90 border-emerald-500/50 text-white'
                        : 'bg-slate-900/50 border-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-emerald-400 truncate font-semibold">
                        {r.id}
                      </span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                        r.status === 'live_deployed'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : r.status === 'rolled_back'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {r.status === 'live_deployed' ? 'DEPLOYED' : r.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {r.spec?.title || r.inputPrompt}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Right Side: Visual Flow Canvas & Detail Inspectors */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#090d16]">
          
          {/* Autonomous Loop Engineering Sequence Status Bar */}
          <div className="px-6 py-2 border-b border-slate-800/80 bg-[#070b14] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-mono text-[11px] font-bold tracking-wider uppercase text-emerald-400">
                Loop Engineering Sequence:
              </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 font-mono text-[10px] overflow-x-auto py-0.5">
              {/* Step 1: COMPREHEND */}
              <button
                onClick={() => setActiveTab('spec')}
                className={`px-2 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
                  currentRun?.loopStage === 'comprehend' || currentRun?.status === 'orchestrating'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 ring-1 ring-cyan-500/30 font-bold'
                    : currentRun?.comprehendResult || currentRun?.spec
                    ? 'bg-slate-800/60 text-slate-300 border border-slate-700/60'
                    : 'bg-slate-900 text-slate-500 border border-slate-800'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                <span>1. COMPREHEND</span>
              </button>

              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

              {/* Step 2: DRILL DOWN */}
              <button
                onClick={() => setActiveTab('spec')}
                className={`px-2 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
                  currentRun?.loopStage === 'drill_down'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 ring-1 ring-blue-500/30 font-bold'
                    : currentRun?.drillDownResult || currentRun?.spec?.drillDown
                    ? 'bg-slate-800/60 text-slate-300 border border-slate-700/60'
                    : 'bg-slate-900 text-slate-500 border border-slate-800'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span>2. DRILL DOWN</span>
              </button>

              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

              {/* Step 3: GENERATE FIX */}
              <button
                onClick={() => setActiveTab('sandbox')}
                className={`px-2 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
                  currentRun?.loopStage === 'generate_fix' || currentRun?.status === 'generating_code' || currentRun?.status === 'retrying_failure'
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 ring-1 ring-indigo-500/30 font-bold'
                    : currentRun?.patches && currentRun.patches.length > 0
                    ? 'bg-slate-800/60 text-slate-300 border border-slate-700/60'
                    : 'bg-slate-900 text-slate-500 border border-slate-800'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                <span>3. GENERATE FIX</span>
              </button>

              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

              {/* Step 4: SANDBOX EXECUTION */}
              <button
                onClick={() => setActiveTab('tests')}
                className={`px-2 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
                  currentRun?.loopStage === 'sandbox_execution' || currentRun?.status === 'running_tests' || currentRun?.status === 'sandbox_modified'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 ring-1 ring-purple-500/30 font-bold'
                    : currentRun?.testResults && currentRun.testResults.length > 0
                    ? 'bg-slate-800/60 text-slate-300 border border-slate-700/60'
                    : 'bg-slate-900 text-slate-500 border border-slate-800'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span>4. SANDBOX EXEC</span>
              </button>

              <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />

              {/* Step 5: EVALUATE & HEAL */}
              <button
                onClick={() => setActiveTab('live')}
                className={`px-2 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
                  currentRun?.loopStage === 'evaluate_and_heal' || currentRun?.loopStage === 'complete' || currentRun?.status === 'live_deployed'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 ring-1 ring-emerald-500/30 font-bold'
                    : 'bg-slate-900 text-slate-500 border border-slate-800'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${currentRun?.liveUpdate ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                <span>5. EVALUATE &amp; HEAL</span>
              </button>
            </div>
          </div>

          {/* Navigation Bar for Inspectors */}
          <div className="flex items-center justify-between px-6 py-2.5 border-b border-slate-800 bg-[#0d121f]/90 shrink-0 overflow-x-auto">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('flow')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'flow'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>Architecture Flow</span>
              </button>

              <button
                onClick={() => setActiveTab('spec')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'spec'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Code2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Prompt 1: Spec ({currentRun?.spec ? 'Ready' : '0'})</span>
              </button>

              <button
                onClick={() => setActiveTab('sandbox')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'sandbox'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <FileCode className="w-3.5 h-3.5 text-indigo-400" />
                <span>Prompt 2: Sandbox ({latestPatch?.files.length || 0})</span>
              </button>

              <button
                onClick={() => setActiveTab('tests')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'tests'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
                <span>Tests &amp; Telemetry ({latestTest?.unitTests.length || 0})</span>
                {hasRetryLoop && (
                  <span className="px-1.5 py-0.2 text-[9px] rounded-full bg-amber-500/30 text-amber-300 font-mono">
                    Loop {currentRun?.currentIteration}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('live')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'live'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>Live Updates ({currentRun?.liveUpdate ? 'Live' : 'Pending'})</span>
              </button>

              <button
                onClick={() => setActiveTab('logs')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'logs'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                <span>Pipeline Logs ({currentRun?.logs.length || 0})</span>
              </button>
            </div>

            {/* Current Run Meta */}
            {currentRun && (
              <div className="flex items-center gap-3 text-xs">
                <span className="font-mono text-slate-400">
                  Run ID: <strong className="text-slate-200">{currentRun.id}</strong>
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-400 font-mono">
                  {currentRun.durationMs ? `${currentRun.durationMs}ms` : 'In Progress'}
                </span>
                {currentRun.liveUpdate && (
                  <button
                    onClick={handleRollback}
                    disabled={isRollingBack || currentRun.status === 'rolled_back'}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Undo2 className="w-3 h-3" />
                    <span>{currentRun.status === 'rolled_back' ? 'Rolled Back' : 'Rollback Update'}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tab 1: Architecture Flow Canvas */}
          {activeTab === 'flow' && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-start space-y-6">
              
              {/* Architecture Diagram Interactive Canvas */}
              <div className="w-full max-w-4xl bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 relative backdrop-blur-sm shadow-xl">
                <div className="flex items-center justify-between mb-4 border-b border-slate-800/60 pb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Autonomous Pipeline Architecture Diagram
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Click any node to inspect artifacts</span>
                  </div>
                </div>

                {/* The Flow Diagram Nodes */}
                <div className="flex flex-col items-center space-y-4 py-2">
                  
                  {/* NODE 1: [ User Chat ] OR [ AIOps Error Log ] */}
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleSelectSource('user_chat')}
                      className={`px-5 py-3 rounded-xl border font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
                        source === 'user_chat'
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 ring-2 ring-emerald-500/30'
                          : 'bg-slate-800/60 border-slate-700 text-slate-400'
                      }`}
                    >
                      <MessageSquareCode className="w-4 h-4 text-emerald-400" />
                      <span>[ User Chat ]</span>
                    </button>

                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">OR</span>

                    <button
                      onClick={() => handleSelectSource('aiops_error_log')}
                      className={`px-5 py-3 rounded-xl border font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
                        source === 'aiops_error_log'
                          ? 'bg-rose-500/20 border-rose-500 text-rose-300 ring-2 ring-rose-500/30'
                          : 'bg-slate-800/60 border-slate-700 text-slate-400'
                      }`}
                    >
                      <Bug className="w-4 h-4 text-rose-400" />
                      <span>[ AIOps Error Log ]</span>
                    </button>
                  </div>

                  {/* Connecting Arrow */}
                  <div className="flex flex-col items-center text-slate-500 my-0">
                    <div className="w-0.5 h-6 bg-slate-700"></div>
                    <ArrowDown className="w-4 h-4 text-slate-500 -mt-1" />
                  </div>

                  {/* NODE 2: [ Prompt 1: Orchestrator ] (Creates Structured Specs) */}
                  <div className="flex flex-col items-center">
                    <button
                      onClick={() => setActiveTab('spec')}
                      className={`px-6 py-3.5 rounded-xl border text-left transition-all cursor-pointer shadow-md ${
                        currentRun?.spec
                          ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200 ring-2 ring-cyan-500/20'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-cyan-500/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-cyan-400" />
                        <span className="font-bold text-xs tracking-wide">
                          [ Prompt 1: Orchestrator ]
                        </span>
                        {currentRun?.spec && (
                          <span className="ml-2 px-1.5 py-0.2 text-[10px] font-mono bg-cyan-500/20 text-cyan-300 rounded">
                            Spec Generated
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-cyan-400/80 mt-1 font-mono">
                        Creates Structured Specs (Requirements, Target Files &amp; Tests)
                      </p>
                    </button>

                    {/* Arrow down with label */}
                    <div className="flex flex-col items-center text-slate-500 my-1">
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        (Creates Structured Specs)
                      </span>
                      <div className="w-0.5 h-5 bg-slate-700"></div>
                      <ArrowDown className="w-4 h-4 text-slate-500 -mt-1" />
                    </div>
                  </div>

                  {/* NODE 3 & 4: [ Prompt 2: Self-Updating Engine ] ──► [ Modifies Code in Sandbox ] */}
                  {/* with Feedback Loop from [ Runs App & Tests ] */}
                  <div className="w-full relative border border-slate-800/90 bg-slate-950/60 rounded-xl p-5 my-2">
                    
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                      {/* Prompt 2 Node */}
                      <button
                        onClick={() => setActiveTab('sandbox')}
                        className={`flex-1 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                          latestPatch
                            ? 'bg-indigo-950/40 border-indigo-500 text-indigo-200 ring-2 ring-indigo-500/20'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Cpu className="w-4 h-4 text-indigo-400" />
                          <span className="font-bold text-xs">
                            [ Prompt 2: Self-Updating Engine ]
                          </span>
                          {latestPatch && (
                            <span className="ml-auto px-1.5 py-0.2 text-[10px] font-mono bg-indigo-500/20 text-indigo-300 rounded">
                              Patch v{latestPatch.iteration}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-indigo-400/80 mt-1 font-mono">
                          Generates exact code patches &amp; architectural changes
                        </p>
                      </button>

                      {/* Horizontal Arrow */}
                      <div className="flex items-center gap-1 text-slate-500">
                        <div className="h-0.5 w-6 bg-slate-700"></div>
                        <ArrowRight className="w-4 h-4 text-slate-500 -ml-1" />
                      </div>

                      {/* Sandbox Node */}
                      <button
                        onClick={() => setActiveTab('sandbox')}
                        className={`flex-1 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                          latestPatch
                            ? 'bg-purple-950/40 border-purple-500 text-purple-200 ring-2 ring-purple-500/20'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <FileCode className="w-4 h-4 text-purple-400" />
                          <span className="font-bold text-xs">
                            [ Modifies Code in Sandbox ]
                          </span>
                        </div>
                        <p className="text-[11px] text-purple-400/80 mt-1 font-mono">
                          Isolated workspace sandbox ({latestPatch?.files.length || 0} files)
                        </p>
                      </button>
                    </div>

                    {/* Connecting down to Runs App & Tests */}
                    <div className="flex justify-end pr-16 my-2">
                      <div className="flex flex-col items-center">
                        <div className="w-0.5 h-6 bg-slate-700"></div>
                        <ArrowDown className="w-4 h-4 text-slate-500 -mt-1" />
                      </div>
                    </div>

                    {/* NODE 5: [ Runs App & Tests ] */}
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 mt-1">
                      
                      {/* Feedback Loopback Arrow (Left Side) */}
                      <div className="flex-1 flex items-center justify-start gap-2 pl-2">
                        <div className="px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[11px] font-mono flex items-center gap-1.5">
                          <RotateCcw className="w-3 h-3 text-amber-400 animate-spin" />
                          <span>(If Tests/Telemetry Fail) ➔ Feedback to Prompt 2</span>
                        </div>
                      </div>

                      {/* Runs App & Tests Node (Right Side) */}
                      <button
                        onClick={() => setActiveTab('tests')}
                        className={`flex-1 p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                          latestTest?.passed
                            ? 'bg-teal-950/40 border-teal-500 text-teal-200 ring-2 ring-teal-500/20'
                            : latestTest
                            ? 'bg-amber-950/40 border-amber-500 text-amber-200'
                            : 'bg-slate-900 border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-teal-400" />
                          <span className="font-bold text-xs">
                            [ Runs App &amp; Tests ]
                          </span>
                          {latestTest && (
                            <span className={`ml-auto px-1.5 py-0.2 text-[10px] font-mono rounded ${
                              latestTest.passed ? 'bg-teal-500/20 text-teal-300' : 'bg-amber-500/20 text-amber-300'
                            }`}>
                              {latestTest.passed ? 'PASSED' : 'FAILED (LOOP)'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-teal-400/80 mt-1 font-mono">
                          Syntax, unit tests &amp; simulated telemetry SLA check
                        </p>
                      </button>
                    </div>

                  </div>

                  {/* Connecting Arrow down from Runs App & Tests */}
                  <div className="flex flex-col items-center text-slate-500 my-1">
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                      (If Success)
                    </span>
                    <div className="w-0.5 h-5 bg-emerald-500/50"></div>
                    <ArrowDown className="w-4 h-4 text-emerald-400 -mt-1" />
                  </div>

                  {/* NODE 6: [ Live App Updates ] */}
                  <button
                    onClick={() => setActiveTab('live')}
                    className={`px-8 py-3.5 rounded-xl border text-left transition-all cursor-pointer shadow-lg ${
                      currentRun?.liveUpdate
                        ? 'bg-emerald-950/50 border-emerald-500 text-emerald-100 ring-2 ring-emerald-500/30'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-400" />
                      <span className="font-bold text-xs tracking-wide">
                        [ Live App Updates ]
                      </span>
                      {currentRun?.liveUpdate && (
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/40">
                          v{currentRun.liveUpdate.versionHash} LIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-emerald-400/80 mt-1 font-mono">
                      Atomic promotion to production, GitOps commit, and telemetry tracking
                    </p>
                  </button>

                </div>
              </div>

              {/* Summary of Current Pipeline Run */}
              {currentRun && (
                <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[11px] text-slate-500 uppercase font-mono">Status</span>
                    <div className="text-sm font-bold text-white mt-1 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${
                        currentRun.status === 'live_deployed' ? 'bg-emerald-400' : 'bg-amber-400'
                      }`} />
                      {currentRun.status === 'live_deployed' ? 'Deployed Live' : currentRun.status}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[11px] text-slate-500 uppercase font-mono">Target Files</span>
                    <div className="text-sm font-bold text-white mt-1 font-mono">
                      {currentRun.spec?.targetFiles.length || 0} file(s)
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[11px] text-slate-500 uppercase font-mono">Feedback Loops</span>
                    <div className="text-sm font-bold text-white mt-1 font-mono">
                      {currentRun.currentIteration} iteration(s)
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                    <span className="text-[11px] text-slate-500 uppercase font-mono">Live Version</span>
                    <div className="text-sm font-bold text-emerald-400 mt-1 font-mono">
                      {currentRun.liveUpdate?.versionHash || 'N/A'}
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* Tab 2: Prompt 1 - Structured Spec Inspector */}
          {activeTab === 'spec' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {currentRun?.spec ? (
                <div className="space-y-6 max-w-4xl mx-auto">
                  {/* Title Bar */}
                  <div className="flex items-start justify-between p-5 rounded-2xl bg-slate-900/80 border border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          {currentRun.spec.specId}
                        </span>
                        <span className={`px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                          currentRun.spec.severity === 'critical' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          SEVERITY: {currentRun.spec.severity.toUpperCase()}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-800 text-slate-300">
                          CATEGORY: {currentRun.spec.category.toUpperCase()}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mt-2">
                        {currentRun.spec.title}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {currentRun.spec.description}
                      </p>
                    </div>

                    <button
                      onClick={handleCopySpec}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedSpec ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedSpec ? 'Copied' : 'Copy Spec JSON'}</span>
                    </button>
                  </div>

                  {/* LOOP STAGE 1: COMPREHEND CARD */}
                  {currentRun.spec.comprehend && (
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-cyan-950/40 via-slate-900/80 to-slate-900 border border-cyan-500/30 shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Crosshair className="w-4 h-4 text-cyan-400" />
                          <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                            1. COMPREHEND — Fault Localization &amp; Stack Analysis
                          </h4>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] font-mono uppercase font-bold rounded ${
                          currentRun.spec.comprehend.blastRadius === 'critical_path'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        }`}>
                          Blast Radius: {currentRun.spec.comprehend.blastRadius}
                        </span>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                            Root Cause Hypothesis:
                          </span>
                          <p className="text-xs text-slate-200 mt-0.5 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 font-mono">
                            {currentRun.spec.comprehend.rootCauseHypothesis}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                              <Bug className="w-3 h-3 text-rose-400" />
                              Faulty Functions Targeted
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {currentRun.spec.comprehend.faultyFunctions.map((fn, idx) => (
                                <span key={idx} className="px-2 py-1 rounded bg-rose-500/10 text-rose-300 text-xs font-mono border border-rose-500/20">
                                  {fn}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                              <FileCode className="w-3 h-3 text-cyan-400" />
                              Responsible Files
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {currentRun.spec.comprehend.responsibleFiles.map((file, idx) => (
                                <span key={idx} className="px-2 py-1 rounded bg-cyan-500/10 text-cyan-300 text-xs font-mono border border-cyan-500/20">
                                  {file}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="text-[11px] font-mono text-slate-500">
                          Incident Fingerprint: <span className="text-slate-400">{currentRun.spec.comprehend.incidentFingerprint}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* LOOP STAGE 2: DRILL DOWN CARD */}
                  {currentRun.spec.drillDown && (
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-950/40 via-slate-900/80 to-slate-900 border border-blue-500/30 shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Search className="w-4 h-4 text-blue-400" />
                          <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300">
                            2. DRILL DOWN — Active Repository Inspection
                          </h4>
                        </div>
                        <span className="text-[11px] font-mono text-blue-300/80">
                          {currentRun.spec.drillDown.queriedFiles.length} file(s) inspected live
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 mb-3 font-mono">
                        {currentRun.spec.drillDown.systemContextNotes}
                      </p>

                      <div className="space-y-2">
                        {currentRun.spec.drillDown.queriedFiles.map((qf, idx) => (
                          <div key={idx} className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/90 text-xs font-mono">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                <span className="font-bold text-slate-200">{qf.path}</span>
                              </div>
                              <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                {qf.sizeBytes} bytes
                              </span>
                            </div>

                            {qf.relevantSymbols.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap my-1.5">
                                <span className="text-[10px] text-slate-500 font-sans">Active Symbols:</span>
                                {qf.relevantSymbols.map((sym, sIdx) => (
                                  <span key={sIdx} className="px-1.5 py-0.5 bg-blue-500/10 text-blue-300 text-[10px] rounded border border-blue-500/20">
                                    {sym}
                                  </span>
                                ))}
                              </div>
                            )}

                            {qf.sampleSnippet && (
                              <pre className="p-2 rounded bg-slate-900/90 text-[11px] text-slate-400 overflow-x-auto border border-slate-800/80 mt-2">
                                <code>{qf.sampleSnippet}</code>
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>

                      {currentRun.spec.drillDown.existingDependencies && currentRun.spec.drillDown.existingDependencies.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Preserved Active Dependencies:</span>
                          {currentRun.spec.drillDown.existingDependencies.map((dep, dIdx) => (
                            <span key={dIdx} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono">
                              {dep}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Target Files Table */}
                  <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-cyan-400" />
                      <span>Target Files To Modify / Create</span>
                    </h4>
                    <div className="space-y-2">
                      {currentRun.spec.targetFiles.map((tf, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs font-mono"
                        >
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-bold">
                              {tf.action.toUpperCase()}
                            </span>
                            <span className="text-slate-200 font-bold">{tf.path}</span>
                          </div>
                          <span className="text-slate-400 text-[11px] font-sans">{tf.purpose}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Requirements & Architectural Changes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                        Architectural Changes
                      </h4>
                      <ul className="space-y-2">
                        {currentRun.spec.architecturalChanges.map((req, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                            <CornerDownRight className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                            <span>{req}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                        Acceptance &amp; Test Criteria
                      </h4>
                      <ul className="space-y-2">
                        {currentRun.spec.testCriteria.map((tc, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                            <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0 mt-0.5" />
                            <span>{tc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Rollback Plan */}
                  <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-xs text-slate-400">
                    <strong className="text-slate-300">Rollback Plan: </strong>
                    {currentRun.spec.rollbackPlan}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                  <Bot className="w-12 h-12 mb-3 text-slate-600" />
                  <p className="text-sm font-semibold">No Structured Spec Generated Yet</p>
                  <p className="text-xs text-slate-600 mt-1">Run the pipeline from the left panel to execute Prompt 1: Orchestrator.</p>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Prompt 2 - Sandbox Workspace */}
          {activeTab === 'sandbox' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {latestPatch && latestPatch.files.length > 0 ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  
                  {/* Anti-Overfitting Safeguard Banner */}
                  {latestPatch.antiOverfitting && (
                    <div className="px-6 py-3 bg-gradient-to-r from-indigo-950/80 via-slate-900 to-slate-950 border-b border-indigo-500/30 flex flex-wrap items-center justify-between gap-3 shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
                          <ShieldCheck className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-100">
                              3. GENERATE FIX — Anti-Overfitting Safeguard
                            </span>
                            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30">
                              SCORE: {latestPatch.antiOverfitting.semanticSystemScore}/100
                            </span>
                            <span className="px-1.5 py-0.2 text-[10px] font-mono bg-emerald-500/20 text-emerald-300 rounded">
                              SEMANTIC COHESION PASS
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {latestPatch.antiOverfitting.notes}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {latestPatch.antiOverfitting.checks.map((chk, cIdx) => (
                          <div
                            key={cIdx}
                            className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 flex items-center gap-1"
                            title={chk.details}
                          >
                            <CheckCheck className="w-3 h-3 text-emerald-400" />
                            <span>{chk.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                    {/* File List */}
                    <div className="w-full lg:w-64 border-r border-slate-800 bg-[#0b0f19] p-4 overflow-y-auto space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                        Modified Files ({latestPatch.files.length})
                      </span>
                      {latestPatch.files.map((f, i) => (
                        <button
                          key={i}
                          onClick={() => setSelectedFileIdx(i)}
                          className={`w-full text-left p-2.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                            selectedFileIdx === i
                              ? 'bg-slate-800 text-white border border-indigo-500/50'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                          }`}
                        >
                          <div className="font-bold truncate">{f.path}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{f.diffSummary}</div>
                        </button>
                      ))}

                      <div className="pt-4 border-t border-slate-800 text-xs text-slate-500 space-y-1">
                        <div>Iteration: <strong>{latestPatch.iteration}</strong></div>
                        <div className="truncate">Commit: <strong className="text-slate-400">{latestPatch.commitMessage}</strong></div>
                      </div>
                    </div>

                    {/* Code Viewer */}
                    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900/60">
                        <span className="text-xs font-mono font-bold text-slate-300">
                          {latestPatch.files[selectedFileIdx]?.path}
                        </span>
                        <span className="text-[11px] font-mono text-emerald-400">
                          {latestPatch.files[selectedFileIdx]?.diffSummary}
                        </span>
                      </div>
                      <pre className="flex-1 p-4 overflow-auto text-xs font-mono text-slate-300 leading-relaxed bg-[#060911]">
                        <code>{latestPatch.files[selectedFileIdx]?.sandboxContent}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                  <FileCode className="w-12 h-12 mb-3 text-slate-600" />
                  <p className="text-sm font-semibold">No Sandbox Patch Available</p>
                  <p className="text-xs text-slate-600 mt-1">Prompt 2 has not modified code in the sandbox yet.</p>
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Runs App & Tests */}
          {activeTab === 'tests' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {latestTest ? (
                <div className="space-y-6 max-w-4xl mx-auto">
                  {/* Overall Result Banner */}
                  <div className={`p-5 rounded-2xl border flex items-center justify-between ${
                    latestTest.passed
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      {latestTest.passed ? (
                        <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-6 h-6 text-amber-400" />
                      )}
                      <div>
                        <h4 className="text-base font-bold text-white">
                          {latestTest.passed
                            ? 'All Sandbox Tests & Telemetry Passed!'
                            : `Validation Failed in Iteration ${latestTest.iteration}`}
                        </h4>
                        <p className="text-xs opacity-90 mt-0.5">
                          {latestTest.passed
                            ? 'Ready for atomic promotion to Live App Updates'
                            : 'Triggered closed loopback to Prompt 2: Self-Updating Engine'}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-bold px-3 py-1 rounded bg-slate-900/60 border border-current">
                      Iteration {latestTest.iteration}
                    </span>
                  </div>

                  {/* Telemetry Metrics Box */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-[11px] text-slate-500 uppercase font-mono">Latency</span>
                      <div className="text-base font-bold text-white mt-1 font-mono">
                        {latestTest.telemetryCheck.latencyMs}ms
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-[11px] text-slate-500 uppercase font-mono">Memory</span>
                      <div className="text-base font-bold text-white mt-1 font-mono">
                        {latestTest.telemetryCheck.memoryMb} MB
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-[11px] text-slate-500 uppercase font-mono">Error Rate</span>
                      <div className="text-base font-bold text-white mt-1 font-mono">
                        {latestTest.telemetryCheck.errorRatePercent}%
                      </div>
                    </div>
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-[11px] text-slate-500 uppercase font-mono">Database Status</span>
                      <div className="text-base font-bold text-emerald-400 mt-1 font-mono">
                        {latestTest.telemetryCheck.dbHealthStatus.toUpperCase()}
                      </div>
                    </div>
                  </div>

                  {/* Unit Tests Table */}
                  <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Unit Test Assertions ({latestTest.unitTests.length})
                    </h4>
                    <div className="space-y-2">
                      {latestTest.unitTests.map((t, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs"
                        >
                          <div className="flex items-center gap-2.5">
                            {t.passed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-rose-400" />
                            )}
                            <div>
                              <span className="font-semibold text-slate-200">{t.name}</span>
                              {t.error && (
                                <p className="text-[11px] text-rose-400 font-mono mt-0.5">{t.error}</p>
                              )}
                            </div>
                          </div>
                          <span className="text-[11px] font-mono text-slate-500">{t.durationMs}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Failure Analysis and Loopback Feedback (If failed) */}
                  {latestTest.failureAnalysis && (
                    <div className="p-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-rose-300 flex items-center gap-2">
                        <RotateCcw className="w-4 h-4 text-rose-400" />
                        <span>Loopback Feedback Payload to Prompt 2</span>
                      </h4>
                      <p className="text-xs text-rose-200 font-mono">
                        <strong>Root Cause:</strong> {latestTest.failureAnalysis.rootCause}
                      </p>
                      <div className="text-xs text-slate-300 space-y-1">
                        <strong>Recommended Patch Adjustments for Next Iteration:</strong>
                        <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1 mt-1">
                          {latestTest.failureAnalysis.recommendedPatchAdjustments.map((rec, i) => (
                            <li key={i}>{rec}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                  <ShieldCheck className="w-12 h-12 mb-3 text-slate-600" />
                  <p className="text-sm font-semibold">No Test Execution Logs Available</p>
                  <p className="text-xs text-slate-600 mt-1">Tests run automatically following Prompt 2 sandbox modification.</p>
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Live App Updates */}
          {activeTab === 'live' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {currentRun?.liveUpdate ? (
                <div className="space-y-6 max-w-4xl mx-auto">
                  
                  {/* Live Success Banner */}
                  <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/60 to-teal-950/60 border border-emerald-500/40 shadow-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                          <Zap className="w-6 h-6 text-emerald-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-white">
                              Live App Update Active
                            </h3>
                            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30">
                              DEPLOYED
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-1">
                            {currentRun.liveUpdate.summary}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={handleRollback}
                        disabled={isRollingBack || currentRun.status === 'rolled_back'}
                        className="px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        <Undo2 className="w-4 h-4" />
                        <span>{currentRun.status === 'rolled_back' ? 'Rolled Back' : 'One-Click Rollback'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Pull Request & Auto-Merge Details */}
                  {currentRun.liveUpdate.pullRequest && (
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-slate-900/80 to-slate-900 border border-emerald-500/30 shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <GitPullRequest className="w-4 h-4 text-emerald-400" />
                          <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                            5. EVALUATE &amp; HEAL — Pull Request &amp; Auto-Merge
                          </h4>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/40 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          AUTO-MERGED
                        </span>
                      </div>

                      <div className="space-y-3 font-mono text-xs">
                        <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-emerald-400 font-bold">
                                PR #{currentRun.liveUpdate.pullRequest.prNumber}
                              </span>
                              <span className="text-slate-200">
                                {currentRun.liveUpdate.pullRequest.title}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 font-sans">
                              <span>Branch:</span>
                              <span className="text-slate-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                {currentRun.liveUpdate.pullRequest.branch}
                              </span>
                              <span>➔</span>
                              <span className="text-slate-300 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                                {currentRun.liveUpdate.pullRequest.targetBranch}
                              </span>
                            </div>
                          </div>
                          <span className="text-[11px] text-slate-500 font-mono">
                            Merged: {new Date(currentRun.liveUpdate.pullRequest.mergedAt).toLocaleTimeString()}
                          </span>
                        </div>

                        <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 text-[11px] text-slate-300 font-sans">
                          <strong className="text-slate-200 font-mono">Change Summary: </strong>
                          {currentRun.liveUpdate.pullRequest.changeSummary}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Deployment Details */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-[11px] text-slate-500 uppercase font-mono">GitOps Version</span>
                      <div className="text-base font-bold text-emerald-400 mt-1 font-mono">
                        {currentRun.liveUpdate.versionHash}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-[11px] text-slate-500 uppercase font-mono">Deployed At</span>
                      <div className="text-xs font-semibold text-slate-300 mt-1 font-mono">
                        {new Date(currentRun.liveUpdate.deployedAt).toLocaleTimeString()}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-[11px] text-slate-500 uppercase font-mono">Rollback Token</span>
                      <div className="text-xs font-semibold text-slate-400 mt-1 font-mono truncate">
                        {currentRun.liveUpdate.rollbackToken}
                      </div>
                    </div>
                  </div>

                  {/* Applied Files */}
                  <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Applied Live Files ({currentRun.liveUpdate.appliedFiles.length})
                    </h4>
                    <div className="space-y-1.5">
                      {currentRun.liveUpdate.appliedFiles.map((file, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950 text-xs font-mono text-slate-300 border border-slate-800/80"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{file}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* GitOps Action */}
                  {currentRun.liveUpdate.gitOpsAction && (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-400">
                      <span className="text-slate-500">$ </span>
                      {currentRun.liveUpdate.gitOpsAction}
                    </div>
                  )}

                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                  <Zap className="w-12 h-12 mb-3 text-slate-600" />
                  <p className="text-sm font-semibold">No Live Updates Deployed Yet</p>
                  <p className="text-xs text-slate-600 mt-1">Live updates deploy atomically after all tests &amp; telemetry checks pass.</p>
                </div>
              )}
            </div>
          )}

          {/* Tab 6: Pipeline Logs */}
          {activeTab === 'logs' && (
            <div className="flex-1 overflow-y-auto p-6 bg-[#070a10]">
              <div className="space-y-2 max-w-4xl mx-auto font-mono text-xs">
                {currentRun?.logs && currentRun.logs.length > 0 ? (
                  currentRun.logs.map((log, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                        log.type === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                          : log.type === 'warn'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : log.type === 'error'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                          : 'bg-slate-900/60 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span className="text-[10px] opacity-60 shrink-0 mt-0.5">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-950/60 shrink-0">
                        {log.stage}
                      </span>
                      <span className="flex-1 break-words">{log.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 py-12 text-center">No logs recorded for this run.</div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
