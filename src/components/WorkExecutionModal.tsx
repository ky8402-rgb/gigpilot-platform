import React, { useState, useEffect } from 'react';
import {
  Code,
  CheckCircle2,
  Download,
  Copy,
  Check,
  Send,
  Sparkles,
  Layers,
  FileCode,
  DollarSign,
  X,
  FileText,
  Terminal,
  Cpu,
  RefreshCw,
  ExternalLink,
  BookOpen,
  HelpCircle,
  BrainCircuit,
  Wand2
} from 'lucide-react';
import {
  executeWorkOrder,
  fetchWorkDeliverables,
  explainOrWalkthroughCodeApi,
  refineDeliverableApi,
  deliverWorkOrderToClientApi,
  WorkExecutionDeliverable,
  DeliverableFile,
  CodeWalkthroughResponse
} from '../services/api';

interface WorkExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: {
    id: string | number;
    title: string;
    description?: string;
    category?: string;
    amount?: number;
    tags?: string[];
    client?: string;
  } | null;
  onWorkCompleted?: (orderId: string | number, deliverable: WorkExecutionDeliverable) => void;
  onOpenPaymentCollection?: (orderId: string | number, amount: number, clientName?: string, title?: string) => void;
  onOpenClientChat?: (clientName: string, projectTitle: string, deliverableNote?: string) => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export const WorkExecutionModal: React.FC<WorkExecutionModalProps> = ({
  isOpen,
  onClose,
  order,
  onWorkCompleted,
  onOpenPaymentCollection,
  onOpenClientChat,
  showToast,
}) => {
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionStep, setExecutionStep] = useState<number>(0);
  const [deliverable, setDeliverable] = useState<WorkExecutionDeliverable | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  const [customRequirements, setCustomRequirements] = useState<string>('');

  // Interactive Walkthrough & Refinement States
  const [activeTab, setActiveTab] = useState<'files' | 'walkthrough' | 'refine'>('files');
  const [walkthroughMode, setWalkthroughMode] = useState<'walkthrough' | 'explain_function' | 'why_pick' | 'custom_instruction'>('walkthrough');
  const [functionToExplain, setFunctionToExplain] = useState<string>('handleExecute');
  const [customInstruction, setCustomInstruction] = useState<string>('');
  const [isExplaining, setIsExplaining] = useState<boolean>(false);
  const [explanationData, setExplanationData] = useState<CodeWalkthroughResponse | null>(null);

  const [refinementInput, setRefinementInput] = useState<string>('');
  const [isRefining, setIsRefining] = useState<boolean>(false);
  const [isDelivering, setIsDelivering] = useState<boolean>(false);

  // Load existing deliverables or start fresh when modal opens
  useEffect(() => {
    if (!isOpen || !order) {
      setDeliverable(null);
      setIsExecuting(false);
      setExecutionStep(0);
      setExplanationData(null);
      setActiveTab('files');
      return;
    }

    async function checkExisting() {
      if (!order) return;
      try {
        const existing = await fetchWorkDeliverables(order.id);
        if (existing) {
          setDeliverable(existing);
          setExecutionStep(4);
        }
      } catch (_) {}
    }
    checkExisting();
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const handleStartWork = async () => {
    setIsExecuting(true);
    setExecutionStep(1);

    // Step animation for responsive visual telemetry
    const timer1 = setTimeout(() => setExecutionStep(2), 700);
    const timer2 = setTimeout(() => setExecutionStep(3), 1600);

    try {
      const res = await executeWorkOrder({
        orderId: order.id,
        title: order.title,
        description: order.description,
        category: order.category,
        tags: order.tags,
        budget: order.amount,
        requirements: customRequirements.trim() || undefined,
      });

      clearTimeout(timer1);
      clearTimeout(timer2);

      if (res.success && res.deliverable) {
        setDeliverable(res.deliverable);
        setExecutionStep(4);
        setActiveFileIndex(0);
        showToast(`Work delivered! ${res.deliverable.files.length} production files engineered.`, 'success');
        onWorkCompleted?.(order.id, res.deliverable);
      } else {
        throw new Error(res.message || 'Work generation returned no deliverables');
      }
    } catch (err: any) {
      clearTimeout(timer1);
      clearTimeout(timer2);
      setExecutionStep(0);
      showToast(`Work generation failed: ${err.message}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleRunExplanation = async (mode: 'walkthrough' | 'explain_function' | 'why_pick' | 'custom_instruction') => {
    setWalkthroughMode(mode);
    setIsExplaining(true);
    setExplanationData(null);

    try {
      const targetFile = deliverable?.files[activeFileIndex]?.filename;
      const res = await explainOrWalkthroughCodeApi({
        orderId: order.id,
        deliverable: deliverable || undefined,
        targetFile,
        targetFunction: mode === 'explain_function' ? functionToExplain : undefined,
        mode,
        clientPrompt: mode === 'custom_instruction' ? customInstruction : undefined,
      });

      setExplanationData(res);
      showToast(`Walkthrough / Explanation generated!`, 'success');
    } catch (err: any) {
      showToast(`Failed to generate explanation: ${err.message}`, 'error');
    } finally {
      setIsExplaining(false);
    }
  };

  const handleRefineCode = async () => {
    if (!refinementInput.trim()) {
      showToast('Please type your instructions for the code modification', 'warning');
      return;
    }
    setIsRefining(true);
    try {
      const res = await refineDeliverableApi({
        orderId: order.id,
        instructions: refinementInput.trim(),
        currentDeliverable: deliverable || undefined,
      });

      if (res.success && res.deliverable) {
        setDeliverable(res.deliverable);
        setRefinementInput('');
        setActiveTab('files');
        showToast(res.message, 'success');
      }
    } catch (err: any) {
      showToast(`Refinement failed: ${err.message}`, 'error');
    } finally {
      setIsRefining(false);
    }
  };

  const handleDeliverToClientDirectly = async () => {
    setIsDelivering(true);
    try {
      const res = await deliverWorkOrderToClientApi({
        orderId: order.id,
        clientName: order.client || 'Client',
        customNote: deliverable?.clientHandoverNote,
        requestPayment: true,
      });
      showToast(res.message, 'success');
      onClose();
      onOpenClientChat?.(order.client || 'Client', order.title, deliverable?.clientHandoverNote);
    } catch (err: any) {
      showToast(`Delivery error: ${err.message}`, 'error');
    } finally {
      setIsDelivering(false);
    }
  };

  const handleCopyActiveFile = () => {
    if (!deliverable || !deliverable.files[activeFileIndex]) return;
    navigator.clipboard.writeText(deliverable.files[activeFileIndex].content);
    setCopiedFile(true);
    showToast(`Copied ${deliverable.files[activeFileIndex].filename} to clipboard!`, 'info');
    setTimeout(() => setCopiedFile(false), 2000);
  };

  const handleDownloadAll = () => {
    if (!deliverable) return;
    const combinedContent = deliverable.files
      .map(f => `// ==========================================\n// FILE: ${f.filename}\n// ==========================================\n\n${f.content}\n\n`)
      .join('\n');
    const blob = new Blob([combinedContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_deliverables.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Deliverable bundle downloaded successfully!', 'success');
  };

  const activeFile = deliverable?.files[activeFileIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-[#0f1422] border border-blue-500/30 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-blue-950/40 to-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                  AI Autonomous Work Engine
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Order #{order.id}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white truncate max-w-xl">
                {order.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {order.amount && (
              <span className="font-mono text-emerald-400 font-bold bg-emerald-950/40 border border-emerald-500/30 px-3 py-1 rounded-xl text-xs sm:text-sm">
                ${order.amount} USD
              </span>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          
          {/* Work Spec Card */}
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">
                <strong className="text-slate-200">Category:</strong> {order.category || 'Software Engineering'}
              </span>
              {order.tags && order.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {order.tags.map((t, idx) => (
                    <span key={idx} className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[11px] font-mono border border-slate-700">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {order.description && (
              <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/50 p-3 rounded-xl border border-slate-800/80 max-h-24 overflow-y-auto">
                {order.description}
              </p>
            )}

            {!deliverable && !isExecuting && (
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  <span>Custom Engineering Instructions (Optional):</span>
                </label>
                <input
                  type="text"
                  value={customRequirements}
                  onChange={(e) => setCustomRequirements(e.target.value)}
                  placeholder="e.g. Include PostgreSQL schema migration and rate-limiter unit tests"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>

          {/* Action Trigger Area if not executed */}
          {!deliverable && (
            <div className="rounded-2xl border border-dashed border-blue-500/40 bg-blue-950/10 p-8 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-3xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Cpu className={`w-7 h-7 ${isExecuting ? 'animate-spin' : ''}`} />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">
                  {isExecuting ? 'Autonomous AI Engineering in Progress...' : 'Ready to Execute Work Deliverables'}
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {isExecuting
                    ? 'Gemini 3.8 Flash is generating production source code, unit test cases, and technical delivery documentation.'
                    : 'Click below to autonomously generate complete, verified project code files, test suites, and client handover notes.'}
                </p>
              </div>

              {/* Progress Steps */}
              {isExecuting && (
                <div className="max-w-md mx-auto space-y-2 text-left pt-2">
                  <div className={`flex items-center gap-2.5 text-xs ${executionStep >= 1 ? 'text-blue-400' : 'text-slate-600'}`}>
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                    <span>1. Analyzing client requirements &amp; architecture specifications...</span>
                  </div>
                  <div className={`flex items-center gap-2.5 text-xs ${executionStep >= 2 ? 'text-blue-400' : 'text-slate-600'}`}>
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                    <span>2. Synthesizing production modular code &amp; data models...</span>
                  </div>
                  <div className={`flex items-center gap-2.5 text-xs ${executionStep >= 3 ? 'text-blue-400' : 'text-slate-600'}`}>
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                    <span>3. Running unit test validation &amp; compiling delivery package...</span>
                  </div>
                </div>
              )}

              <button
                onClick={handleStartWork}
                disabled={isExecuting}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs sm:text-sm px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-500/25 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isExecuting ? 'Engineering Solution...' : '⚡ Execute Work with AI'}</span>
              </button>
            </div>
          )}

          {/* Deliverables Viewer (When Work is Done) */}
          {deliverable && (
            <div className="space-y-5">
              
              {/* Deliverable Metrics Header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">Status</span>
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 mt-0.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Work Delivered
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">Files Created</span>
                  <span className="text-xs font-bold text-white font-mono mt-0.5">
                    {deliverable.files.length} Files ({deliverable.linesOfCode} LOC)
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">Execution Speed</span>
                  <span className="text-xs font-bold text-blue-400 font-mono mt-0.5">
                    {(deliverable.executionTimeMs / 1000).toFixed(2)}s
                  </span>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">AI Engine</span>
                  <span className="text-xs font-bold text-purple-300 font-mono mt-0.5 truncate block" title={deliverable.modelUsed}>
                    {deliverable.modelUsed}
                  </span>
                </div>
              </div>

              {/* Summary & Verification Checklist */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 space-y-2">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase font-mono tracking-wider">
                    <FileText className="w-3.5 h-3.5 text-blue-400" /> Executive Summary
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {deliverable.summary}
                  </p>
                  <p className="text-[11px] text-slate-400 italic pt-1 border-t border-slate-800/80">
                    <strong>Architecture:</strong> {deliverable.architectureNotes}
                  </p>
                </div>

                <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 space-y-2">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5 uppercase font-mono tracking-wider">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Verification Checklist
                  </h4>
                  <ul className="space-y-1.5">
                    {deliverable.verificationChecklist.map((item, idx) => (
                      <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                          ✓
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* View Selector Tabs */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2">
                <button
                  onClick={() => setActiveTab('files')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'files'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Production Files ({deliverable.files.length})</span>
                </button>

                <button
                  onClick={() => {
                    setActiveTab('walkthrough');
                    if (!explanationData) handleRunExplanation('walkthrough');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'walkthrough'
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Code Walkthrough &amp; "Why Pick"</span>
                </button>

                <button
                  onClick={() => setActiveTab('refine')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'refine'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Wand2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Fulfill Client Request ("Can Do Anything")</span>
                </button>
              </div>

              {/* TAB 1: CODE FILE EXPLORER */}
              {activeTab === 'files' && (
                <div className="rounded-2xl border border-slate-800 bg-[#090d16] overflow-hidden shadow-inner">
                  {/* File Tabs */}
                  <div className="flex items-center justify-between bg-slate-900/90 border-b border-slate-800 px-3 py-1.5 overflow-x-auto">
                    <div className="flex items-center gap-1.5">
                      {deliverable.files.map((file, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveFileIndex(idx)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                            activeFileIndex === idx
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          <FileCode className="w-3 h-3" />
                          <span>{file.filename}</span>
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopyActiveFile}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer"
                        title="Copy file content"
                      >
                        {copiedFile ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedFile ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button
                        onClick={handleDownloadAll}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer"
                        title="Download deliverable package"
                      >
                        <Download className="w-3 h-3 text-blue-400" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>

                  {/* File Content Preview */}
                  {activeFile && (
                    <div className="p-4 overflow-x-auto">
                      <div className="text-[11px] text-slate-400 font-mono mb-2 flex items-center justify-between pb-2 border-b border-slate-800/80">
                        <span>{activeFile.description}</span>
                        <span className="text-slate-500 uppercase">{activeFile.language}</span>
                      </div>
                      <pre className="text-xs font-mono text-emerald-300/90 leading-relaxed max-h-80 overflow-y-auto">
                        <code>{activeFile.content}</code>
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CODE WALKTHROUGH & WHY PICK */}
              {activeTab === 'walkthrough' && (
                <div className="rounded-2xl border border-slate-800 bg-[#090d16] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <span className="text-xs font-bold font-mono text-cyan-400 uppercase">
                      Client Walkthrough &amp; Architectural Rationale
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => handleRunExplanation('walkthrough')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                          walkthroughMode === 'walkthrough' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        Guided Walkthrough
                      </button>
                      <button
                        onClick={() => handleRunExplanation('explain_function')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                          walkthroughMode === 'explain_function' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        Explain Function
                      </button>
                      <button
                        onClick={() => handleRunExplanation('why_pick')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                          walkthroughMode === 'why_pick' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        Why Did You Pick?
                      </button>
                    </div>
                  </div>

                  {walkthroughMode === 'explain_function' && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={functionToExplain}
                        onChange={(e) => setFunctionToExplain(e.target.value)}
                        placeholder="Function name to explain (e.g. handleExecute, processPayment)"
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white font-mono"
                      />
                      <button
                        onClick={() => handleRunExplanation('explain_function')}
                        disabled={isExplaining}
                        className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold cursor-pointer disabled:opacity-50"
                      >
                        Explain
                      </button>
                    </div>
                  )}

                  {isExplaining && (
                    <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 text-center text-xs text-cyan-300 font-mono animate-pulse">
                      Synthesizing client explanation with Gemini AI...
                    </div>
                  )}

                  {explanationData && (
                    <div className="space-y-3">
                      <div className="text-xs text-slate-200 leading-relaxed whitespace-pre-line bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                        {explanationData.explanation}
                      </div>

                      {explanationData.codeSnippet && (
                        <pre className="text-xs font-mono text-emerald-300 bg-slate-950 p-3 rounded-xl border border-slate-800 overflow-x-auto">
                          <code>{explanationData.codeSnippet}</code>
                        </pre>
                      )}

                      {explanationData.keyTakeaways && explanationData.keyTakeaways.length > 0 && (
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-800/80 space-y-1">
                          <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
                            Key Client Takeaways:
                          </span>
                          {explanationData.keyTakeaways.map((k, i) => (
                            <div key={i} className="text-xs text-slate-300 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                              <span>{k}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: REFINE CODE / FULFILL CLIENT REQUEST */}
              {activeTab === 'refine' && (
                <div className="rounded-2xl border border-slate-800 bg-[#090d16] p-5 space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-white uppercase font-mono tracking-wider flex items-center gap-1.5 text-purple-400">
                      <Wand2 className="w-4 h-4" />
                      Fulfill Any Client Request / Refactor Code
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      This tool can execute any code modification, feature addition, refactoring, or test suite generation requested by the client.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <textarea
                      rows={3}
                      value={refinementInput}
                      onChange={(e) => setRefinementInput(e.target.value)}
                      placeholder="e.g. Please add Docker Compose configuration, add input sanitization for XSS, and write 3 additional unit tests."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-sans"
                    />

                    <div className="flex justify-end">
                      <button
                        onClick={handleRefineCode}
                        disabled={isRefining || !refinementInput.trim()}
                        className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-md shadow-purple-600/20"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{isRefining ? 'Executing Refactoring...' : '⚡ Apply Client Instructions &amp; Regenerate'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Handover Note Preview */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 uppercase font-mono">
                    <Send className="w-3.5 h-3.5 text-blue-400" /> Client Handover Message Draft
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Ready to dispatch</span>
                </div>
                <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 font-sans leading-relaxed">
                  "{deliverable.clientHandoverNote}"
                </p>
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer / Direct Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400 font-mono">
            {deliverable ? (
              <span>SHA-256: <strong className="text-slate-300">{deliverable.checksum}</strong></span>
            ) : (
              <span>Autopilot Work Execution Service Ready</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {deliverable && (
              <>
                <button
                  onClick={handleDeliverToClientDirectly}
                  disabled={isDelivering}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-500/20 disabled:opacity-50"
                  title="Deliver package directly to client with verified SHA-256 hash"
                >
                  <Send className={`w-3.5 h-3.5 ${isDelivering ? 'animate-pulse' : ''}`} />
                  <span>{isDelivering ? 'Delivering...' : '⚡ Auto-Deliver to Client Thread'}</span>
                </button>

                <button
                  onClick={() => {
                    onClose();
                    onOpenClientChat?.(order.client || 'Client', order.title, deliverable.clientHandoverNote);
                  }}
                  className="px-4 py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600 border border-purple-500/40 text-purple-300 hover:text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Open Client Chat</span>
                </button>

                <button
                  onClick={() => {
                    onClose();
                    onOpenPaymentCollection?.(order.id, order.amount || 350, undefined, order.title);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-600/20"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>💰 Request &amp; Collect Payment</span>
                </button>
              </>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
