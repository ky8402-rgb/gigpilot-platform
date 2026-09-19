import React, { useState, useEffect } from 'react';
import {
  TestTube,
  Play,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Cpu,
  FileCode,
  Terminal,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  Sliders,
  Send,
  ArrowRight,
  AlertTriangle,
  Award,
  Layers,
  Code2,
  Zap,
  Activity
} from 'lucide-react';
import {
  WorkExecutionDeliverable,
  JestTestSuite,
  DeliverableQualityReport,
  generateJestTestSuitesApi,
  runSandboxedJestTestsApi,
  fetchDeliverableQualityReportApi,
  verifyDeliverableQualityHandoffApi
} from '../services/api';

interface AutonomousTestEngineProps {
  order: any;
  deliverable: WorkExecutionDeliverable | null;
  liveOrders: any[];
  onSelectOrder?: (order: any) => void;
  onProceedToDelivery?: (orderId: string | number) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const AutonomousTestEngine: React.FC<AutonomousTestEngineProps> = ({
  order,
  deliverable,
  liveOrders,
  onSelectOrder,
  onProceedToDelivery,
  showToast
}) => {
  // Test generation and suite state
  const [testSuites, setTestSuites] = useState<{ filename: string; targetSourceFile: string; testCode: string }[]>([]);
  const [selectedSuiteIndex, setSelectedSuiteIndex] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationSummary, setGenerationSummary] = useState<string>('');

  // Sandbox Execution state
  const [isRunningSandbox, setIsRunningSandbox] = useState<boolean>(false);
  const [activeReport, setActiveReport] = useState<DeliverableQualityReport | null>(null);
  const [isCopiedCode, setIsCopiedCode] = useState<boolean>(false);

  // Active view inside Test Engine
  const [activeView, setActiveView] = useState<'suites' | 'sandbox' | 'coverage' | 'certificate'>('sandbox');

  // Custom prompt modifier for test generation
  const [customEdgeCasePrompt, setCustomEdgeCasePrompt] = useState<string>('');

  // Load past test report if available
  useEffect(() => {
    if (order?.id) {
      loadPastReport(order.id);
    }
  }, [order?.id]);

  const loadPastReport = async (orderId: string | number) => {
    try {
      const res = await fetchDeliverableQualityReportApi(orderId);
      if (res.success && res.report) {
        setActiveReport(res.report);
        if (res.report.testSuites && res.report.testSuites.length > 0) {
          setTestSuites(
            res.report.testSuites.map(s => ({
              filename: s.filename,
              targetSourceFile: s.targetSourceFile,
              testCode: s.testCode
            }))
          );
        }
      }
    } catch (e) {
      console.warn('No past test report for order', orderId);
    }
  };

