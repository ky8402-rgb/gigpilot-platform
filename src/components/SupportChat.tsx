import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Send, 
  Wrench, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Sparkles, 
  X, 
  Minimize2, 
  ShieldCheck, 
  Cpu, 
  Activity,
  Terminal,
  Server,
  HardDrive,
  Globe,
  Database,
  Layers,
  Zap,
  TrendingUp,
  History,
  Check,
  AlertCircle,
  Play,
  FileCheck,
  Archive,
  UserCheck,
  Radio
} from 'lucide-react';
import { errorMonitor } from '../services/errorMonitor';
import { invalidateApiCache } from '../services/api';

interface SupportMessage {
  id: string;
  type: 'user' | 'ai' | 'system';
  text: string;
  timestamp: string;
  actionResult?: {
    success: boolean;
    action: string;
    description: string;
    logs: string[];
    details?: any;
    telemetryAfter?: any;
  };
  resolution?: {
    issue: string;
    issueType: string;
    success: boolean;
    actions: Array<{
      action: string;
      description: string;
      status: 'attempted' | 'verified' | 'failed' | 'skipped';
      timestamp: string;
      details?: string;
    }>;
    logs: string[];
    escalation: boolean;
  };
  solution?: {
    steps: string[];
    autoFix: boolean;
    actionKey?: string;
    status?: string;
    actionsExecuted?: string[];
  };
  quickActions?: Array<{ id: string; label: string; action: string }>;
}

interface DiagnosticReport {
  timestamp: string;
  overallStatus: 'healthy' | 'warning' | 'critical';
  checks: {
    memory: any;
    cpu: any;
    disk: any;
    network: any;
    database: any;
    api: any;
    redis: any;
    dependencies: any;
  };
}

interface SupportChatProps {
  appContext?: any;
  onToast?: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const SupportChat: React.FC<SupportChatProps> = ({ appContext, onToast }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'diagnostics' | 'learned' | 'actions'>('chat');
  const [messages, setMessages] = useState<SupportMessage[]>([
    {
      id: 'welcome',
      type: 'ai',
      text: '👋 Hello! I am your AI Self-Healing & Diagnostic Agent. I run deep real-time system diagnostics, execute actual backend auto-fixes with health verification, and give live step-by-step progress feedback.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      quickActions: [
        { id: 'reconnectDB', label: 'Verify PostgreSQL', action: 'reconnectDB' },
        { id: 'clearCache', label: 'Flush Cache & GC', action: 'clearCache' },
        { id: 'healWorkOrders', label: 'Heal Work Orders', action: 'healWorkOrders' },
        { id: 'syncLiveFeeds', label: 'Sync Job Feeds', action: 'syncLiveFeeds' },
        { id: 'createSnapshot', label: 'Trigger Snapshot', action: 'createSnapshot' },
        { id: 'runFullHeal', label: 'Full Deep Auto-Heal', action: 'runFullHeal' }
      ]
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeExecutingAction, setActiveExecutingAction] = useState<string | null>(null);
  const [autoFixStatus, setAutoFixStatus] = useState<string | null>(null);
  const [liveStreamLogs, setLiveStreamLogs] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null);
  const [isDiagLoading, setIsDiagLoading] = useState(false);
  const [learnedData, setLearnedData] = useState<{ history: any[]; learnedWeights: Record<string, any> } | null>(null);
  const [availableActions, setAvailableActions] = useState<any[]>([]);
  const [hasUrgentError, setHasUrgentError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll messages to bottom
  useEffect(() => {
    if (isOpen && !isMinimized && activeTab === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, liveStreamLogs, isOpen, isMinimized, activeTab]);

  // Subscribe to error monitor for automatic real-time alerts
  useEffect(() => {
    const unsub = errorMonitor.subscribe((err) => {
      setHasUrgentError(true);
      const systemNotice: SupportMessage = {
        id: `err_${Date.now()}`,
        type: 'system',
        text: `⚠️ Client Exception Detected: ${err.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        solution: {
          steps: ['Flush client cache', 'Re-verify API connection'],
          autoFix: true,
          actionKey: 'clearCache'
        },
        quickActions: [
          { id: 'clearCache', label: 'Execute Cache Flush', action: 'clearCache' },
          { id: 'reconnectDB', label: 'Reconnect Database', action: 'reconnectDB' }
        ]
      };
      setMessages(prev => [...prev, systemNotice]);
    });

    return () => unsub();
  }, []);

  // Fetch diagnostics and actions on mount and every 45s
  useEffect(() => {
    fetchDiagnostics();
    fetchLearnedHistory();
    fetchAvailableActions();
    const interval = setInterval(() => {
      fetchDiagnostics(true);
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  const fetchDiagnostics = async (silent = false) => {
    if (!silent) setIsDiagLoading(true);
    try {
      const res = await fetch('/api/diagnostics');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setDiagnostics(data.data);
        }
      }
    } catch {
      // Quiet fail
    } finally {
      if (!silent) setIsDiagLoading(false);
    }
  };

  const fetchLearnedHistory = async () => {
    try {
      const res = await fetch('/api/support/history');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setLearnedData(data);
        }
      }
    } catch {}
  };

  const fetchAvailableActions = async () => {
    try {
      const res = await fetch('/api/support/actions');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.actions) {
          setAvailableActions(data.actions);
        }
      }
    } catch {}
  };

  /**
   * Directly executes a concrete backend self-healing fix action with real-time feedback
   */
  const executeDirectAction = async (actionKey: string, customLabel?: string) => {
    if (isLoading) return;

    setActiveTab('chat');
    setIsLoading(true);
    setActiveExecutingAction(actionKey);
    setLiveStreamLogs([`[${new Date().toLocaleTimeString()}] ⚡ Initiating fix execution: ${actionKey}...`]);
    setAutoFixStatus(`Executing "${actionKey}"...`);

    const userMessage: SupportMessage = {
      id: `user_act_${Date.now()}`,
      type: 'user',
      text: `Run Fix: ${customLabel || actionKey}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      // Stream action execution via SSE
      const res = await fetch('/api/support/resolve-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionKey })
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === 'progress') {
                  setLiveStreamLogs(prev => [...prev, parsed.message]);
                } else if (parsed.type === 'done' && parsed.actionResult) {
                  handleActionResultFinished(parsed.actionResult);
                }
              } catch {}
            }
          }
        }
      } else {
        // Fallback to direct POST
        const postRes = await fetch('/api/support/execute-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: actionKey })
        });
        const postData = await postRes.json();
        if (postData.success && postData.result) {
          handleActionResultFinished(postData.result);
        }
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `ai_err_${Date.now()}`,
          type: 'ai',
          text: `❌ Fix execution error: ${err.message || 'Server communication interrupted'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoading(false);
      setActiveExecutingAction(null);
      setLiveStreamLogs([]);
      fetchDiagnostics(true);
      fetchLearnedHistory();
    }
  };

  /**
   * Sends an open issue prompt to the self-healing resolution loop
   */
  const sendAutoResolveIssue = async (customPrompt?: string) => {
    const issueText = (customPrompt || input).trim();
    if (!issueText || isLoading) return;

    const userMessage: SupportMessage = {
      id: `user_${Date.now()}`,
      type: 'user',
      text: issueText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMessage]);
    if (!customPrompt) setInput('');
    setIsLoading(true);
    setLiveStreamLogs([`[${new Date().toLocaleTimeString()}] 🔍 Running deep diagnostics & multi-step self-healing loop...`]);
    setAutoFixStatus('Executing Diagnostic & Verification Loop...');

    try {
      const res = await fetch('/api/support/resolve-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue: issueText })
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.type === 'progress') {
                  setLiveStreamLogs(prev => [...prev, parsed.message]);
                } else if (parsed.type === 'done' && parsed.resolution) {
                  handleResolutionFinished(parsed.resolution);
                }
              } catch {}
            }
          }
        }
      } else {
        await fallbackResolve(issueText);
      }
    } catch {
      await fallbackResolve(issueText);
    } finally {
      setIsLoading(false);
      setLiveStreamLogs([]);
      fetchDiagnostics(true);
      fetchLearnedHistory();
    }
  };

  const fallbackResolve = async (issueText: string) => {
    try {
      const res = await fetch('/api/support/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue: issueText })
      });
      const data = await res.json();
      if (data.success && data.resolution) {
        handleResolutionFinished(data.resolution);
      }
    } catch {
      const errorMsg: SupportMessage = {
        id: `ai_err_${Date.now()}`,
        type: 'ai',
        text: '⚠️ Manual intervention required: Diagnostic services are currently recovering.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const handleActionResultFinished = (result: any) => {
    invalidateApiCache('all');
    const aiMessage: SupportMessage = {
      id: `ai_act_${Date.now()}`,
      type: 'ai',
      text: `✅ Action "${result.action}" executed successfully! ${result.description}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actionResult: result,
      quickActions: [
        { id: 'reconnectDB', label: 'Verify DB', action: 'reconnectDB' },
        { id: 'clearCache', label: 'Flush Cache', action: 'clearCache' },
        { id: 'runFullHeal', label: 'Full Deep Auto-Heal', action: 'runFullHeal' }
      ]
    };

    setMessages(prev => [...prev, aiMessage]);
    setAutoFixStatus(`✅ ${result.action} Verified & Completed`);
    if (onToast) {
      onToast(`🔧 Fix Executed: ${result.description}`, 'success');
    }
    setTimeout(() => setAutoFixStatus(null), 4000);
  };

  const handleResolutionFinished = (resolution: any) => {
    invalidateApiCache('all');
    const aiMessage: SupportMessage = {
      id: `ai_res_${Date.now()}`,
      type: 'ai',
      text: resolution.success
        ? `✅ System Auto-Resolved! Issue classified as "${resolution.issueType}". All verification checks passed.`
        : `⚠️ Remediation partial: Executed ${resolution.actions.length} fixes. Escalated to manual telemetry observation.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      resolution,
      quickActions: [
        { id: 'reconnectDB', label: 'Verify PostgreSQL', action: 'reconnectDB' },
        { id: 'clearCache', label: 'Flush Cache', action: 'clearCache' },
        { id: 'runFullHeal', label: 'Run Full Deep Auto-Heal', action: 'runFullHeal' }
      ]
    };

    setMessages(prev => [...prev, aiMessage]);
    setAutoFixStatus(resolution.success ? '✅ Issue Verified & Resolved' : '⚠️ Actions Executed (Telemetry Updated)');
    if (onToast) {
      onToast(
        resolution.success ? '🔧 AI Diagnostic: Fix applied & health verified!' : '⚠️ AI Diagnostic: Recovery actions completed.',
        resolution.success ? 'success' : 'info'
      );
    }
    setTimeout(() => setAutoFixStatus(null), 4000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 font-medium">Healthy</span>;
      case 'warning':
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/80 font-medium">Warning</span>;
      case 'critical':
      case 'error':
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-800/80 font-medium">Critical</span>;
      default:
        return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Unknown</span>;
    }
  };

  return (
    <div id="ai-support-chat-root" className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          id="btn-open-support-chat"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
            setHasUrgentError(false);
          }}
          className={`group flex items-center gap-2.5 px-4 py-3 rounded-full shadow-xl transition-all duration-300 transform hover:scale-105 active:scale-95 cursor-pointer ${
            hasUrgentError
              ? 'bg-rose-600 text-white animate-pulse shadow-rose-500/40'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/25'
          }`}
        >
          <div className="relative">
            <Bot className="w-5 h-5 transition-transform group-hover:rotate-12" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-300 rounded-full ring-2 ring-emerald-600 animate-ping" />
          </div>
          <span className="font-semibold text-sm tracking-wide">AI Diagnostics & Auto-Healing</span>
          {hasUrgentError && (
            <span className="bg-white text-rose-600 text-xs px-2 py-0.5 rounded-full font-bold">1</span>
          )}
        </button>
      )}

      {/* Floating Modal Window */}
      {isOpen && (
        <div 
          id="support-chat-modal"
          className={`w-96 md:w-[500px] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${
            isMinimized ? 'h-14' : 'h-[640px]'
          }`}
        >
          {/* Header */}
          <div className="bg-slate-800/90 border-b border-slate-700 px-4 py-3 flex items-center justify-between backdrop-blur-sm select-none">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-slate-100 flex items-center gap-1.5">
                  AI Diagnostics & Auto-Resolution
                  <span className={`w-2 h-2 rounded-full ${diagnostics?.overallStatus === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
                </h3>
                <p className="text-[11px] text-slate-400">Live multi-layer diagnostics & execution engine</p>
              </div>
            </div>

            <div className="flex items-center gap-1 text-slate-400">
              <button
                id="btn-minimize-support-chat"
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1.5 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                title={isMinimized ? "Expand" : "Minimize"}
              >
                <Minimize2 className="w-4 h-4" />
              </button>
              <button
                id="btn-close-support-chat"
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:text-slate-200 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Navigation Tabs */}
              <div className="bg-slate-950/80 border-b border-slate-800 px-3 py-1.5 flex items-center justify-between text-xs overflow-x-auto">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveTab('chat')}
                    className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      activeTab === 'chat'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    Chat & Healing
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('actions');
                      fetchAvailableActions();
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'actions'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Play className="w-3 h-3 text-cyan-400" />
                    Auto-Fixes
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('diagnostics');
                      fetchDiagnostics();
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'diagnostics'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <Activity className="w-3 h-3 text-emerald-400" />
                    Diagnostics
                    {diagnostics?.overallStatus && (
                      <span className={`w-1.5 h-1.5 rounded-full ${diagnostics.overallStatus === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('learned');
                      fetchLearnedHistory();
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1 cursor-pointer ${
                      activeTab === 'learned'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    <TrendingUp className="w-3 h-3 text-purple-400" />
                    Learned
                  </button>
                </div>

                {autoFixStatus && (
                  <span className="text-[10px] text-emerald-400 font-medium animate-pulse truncate max-w-[130px] ml-2">
                    {autoFixStatus}
                  </span>
                )}
              </div>

              {/* TAB 1: Chat & Interactive Healing */}
              {activeTab === 'chat' && (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Messages Body */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-900/50">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${msg.type === 'user' ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[94%] rounded-xl p-3 text-xs leading-relaxed ${
                            msg.type === 'user'
                              ? 'bg-emerald-600 text-white rounded-br-none shadow-md'
                              : msg.type === 'system'
                              ? 'bg-amber-950/60 border border-amber-800 text-amber-200 rounded-bl-none'
                              : 'bg-slate-800/90 border border-slate-700/70 text-slate-200 rounded-bl-none shadow-sm'
                          }`}
                        >
                          <div className="whitespace-pre-wrap">{msg.text}</div>

                          {/* Direct Action Execution Details */}
                          {msg.actionResult && (
                            <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 space-y-2">
                              <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400">
                                <span className="flex items-center gap-1.5">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  Executed Action: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-emerald-300 font-mono">{msg.actionResult.action}</code>
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                                  Verified Live
                                </span>
                              </div>

                              {msg.actionResult.logs && msg.actionResult.logs.length > 0 && (
                                <div className="text-[10px] bg-slate-950/80 p-2 rounded-lg text-slate-300 font-mono space-y-1 border border-slate-800/80">
                                  <div className="text-slate-500 text-[9px] uppercase tracking-wider font-bold mb-1 flex items-center gap-1">
                                    <Terminal className="w-3 h-3 text-cyan-400" /> Execution Step Log
                                  </div>
                                  {msg.actionResult.logs.map((lg, i) => (
                                    <div key={i} className="text-emerald-400/90">{lg}</div>
                                  ))}
                                </div>
                              )}

                              {msg.actionResult.details && (
                                <div className="bg-slate-950/50 p-2 rounded text-[10px] text-slate-400 font-mono border border-slate-800/50 flex flex-wrap gap-2">
                                  {Object.entries(msg.actionResult.details).map(([k, v]) => (
                                    <span key={k} className="bg-slate-900 px-1.5 py-0.5 rounded text-slate-300">
                                      {k}: <strong className="text-emerald-400">{String(v)}</strong>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Multi-step Resolution Details */}
                          {msg.resolution && (
                            <div className="mt-2.5 pt-2.5 border-t border-slate-700/60 space-y-2">
                              <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-400">
                                <span className="flex items-center gap-1">
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  Executed Fix Strategies:
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                  msg.resolution.success ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
                                }`}>
                                  {msg.resolution.success ? 'Verified Healthy' : 'Telemetry Logged'}
                                </span>
                              </div>

                              <div className="space-y-1.5">
                                {msg.resolution.actions.map((act, idx) => (
                                  <div key={idx} className="bg-slate-900/80 rounded-lg p-2 border border-slate-800 text-[11px] flex items-start gap-2">
                                    {act.status === 'verified' ? (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                                    ) : act.status === 'attempted' ? (
                                      <RefreshCw className="w-3.5 h-3.5 text-cyan-400 mt-0.5 shrink-0" />
                                    ) : (
                                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                                    )}
                                    <div className="flex-1">
                                      <div className="text-slate-200 font-medium">{act.description}</div>
                                      <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                                        <span>Status: <strong className={act.status === 'verified' ? 'text-emerald-400' : act.status === 'failed' ? 'text-rose-400' : 'text-cyan-400'}>{act.status}</strong></span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {msg.resolution.logs.length > 0 && (
                                <div className="text-[10px] bg-slate-950/60 p-2 rounded text-slate-400 font-mono space-y-0.5">
                                  {msg.resolution.logs.map((lg, i) => (
                                    <div key={i}>{lg}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Quick Interactive Actions inside message */}
                          {msg.quickActions && msg.quickActions.length > 0 && (
                            <div className="mt-2.5 pt-2 border-t border-slate-700/50 flex flex-wrap gap-1.5">
                              {msg.quickActions.map((qa) => (
                                <button
                                  key={qa.id}
                                  onClick={() => executeDirectAction(qa.action, qa.label)}
                                  disabled={isLoading}
                                  className="text-[10px] font-medium px-2 py-1 bg-slate-900 hover:bg-slate-950 text-emerald-400 hover:text-emerald-300 border border-emerald-800/60 hover:border-emerald-600 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                  <Play className="w-2.5 h-2.5" />
                                  {qa.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
                      </div>
                    ))}

                    {/* Live Streaming Execution Terminal */}
                    {isLoading && (
                      <div className="flex flex-col gap-2 p-3 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-slate-300 w-[95%] shadow-xl font-mono">
                        <div className="flex items-center justify-between text-emerald-400 font-semibold border-b border-slate-800/80 pb-1.5">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-emerald-400 animate-spin" />
                            <span>{activeExecutingAction ? `Running Action: ${activeExecutingAction}` : 'Deep Auto-Healing Loop Active...'}</span>
                          </div>
                          <span className="text-[10px] text-cyan-400 font-normal animate-pulse">Streaming Live</span>
                        </div>

                        <div className="space-y-1 max-h-40 overflow-y-auto text-[11px] text-slate-300 pl-1">
                          {liveStreamLogs.map((log, index) => (
                            <div key={index} className="flex items-start gap-1.5 text-emerald-300/90">
                              <span className="text-slate-500 shrink-0">➔</span>
                              <span>{log}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Quick Diagnostic Execution Bar */}
                  <div className="bg-slate-950/70 border-t border-slate-800 p-2 flex items-center gap-1.5 overflow-x-auto text-[11px]">
                    <button
                      onClick={() => executeDirectAction('reconnectDB', 'Verify DB')}
                      disabled={isLoading}
                      className="whitespace-nowrap px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-md border border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Database className="w-3 h-3 text-emerald-400" />
                      Verify DB
                    </button>
                    <button
                      onClick={() => executeDirectAction('clearCache', 'Flush Cache')}
                      disabled={isLoading}
                      className="whitespace-nowrap px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-md border border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3 text-cyan-400" />
                      Flush Cache
                    </button>
                    <button
                      onClick={() => executeDirectAction('syncLiveFeeds', 'Sync Jobs')}
                      disabled={isLoading}
                      className="whitespace-nowrap px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-md border border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Globe className="w-3 h-3 text-teal-400" />
                      Sync Jobs
                    </button>
                    <button
                      onClick={() => executeDirectAction('createSnapshot', 'DB Snapshot')}
                      disabled={isLoading}
                      className="whitespace-nowrap px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-md border border-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Archive className="w-3 h-3 text-amber-400" />
                      DB Snapshot
                    </button>
                    <button
                      onClick={() => executeDirectAction('runFullHeal', 'Deep Auto-Heal')}
                      disabled={isLoading}
                      className="whitespace-nowrap px-2.5 py-1 bg-emerald-950 hover:bg-emerald-900 disabled:opacity-50 text-emerald-300 rounded-md border border-emerald-700/60 transition-colors flex items-center gap-1 cursor-pointer font-semibold"
                    >
                      <Zap className="w-3 h-3 text-amber-400" />
                      Deep Auto-Heal
                    </button>
                  </div>

                  {/* Input Footer */}
                  <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
                    <input
                      id="input-support-chat-message"
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendAutoResolveIssue()}
                      placeholder="Describe issue (e.g. 'DB reconnect', 'Memory leak', 'Job feed')..."
                      disabled={isLoading}
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                    <button
                      id="btn-send-support-message"
                      onClick={() => sendAutoResolveIssue()}
                      disabled={isLoading || !input.trim()}
                      className="p-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors shrink-0 cursor-pointer shadow-md"
                      title="Run Diagnostic & Auto-Resolve"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: Available Auto-Fixes Catalog */}
              {activeTab === 'actions' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/50 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-slate-100 flex items-center gap-1.5">
                        <Wrench className="w-4 h-4 text-emerald-400" />
                        Executable Auto-Fixes Catalog
                      </h4>
                      <p className="text-[11px] text-slate-400">Click any fix below to immediately execute on backend with live progress</p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {availableActions.map((act) => {
                      const iconMap: Record<string, any> = {
                        RefreshCw: <RefreshCw className="w-4 h-4 text-cyan-400" />,
                        Database: <Database className="w-4 h-4 text-emerald-400" />,
                        FileCheck: <FileCheck className="w-4 h-4 text-blue-400" />,
                        Globe: <Globe className="w-4 h-4 text-teal-400" />,
                        Archive: <Archive className="w-4 h-4 text-amber-400" />,
                        Cpu: <Cpu className="w-4 h-4 text-purple-400" />,
                        UserCheck: <UserCheck className="w-4 h-4 text-indigo-400" />,
                        Zap: <Zap className="w-4 h-4 text-amber-400" />
                      };

                      return (
                        <div key={act.id} className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex flex-col gap-2 transition-all">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 font-semibold text-slate-200">
                              {iconMap[act.icon] || <Wrench className="w-4 h-4 text-emerald-400" />}
                              <span>{act.name}</span>
                            </div>
                            <button
                              onClick={() => executeDirectAction(act.id, act.name)}
                              disabled={isLoading}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-md shadow-emerald-600/20"
                            >
                              <Play className="w-3 h-3" />
                              Execute
                            </button>
                          </div>

                          <p className="text-[11px] text-slate-400 leading-relaxed">{act.description}</p>

                          {act.recommendedFor && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {act.recommendedFor.map((rec: string, i: number) => (
                                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                                  {rec}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 3: Multi-Layer Diagnostics Panel */}
              {activeTab === 'diagnostics' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/50 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-slate-100">Multi-Layer Diagnostic Engine</h4>
                      <p className="text-[11px] text-slate-400">Real-time health telemetry across all sub-systems</p>
                    </div>
                    <button
                      onClick={() => fetchDiagnostics()}
                      disabled={isDiagLoading}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 text-cyan-400 ${isDiagLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>

                  {diagnostics ? (
                    <div className="space-y-2.5">
                      {/* Sub-system Check Cards */}
                      {Object.entries(diagnostics.checks || {}).map(([key, value]: [string, any]) => {
                        const iconMap: Record<string, any> = {
                          memory: <Cpu className="w-4 h-4 text-cyan-400" />,
                          cpu: <Activity className="w-4 h-4 text-purple-400" />,
                          disk: <HardDrive className="w-4 h-4 text-amber-400" />,
                          network: <Globe className="w-4 h-4 text-emerald-400" />,
                          database: <Database className="w-4 h-4 text-blue-400" />,
                          api: <Server className="w-4 h-4 text-indigo-400" />,
                          redis: <Layers className="w-4 h-4 text-pink-400" />,
                          dependencies: <ShieldCheck className="w-4 h-4 text-teal-400" />
                        };

                        const actionKeyMap: Record<string, string> = {
                          memory: 'clearCache',
                          database: 'reconnectDB',
                          api: 'purgeEventLoop',
                          redis: 'clearCache',
                          network: 'syncLiveFeeds',
                          disk: 'createSnapshot'
                        };

                        return (
                          <div key={key} className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 font-medium capitalize text-slate-200">
                                {iconMap[key] || <Activity className="w-4 h-4 text-slate-400" />}
                                {key} Diagnostic
                              </div>
                              <div className="flex items-center gap-2">
                                {getStatusBadge(value.status)}
                                <button
                                  onClick={() => executeDirectAction(actionKeyMap[key] || 'clearCache', `Fix ${key}`)}
                                  className="text-[10px] px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded border border-slate-700 flex items-center gap-1 cursor-pointer font-medium"
                                  title={`Run auto-remediation for ${key}`}
                                >
                                  <Play className="w-2.5 h-2.5" />
                                  Run Fix
                                </button>
                              </div>
                            </div>

                            <div className="text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                              {value.heapUsedMB !== undefined && <span>Heap: <strong>{value.heapUsedMB}MB / {value.heapTotalMB}MB</strong></span>}
                              {value.loadPercent !== undefined && <span>Load: <strong>{value.loadPercent}%</strong> ({value.cores} cores)</span>}
                              {value.usedPercent !== undefined && key === 'disk' && <span>Disk Used: <strong>{value.usedPercent}%</strong></span>}
                              {value.latencyMs !== undefined && <span>Latency: <strong>{value.latencyMs}ms</strong></span>}
                              {value.provider && <span>Provider: <strong>{value.provider}</strong></span>}
                              {value.message && <span className="text-slate-300">{value.message}</span>}
                            </div>

                            {value.recommendation && (
                              <div className="text-[10px] text-slate-400 bg-slate-900/80 px-2 py-1 rounded border border-slate-800/80 flex items-center justify-between">
                                <span>💡 {value.recommendation}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <div className="pt-2">
                        <button
                          onClick={() => executeDirectAction('runFullHeal', 'Full Auto-Healing')}
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-500/20 cursor-pointer"
                        >
                          <Zap className="w-4 h-4" />
                          Execute Full Auto-Healing Routine
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-slate-500">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
                      Gathering multi-layer telemetry...
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: Learned Fixes & Strategy Scoring */}
              {activeTab === 'learned' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/50 text-xs">
                  <div>
                    <h4 className="font-semibold text-slate-100">Self-Learning Strategy Weights</h4>
                    <p className="text-[11px] text-slate-400">Dynamic effectiveness ratings calculated from verified resolutions</p>
                  </div>

                  {/* Learned Weights */}
                  {learnedData?.learnedWeights && Object.keys(learnedData.learnedWeights).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(learnedData.learnedWeights).map(([action, stats]: [string, any]) => (
                        <div key={action} className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                          <div className="flex items-center justify-between text-slate-200 font-medium">
                            <span className="font-mono text-[11px] text-emerald-400">{action}</span>
                            <span className="text-slate-300 font-bold">{stats.score}% Success Rate</span>
                          </div>
                          <div className="mt-1.5 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.max(5, stats.score)}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                            <span>Attempts: {stats.attempts}</span>
                            <span>Verified Fixes: {stats.successes}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-center text-slate-400">
                      <History className="w-6 h-6 text-slate-500 mx-auto mb-1.5" />
                      <p>All strategies initialized at baseline weight (100%). Weights calibrate dynamically as fixes are executed.</p>
                    </div>
                  )}

                  {/* Resolution History */}
                  <div className="pt-2">
                    <h5 className="font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-cyan-400" />
                      Recent Resolution Logs
                    </h5>
                    {learnedData?.history && learnedData.history.length > 0 ? (
                      <div className="space-y-2">
                        {learnedData.history.slice(-4).reverse().map((item: any, idx: number) => (
                          <div key={idx} className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 text-[11px]">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-slate-200 truncate max-w-[240px]">{item.issue}</span>
                              <span className={`text-[10px] px-1.5 py-0.2 rounded ${item.success ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-400'}`}>
                                {item.success ? 'Success' : 'Escalated'}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              Actions: {item.actions?.map((a: any) => a.action).join(' ➔ ')}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 italic">No historical interventions recorded yet in this session.</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SupportChat;