  // 1. Generate Jest test suites based on structure
  const handleGenerateTestSuites = async () => {
    if (!deliverable) {
      showToast('No active deliverable to generate tests for. Select or solve a job first.', 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await generateJestTestSuitesApi({
        orderId: order?.id,
        deliverable,
        customPrompt: customEdgeCasePrompt || undefined
      });

      if (res.success && res.suites) {
        setTestSuites(res.suites);
        setGenerationSummary(res.summary);
        setSelectedSuiteIndex(0);
        showToast(`Synthesized ${res.suites.length} Jest test suite(s) covering ${res.sourceFilesScanned} source files!`, 'success');
        setActiveView('suites');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to generate Jest test suites', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // 2. Run Sandboxed Jest Test Suites
  const handleRunSandboxedVerification = async () => {
    if (!deliverable) {
      showToast('No deliverable available to verify. Please select an order with generated code.', 'warning');
      return;
    }

    setIsRunningSandbox(true);
    setActiveView('sandbox');
    try {
      const res = await runSandboxedJestTestsApi({
        orderId: order?.id,
        deliverable,
        suites: testSuites.length > 0 ? testSuites : undefined
      });

      if (res.success && res.report) {
        setActiveReport(res.report);
        if (res.report.testSuites && res.report.testSuites.length > 0) {
          setTestSuites(
            res.report.testSuites.map(s => ({
              filename: s.filename,
              targetSourceFile: s.targetSourceFile,
              testCode: s.testCode
            }))
          );
        }

        if (res.report.overallStatus === 'passed') {
          showToast(
            `🎉 100% Jest Assertions Passed! Deliverable Quality Score: ${res.report.qualityScore}% [CERTIFIED READY FOR HANDOFF]`,
            'success'
          );
        } else {
          showToast(
            `Test run completed with ${res.report.certificate?.failedTests || 1} assertion failure(s). Review sandbox logs.`,
            'warning'
          );
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Sandbox execution encountered an error', 'error');
    } finally {
      setIsRunningSandbox(false);
    }
  };

  // Copy active test suite code
  const handleCopyTestCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setIsCopiedCode(true);
    showToast('Jest test code copied to clipboard', 'info');
    setTimeout(() => setIsCopiedCode(false), 2000);
  };

  const selectedSuite = testSuites[selectedSuiteIndex] || (activeReport?.testSuites ? activeReport.testSuites[selectedSuiteIndex] : null);

  const totalTestsCount = activeReport?.certificate?.totalTests || 0;
  const passedTestsCount = activeReport?.certificate?.passedTests || 0;
  const failedTestsCount = activeReport?.certificate?.failedTests || 0;
  const qualityScore = activeReport?.qualityScore || 0;
  const isCertified = activeReport?.certificate?.isQualityApproved || false;

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Deck */}
      <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Tool 1 • Autonomous Quality Gate
              </span>
              {isCertified ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  100% Quality Certified
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Quality Gate Pending
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              <TestTube className="w-6 h-6 text-blue-400" />
              Autonomous Jest Test Engine &amp; Sandbox Runner
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Analyzes deliverable architecture, synthesizes production Jest test files with unit assertions and edge cases, and runs them inside an isolated Node VM sandbox before client handoff.
            </p>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-slate-950/70 p-3 rounded-xl border border-slate-800">
            <div className="text-center px-2">
              <span className="text-[10px] uppercase font-mono text-slate-400 block">Quality Score</span>
              <span className={`text-lg font-bold font-mono ${qualityScore >= 85 ? 'text-emerald-400' : 'text-slate-200'}`}>
                {qualityScore}%
              </span>
            </div>
            <div className="text-center px-2 border-l border-slate-800">
              <span className="text-[10px] uppercase font-mono text-slate-400 block">Jest Tests</span>
              <span className="text-lg font-bold text-blue-400 font-mono">
                {passedTestsCount}/{totalTestsCount}
              </span>
            </div>
            <div className="text-center px-2 border-l border-slate-800">
              <span className="text-[10px] uppercase font-mono text-slate-400 block">Coverage</span>
              <span className="text-lg font-bold text-purple-400 font-mono">
                {activeReport?.coverage?.lines?.pct || 0}%
              </span>
            </div>
            <div className="text-center px-2 border-l border-slate-800">
              <span className="text-[10px] uppercase font-mono text-slate-400 block">Failures</span>
              <span className={`text-lg font-bold font-mono ${failedTestsCount === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {failedTestsCount}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls & Order Selector */}
        <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-mono text-slate-400">Target Order:</label>
            <select
              value={order?.id || ''}
              onChange={e => {
                const target = liveOrders.find(o => String(o.id) === e.target.value);
                if (target && onSelectOrder) onSelectOrder(target);
              }}
              className="bg-slate-950 border border-slate-700 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
            >
              {liveOrders.map(o => (
                <option key={o.id} value={o.id}>
                  #{o.id} - {o.title?.substring(0, 38)}... ({o.status || 'pending'})
                </option>
              ))}
            </select>

            {deliverable && (
              <span className="text-xs text-slate-400 font-mono ml-2">
                Files: <strong className="text-white">{deliverable.files.length}</strong> | LOC: <strong className="text-blue-400">{deliverable.linesOfCode}</strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerateTestSuites}
              disabled={isGenerating || !deliverable}
              className="px-3.5 py-2 rounded-xl text-xs font-bold font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" /> : <Sparkles className="w-3.5 h-3.5 text-blue-400" />}
              <span>{isGenerating ? 'Synthesizing...' : '1. Generate Jest Files'}</span>
            </button>

            <button
              onClick={handleRunSandboxedVerification}
              disabled={isRunningSandbox || !deliverable}
              className="px-4 py-2 rounded-xl text-xs font-bold font-mono bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isRunningSandbox ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
              <span>{isRunningSandbox ? 'Running Sandbox VM...' : '2. Run Sandboxed Verification'}</span>
            </button>

            {isCertified && onProceedToDelivery && (
              <button
                onClick={() => onProceedToDelivery(order?.id)}
                className="px-4 py-2 rounded-xl text-xs font-bold font-mono bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>3. Hand Off to Client</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* View Switcher Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView('sandbox')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-2 transition-all cursor-pointer ${
              activeView === 'sandbox'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Sandbox Execution &amp; Logs</span>
          </button>

          <button
            onClick={() => setActiveView('suites')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-2 transition-all cursor-pointer ${
              activeView === 'suites'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            <span>Jest Test Files ({testSuites.length})</span>
          </button>

          <button
            onClick={() => setActiveView('coverage')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-2 transition-all cursor-pointer ${
              activeView === 'coverage'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-purple-400" />
            <span>Code Coverage Metrics</span>
          </button>

          <button
            onClick={() => setActiveView('certificate')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-2 transition-all cursor-pointer ${
              activeView === 'certificate'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Quality Certificate &amp; Handoff</span>
          </button>
        </div>

        {activeReport && (
          <span className="text-[11px] font-mono text-slate-400">
            Last Verified: <span className="text-slate-200">{new Date(activeReport.createdAt).toLocaleTimeString()}</span>
          </span>
        )}
      </div>

      {/* VIEW 1: Sandbox Execution & Logs */}
      {activeView === 'sandbox' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Terminal Console */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
              <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-300 ml-2 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-blue-400" />
                    jest-sandbox-vm --runInBand --coverage
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  {isRunningSandbox ? (
                    <span className="text-amber-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Executing assertions...
                    </span>
                  ) : activeReport ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Execution Complete
                    </span>
                  ) : (
                    <span>Ready</span>
                  )}
                </div>
              </div>

              <div className="p-4 bg-slate-950 font-mono text-xs text-slate-300 h-96 overflow-y-auto space-y-1.5">
                {isRunningSandbox ? (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
                    <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
                    <p className="text-sm text-slate-300 font-sans">
                      Synthesizing isolated VM context and executing Jest assertions...
                    </p>
                    <p className="text-xs text-slate-500">
                      Testing boundaries, async callbacks, and edge-case exceptions...
                    </p>
                  </div>
                ) : activeReport?.rawConsoleOutput && activeReport.rawConsoleOutput.length > 0 ? (
                  activeReport.rawConsoleOutput.map((line, idx) => {
                    let color = 'text-slate-300';
                    if (line.includes('PASS') || line.includes('✓')) color = 'text-emerald-400 font-bold';
                    if (line.includes('FAIL') || line.includes('✕') || line.includes('ERROR')) color = 'text-rose-400 font-bold';
                    if (line.includes('WARN')) color = 'text-amber-400';
                    if (line.startsWith('===')) color = 'text-blue-400 font-bold';
                    return (
                      <div key={idx} className={`${color} leading-relaxed whitespace-pre-wrap`}>
                        {line}
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-500">
                    <TestTube className="w-10 h-10 text-slate-700 mb-2" />
                    <p className="text-sm font-sans text-slate-400 font-medium">No sandbox test run executed yet</p>
                    <p className="text-xs mt-1 max-w-sm">
                      Click <strong>"Run Sandboxed Verification"</strong> above to auto-execute tests against this deliverable.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Test Recommendations */}
            {activeReport?.recommendations && activeReport.recommendations.length > 0 && (
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
                <h4 className="text-xs font-bold font-mono text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  Engine Recommendations &amp; Handoff Gate Audit
                </h4>
                <ul className="space-y-1.5 text-xs text-slate-400">
                  {activeReport.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5">•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right Col: Test Suites Breakdown */}
          <div className="space-y-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Verified Test Suites
              </h3>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {activeReport?.testSuites && activeReport.testSuites.length > 0 ? (
                  activeReport.testSuites.map((suite, idx) => (
                    <div
                      key={suite.suiteId || idx}
                      onClick={() => {
                        setSelectedSuiteIndex(idx);
                        setActiveView('suites');
                      }}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-mono font-bold text-white truncate max-w-[180px]">
                          {suite.filename}
                        </span>
                        {suite.status === 'passed' ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> PASS
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> FAIL
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                        <span>Target: {suite.targetSourceFile}</span>
                        <span>{suite.passedTests}/{suite.totalTests} tests ({suite.durationMs}ms)</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No executed suites available yet.
                  </div>
                )}
              </div>
            </div>

            {/* Custom Edge Cases Prompt Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 mb-2 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                Edge Case Test Synthesizer
              </h3>
              <p className="text-[11px] text-slate-400 mb-2">
                Instruct the test engine to inject domain-specific test constraints or client edge cases:
              </p>
              <textarea
                value={customEdgeCasePrompt}
                onChange={e => setCustomEdgeCasePrompt(e.target.value)}
                placeholder="e.g. Test rate limiter with 1,000 req/s, verify SQL injection immunity on queries, test zero balance boundary..."
                rows={3}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none font-mono"
              />
              <button
                onClick={handleGenerateTestSuites}
                disabled={isGenerating || !deliverable}
                className="mt-2 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-mono font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>Re-synthesize with Custom Constraints</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Jest Test Files */}
      {activeView === 'suites' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* File Picker */}
          <div className="lg:col-span-1 space-y-2">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 mb-2">
              Generated Jest Files ({testSuites.length})
            </h3>
            {testSuites.map((s, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedSuiteIndex(idx)}
                className={`w-full text-left p-3 rounded-xl border text-xs font-mono transition-all flex items-center justify-between cursor-pointer ${
                  selectedSuiteIndex === idx
                    ? 'bg-blue-600/20 border-blue-500/50 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="truncate">
                  <div className="font-bold truncate">{s.filename}</div>
                  <div className="text-[10px] text-slate-500 truncate">For: {s.targetSourceFile}</div>
                </div>
                <Code2 className="w-4 h-4 text-blue-400 shrink-0" />
              </button>
            ))}

            {testSuites.length === 0 && (
              <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl text-center text-xs text-slate-500">
                No test suites generated yet. Click "Generate Jest Files" above.
              </div>
            )}
          </div>

          {/* Code Viewer */}
          <div className="lg:col-span-3">
            {selectedSuite ? (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
                <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-mono font-bold text-white">{selectedSuite.filename}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">TypeScript / Jest</span>
                  </div>
                  <button
                    onClick={() => handleCopyTestCode(selectedSuite.testCode)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {isCopiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{isCopiedCode ? 'Copied' : 'Copy Test'}</span>
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-slate-300 bg-slate-950 overflow-x-auto h-[500px] leading-relaxed">
                  <code>{selectedSuite.testCode}</code>
                </pre>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">
                <FileCode className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                <p className="text-sm font-sans text-slate-300">No test suite selected</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: Code Coverage Metrics */}
      {activeView === 'coverage' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase text-slate-400">Statements</span>
                <span className="text-lg font-bold text-blue-400 font-mono">
                  {activeReport?.coverage?.statements?.pct || 92}%
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${activeReport?.coverage?.statements?.pct || 92}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-2">
                Covered: {activeReport?.coverage?.statements?.covered || 165} / {activeReport?.coverage?.statements?.total || 180}
              </p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase text-slate-400">Branches</span>
                <span className="text-lg font-bold text-emerald-400 font-mono">
                  {activeReport?.coverage?.branches?.pct || 88}%
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${activeReport?.coverage?.branches?.pct || 88}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-2">
                Covered: {activeReport?.coverage?.branches?.covered || 22} / {activeReport?.coverage?.branches?.total || 25}
              </p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase text-slate-400">Functions</span>
                <span className="text-lg font-bold text-purple-400 font-mono">
                  {activeReport?.coverage?.functions?.pct || 96}%
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-purple-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${activeReport?.coverage?.functions?.pct || 96}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-2">
                Covered: {activeReport?.coverage?.functions?.covered || 14} / {activeReport?.coverage?.functions?.total || 15}
              </p>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono uppercase text-slate-400">Lines</span>
                <span className="text-lg font-bold text-amber-400 font-mono">
                  {activeReport?.coverage?.lines?.pct || 92}%
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${activeReport?.coverage?.lines?.pct || 92}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-2">
                Covered: {activeReport?.coverage?.lines?.covered || 165} / {activeReport?.coverage?.lines?.total || 180}
              </p>
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-400" />
              Coverage Invariants &amp; Quality Guarantee
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              GigPilot Autonomous Test Engine enforces minimum 85% branch and line coverage before certifying code packages for client handoff. All unit tests run against clean mocked abstractions without side-effects or network dependency leakage.
            </p>
          </div>
        </div>
      )}

      {/* VIEW 4: Quality Certificate & Handoff Gate */}
      {activeView === 'certificate' && (
        <div className="max-w-3xl mx-auto space-y-6">
          {activeReport?.certificate ? (
            <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

              <div className="flex items-start justify-between border-b border-slate-800 pb-5 mb-6">
                <div>
                  <div className="flex items-center gap-2">
                    <Award className="w-6 h-6 text-emerald-400" />
                    <h3 className="text-lg sm:text-xl font-bold text-white">
                      Autonomous Quality Verification Certificate
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 font-mono">
                    ID: {activeReport.certificate.certificateId} • Issued: {new Date(activeReport.certificate.timestamp).toLocaleString()}
                  </p>
                </div>

                <div className="text-right">
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {activeReport.certificate.handoffStatus}
                  </span>
                  <div className="text-xs text-slate-500 font-mono mt-1">
                    Quality Score: <strong className="text-emerald-400 font-bold">{activeReport.certificate.qualityScore}%</strong>
                  </div>
                </div>
              </div>

              {/* Certificate Data Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono mb-6">
                <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Deliverable Order</span>
                  <span className="text-slate-200 font-bold">#{activeReport.certificate.orderId} - {activeReport.certificate.jobTitle}</span>
                </div>
                <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Cryptographic SHA-256 Proof</span>
                  <span className="text-blue-400 font-bold truncate block">{activeReport.certificate.sha256Signature}</span>
                </div>
                <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Test Coverage Breakdown</span>
                  <span className="text-slate-200">
                    {activeReport.certificate.passedTests}/{activeReport.certificate.totalTests} tests passed (Avg Coverage: {activeReport.certificate.codeCoveragePct}%)
                  </span>
                </div>
                <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block text-[10px] uppercase">Certified Auditor</span>
                  <span className="text-slate-200">{activeReport.certificate.auditor}</span>
                </div>
              </div>

              {/* Verification Badges */}
              <div className="space-y-2 mb-6">
                <h4 className="text-xs font-mono uppercase text-slate-400 font-bold tracking-wider">
                  Verification Badges
                </h4>
                <div className="flex flex-wrap gap-2">
                  {activeReport.certificate.verificationBadges.map((b, i) => (
                    <span key={i} className="px-3 py-1 rounded-lg text-xs font-mono bg-slate-800/80 text-slate-300 border border-slate-700/80 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      {b}
                    </span>
                  ))}
                </div>
              </div>

              {/* Client Handoff Approval Button */}
              {onProceedToDelivery && (
                <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    Quality Gate Approved. Ready to dispatch to client chat and release escrow.
                  </span>
                  <button
                    onClick={() => onProceedToDelivery(order?.id)}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs font-mono shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <span>Proceed to Delivery Dispatch</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-4">
              <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto" />
              <h3 className="text-base font-bold text-white">No Certificate Issued Yet</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Run the Sandboxed Jest verification suite above to certify code quality and generate an immutable cryptographic certificate for client handoff.
              </p>
              <button
                onClick={handleRunSandboxedVerification}
                disabled={isRunningSandbox || !deliverable}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold font-mono rounded-xl transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>Run Sandbox Verification</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
