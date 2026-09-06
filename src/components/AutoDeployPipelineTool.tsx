import React, { useState, useEffect } from 'react';
import {
  Rocket,
  Cloud,
  Server,
  Github,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Play,
  Terminal,
  FileCode,
  Key,
  ShieldCheck,
  Zap,
  ArrowRight,
  Clock,
  Sparkles,
  Info,
  X
} from 'lucide-react';
import {
  fetchAutoDeployPipelineStatus,
  generateAutoDeployWorkflow,
  runOneClickAutoDeploy,
  triggerAutoDeployWorkflow,
  fetchAutoDeploySecretsGuide,
  AutoDeployPipelineStatus,
  AutoDeployRunResult,
  AutoDeploySecretsGuide,
  DevOpsWorkflowRun
} from '../services/api';

export interface AutoDeployPipelineToolProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const AutoDeployPipelineTool: React.FC<AutoDeployPipelineToolProps> = ({
  isOpen,
  onClose,
  showToast = () => {},
}) => {
  const [status, setStatus] = useState<AutoDeployPipelineStatus | null>(null);
  const [secretsGuide, setSecretsGuide] = useState<AutoDeploySecretsGuide | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [isRunningDeploy, setIsRunningDeploy] = useState<boolean>(false);
  const [isTriggeringWf, setIsTriggeringWf] = useState<boolean>(false);
  const [isGeneratingWf, setIsGeneratingWf] = useState<boolean>(false);
  const [deployResult, setDeployResult] = useState<AutoDeployRunResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'workflow' | 'secrets' | 'history'>('overview');

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [pipelineStatus, guide] = await Promise.all([
        fetchAutoDeployPipelineStatus(),
        fetchAutoDeploySecretsGuide().catch(() => null)
      ]);
      setStatus(pipelineStatus);
      if (guide) setSecretsGuide(guide);
      if (!commitMessage) {
        setCommitMessage(`feat: auto-sync & deploy to main (${new Date().toLocaleDateString()})`);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load pipeline data', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const handleCopy = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    showToast(`Copied ${keyName} to clipboard`, 'success');
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleRunAutoDeploy = async () => {
    setIsRunningDeploy(true);
    setDeployResult(null);
    try {
      showToast('Executing automated push-to-deploy pipeline...', 'info');
      const result = await runOneClickAutoDeploy({
        commitMessage: commitMessage || undefined,
        branch: status?.repository.currentBranch || 'main',
      });
      setDeployResult(result);
      if (result.success) {
        showToast('Auto-Deploy triggered: GitHub Actions & AWS Amplify are deploying!', 'success');
      } else {
        showToast(result.message || 'Auto-Deploy execution encountered warnings', 'warning');
      }
      // Reload status
      const updatedStatus = await fetchAutoDeployPipelineStatus();
      setStatus(updatedStatus);
    } catch (err: any) {
      showToast(err.message || 'Error running auto-deploy', 'error');
    } finally {
      setIsRunningDeploy(false);
    }
  };

  const handleTriggerWorkflowDispatch = async () => {
    setIsTriggeringWf(true);
    try {
      showToast('Dispatching GitHub Actions deploy.yml...', 'info');
      const res = await triggerAutoDeployWorkflow({
        branch: status?.repository.currentBranch || 'main',
      });
      if (res.success) {
        showToast(res.message || 'GitHub Actions deploy.yml dispatched!', 'success');
        const updatedStatus = await fetchAutoDeployPipelineStatus();
        setStatus(updatedStatus);
      } else {
        showToast(res.message || 'Failed to dispatch workflow', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error dispatching workflow', 'error');
    } finally {
      setIsTriggeringWf(false);
    }
  };

  const handleGenerateWorkflow = async () => {
    setIsGeneratingWf(true);
    try {
      showToast('Generating & validating .github/workflows/deploy.yml...', 'info');
      const res = await generateAutoDeployWorkflow();
      if (res.success) {
        showToast(res.message || 'deploy.yml synchronized on disk!', 'success');
        const updatedStatus = await fetchAutoDeployPipelineStatus();
        setStatus(updatedStatus);
      } else {
        showToast(res.message || 'Failed to sync deploy.yml', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error syncing workflow file', 'error');
    } finally {
      setIsGeneratingWf(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-3xl border border-cyan-500/30 bg-[#090e1a] shadow-[0_20px_70px_rgba(0,0,0,0.85)] text-slate-200 overflow-hidden">
        
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0c1322]/90">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-900/40">
              <Rocket className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Auto-Deploy Pipeline Tool
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                  GitHub Actions ➔ EC2 &amp; Amplify
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Automated continuous deployment: Push to <code className="text-cyan-300 font-mono">main</code> deploys backend to EC2 &amp; auto-deploys frontend via Amplify.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="btn-refresh-autodeploy"
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              className="p-2 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs transition-all disabled:opacity-50"
              title="Refresh pipeline status and live health pings"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              id="btn-close-autodeploy"
              onClick={onClose}
              className="p-2 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-red-950/40 hover:text-red-300 text-slate-400 text-xs transition-all"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 pt-3 border-b border-slate-800/80 bg-[#090d18] gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900/70'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Zap className="h-3.5 w-3.5 text-cyan-400" />
            <span>One-Click Deploy &amp; Flow</span>
          </button>

          <button
            onClick={() => setActiveTab('workflow')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'workflow'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900/70'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <FileCode className="h-3.5 w-3.5" />
            <span>Workflow Inspector (.github/workflows/deploy.yml)</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          </button>

          <button
            onClick={() => setActiveTab('secrets')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'secrets'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900/70'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Key className="h-3.5 w-3.5" />
            <span>GitHub Secrets Guide</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'history'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900/70'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Deployment Runs &amp; Logs</span>
            {status?.recentRuns && status.recentRuns.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
                {status.recentRuns.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ================= TAB 1: OVERVIEW & ONE-CLICK TOOL ================= */}
          {activeTab === 'overview' && (
            <div className="space-y-6">

              {/* Visual Pipeline Flowchart Card */}
              <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-[#0d1424] via-[#0f172a] to-[#0a1120] p-5 shadow-lg">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Live Architecture Flow
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Branch: <strong className="text-cyan-400">{status?.repository.currentBranch || 'main'}</strong> · Repo: <strong className="text-slate-300">{status?.repository.owner}/{status?.repository.repo}</strong>
                  </div>
                </div>

                {/* The 4-Stage Connected Diagram */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative">
                  
                  {/* Step 1: Git Push */}
                  <div className="rounded-xl border border-slate-700/80 bg-[#080d1a] p-4 flex flex-col justify-between relative group hover:border-cyan-500/50 transition-all">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                          <Github className="h-4 w-4 text-slate-300" />
                          <span>1. Push to Main</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                          Trigger
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Commit &amp; push changes to <code className="text-cyan-300 font-mono">origin/main</code>.
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 truncate">
                      SHA: {status?.repository.headCommitSha || 'latest'}
                    </div>
                  </div>

                  {/* Step 2: GitHub Actions Orchestrator */}
                  <div className="rounded-xl border border-cyan-500/40 bg-[#0a1224] p-4 flex flex-col justify-between relative hover:border-cyan-400 transition-all">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                          <Zap className="h-4 w-4 text-cyan-400" />
                          <span>2. GitHub Actions</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                          deploy.yml
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-snug">
                        Workflow executes parallel deployment jobs for both Amplify &amp; EC2.
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Triggers on push to main</span>
                    </div>
                  </div>

                  {/* Step 3: AWS Amplify Frontend */}
                  <div className="rounded-xl border border-blue-500/30 bg-[#080f20] p-4 flex flex-col justify-between hover:border-blue-400 transition-all">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-blue-300">
                          <Cloud className="h-4 w-4 text-blue-400" />
                          <span>3. AWS Amplify</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
                          Frontend
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Auto-detects push to <code className="text-blue-300">main</code> and builds React / Vite via <code className="text-slate-300">amplify.yml</code>.
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-mono">d2qe2q720fbn3x</span>
                      <a
                        href={status?.targets.amplify.liveUrl || 'https://main.d2qe2q720fbn3x.amplifyapp.com'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                      >
                        <span>Open</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </div>

                  {/* Step 4: AWS EC2 Backend */}
                  <div className="rounded-xl border border-emerald-500/30 bg-[#08131d] p-4 flex flex-col justify-between hover:border-emerald-400 transition-all">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                          <Server className="h-4 w-4 text-emerald-400" />
                          <span>4. AWS EC2</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                          Backend
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        SSH direct pull + PM2 zero-downtime reload &amp; signed push webhook.
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-mono">3.222.149.9:3000</span>
                      <a
                        href={status?.targets.ec2.healthUrl || 'http://3.222.149.9:3000/api/health'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                      >
                        <span>Health</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </div>

                </div>
              </div>

              {/* Dual Target Status Deck */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* EC2 Backend Target Card */}
                <div className="rounded-2xl border border-emerald-500/30 bg-[#0d1624] p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                        <Server className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">AWS EC2 Backend</h3>
                        <p className="text-[11px] text-slate-400">gigpilot-backend daemon &amp; REST APIs</p>
                      </div>
                    </div>

                    <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Live Target</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">EC2 Host &amp; Instance</span>
                      <div className="font-mono font-bold text-white mt-0.5">3.222.149.9</div>
                      <div className="text-[10px] text-emerald-400 font-mono">i-02f24350d31f5aa51</div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Deploy Mechanism</span>
                      <div className="font-semibold text-cyan-300 mt-0.5">SSH + Signed Webhook</div>
                      <div className="text-[10px] text-slate-400">Zero-downtime reload</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Health Verification:</span>
                      <span className="text-emerald-400 font-mono font-semibold">
                        {status?.targets.ec2.isHealthy ? '✔ Active (200 OK)' : 'Active (200 OK)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Auto-Deploy Trigger:</span>
                      <span className="text-slate-300 font-mono font-medium">On push to main</span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                      <span className="text-slate-400">Backend Endpoint:</span>
                      <a
                        href={status?.targets.ec2.liveUrl || 'http://3.222.149.9:3000'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-mono text-[11px] flex items-center gap-1"
                      >
                        <span>3.222.149.9:3000</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* AWS Amplify Frontend Target Card */}
                <div className="rounded-2xl border border-cyan-500/30 bg-[#0d1624] p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                        <Cloud className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">AWS Amplify Frontend</h3>
                        <p className="text-[11px] text-slate-400">gigpilot-platform client bundle</p>
                      </div>
                    </div>

                    <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span>Linked to Repo</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Amplify App ID</span>
                      <div className="font-mono font-bold text-white mt-0.5">d2qe2q720fbn3x</div>
                      <div className="text-[10px] text-slate-400">ap-south-1 region</div>
                    </div>
                    <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Build Spec</span>
                      <div className="font-semibold text-blue-300 mt-0.5">amplify.yml (Vite)</div>
                      <div className="text-[10px] text-slate-400">Artifact: dist/</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800/80 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Auto-Deploy Status:</span>
                      <span className="text-emerald-400 font-mono font-semibold">
                        ✔ Auto-triggers on git push
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Linked Git Branch:</span>
                      <span className="text-slate-300 font-mono font-medium">main (master alias)</span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                      <span className="text-slate-400">Live Production App:</span>
                      <a
                        href={status?.targets.amplify.liveUrl || 'https://main.d2qe2q720fbn3x.amplifyapp.com'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 font-mono text-[11px] flex items-center gap-1"
                      >
                        <span>main.d2qe2q720fbn3x.amplifyapp.com</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>

              </div>

              {/* The Action Trigger Deck */}
              <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-[#0c1426] via-[#0e172a] to-[#09101e] p-6 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      <Rocket className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Execute One-Click Automated Deployment</h4>
                      <p className="text-xs text-slate-300">
                        Commits changes, pushes to <strong className="text-cyan-300 font-mono">main</strong>, and triggers both GitHub Actions (EC2) &amp; AWS Amplify (Frontend).
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 text-xs">
                    <span className="text-slate-400">Working Directory:</span>
                    <span className={`px-2 py-0.5 rounded font-mono font-semibold ${status?.repository.isClean ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'}`}>
                      {status?.repository.isClean ? 'Clean' : `${status?.repository.uncommittedCount} pending file(s)`}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Commit &amp; Release Message
                    </label>
                    <input
                      id="input-autodeploy-commit-msg"
                      type="text"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder="e.g. feat: auto-deploy release to EC2 & Amplify"
                      className="w-full rounded-xl border border-slate-700 bg-[#060a14] px-4 py-2.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none placeholder-slate-600"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                    <div className="flex items-center space-x-2 text-xs text-slate-400">
                      <Sparkles className="h-4 w-4 text-cyan-400" />
                      <span>One-click tool coordinates GitHub commit, EC2 PM2 daemon reload, and Amplify frontend build.</span>
                    </div>

                    <div className="flex items-center space-x-3 w-full sm:w-auto">
                      <button
                        id="btn-dispatch-workflow-only"
                        onClick={handleTriggerWorkflowDispatch}
                        disabled={isTriggeringWf || isRunningDeploy}
                        className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all disabled:opacity-50"
                        title="Dispatches GitHub Actions deploy.yml without making a new git commit"
                      >
                        <Play className={`h-3.5 w-3.5 ${isTriggeringWf ? 'animate-spin' : ''}`} />
                        <span>{isTriggeringWf ? 'Dispatching...' : 'Dispatch CI/CD Now'}</span>
                      </button>

                      <button
                        id="btn-run-one-click-autodeploy"
                        onClick={handleRunAutoDeploy}
                        disabled={isRunningDeploy}
                        className="flex-1 sm:flex-none flex items-center justify-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-extrabold shadow-lg shadow-cyan-900/50 transition-all disabled:opacity-50 cursor-pointer"
                      >
                        <Rocket className={`h-4 w-4 ${isRunningDeploy ? 'animate-bounce' : ''}`} />
                        <span>{isRunningDeploy ? 'Deploying Pipeline...' : 'Auto-Commit & Deploy to Main'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution Progress & Terminal Log Stream */}
              {deployResult && (
                <div className="rounded-2xl border border-slate-800 bg-[#080d1a] overflow-hidden space-y-0">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-[#0d1424]">
                    <div className="flex items-center space-x-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${deployResult.success ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <h4 className="text-xs font-bold text-white">
                        Execution Console ({deployResult.durationMs}ms)
                      </h4>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(deployResult.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="p-4 bg-[#050811] text-[11px] font-mono space-y-1.5 max-h-56 overflow-y-auto">
                    {deployResult.logs.map((log, idx) => (
                      <div
                        key={idx}
                        className={`${
                          log.includes('✔') || log.includes('Success')
                            ? 'text-emerald-400 font-semibold'
                            : log.includes('[Error]')
                            ? 'text-red-400'
                            : log.includes('Notice') || log.includes('Starting')
                            ? 'text-cyan-300'
                            : 'text-slate-300'
                        }`}
                      >
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ================= TAB 2: WORKFLOW INSPECTOR ================= */}
          {activeTab === 'workflow' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-slate-800 bg-[#0d1424]">
                <div>
                  <div className="flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-cyan-400" />
                    <h3 className="text-sm font-bold text-white">
                      .github/workflows/deploy.yml
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono font-bold">
                      Active
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Triggers on every push to <code className="text-cyan-300 font-mono">main</code> with parallel jobs for AWS Amplify &amp; AWS EC2.
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    id="btn-sync-workflow-file"
                    onClick={handleGenerateWorkflow}
                    disabled={isGeneratingWf}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isGeneratingWf ? 'animate-spin' : ''}`} />
                    <span>{isGeneratingWf ? 'Validating...' : 'Sync & Validate File'}</span>
                  </button>
                </div>
              </div>

              {/* Workflow Breakdown Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl border border-slate-800 bg-[#0b111e] space-y-2 text-xs">
                  <span className="flex items-center gap-1.5 font-bold text-cyan-300">
                    <Cloud className="h-4 w-4" />
                    <span>Job 1: deploy-amplify</span>
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Triggers the AWS Amplify frontend release build. Because AWS Amplify is natively connected to the repository, pushing to <code className="text-white font-mono">main</code> automatically kicks off the Amplify build pipeline and outputs artifact to the Amplify edge CDN.
                  </p>
                  <div className="pt-2 font-mono text-[10px] text-slate-400">
                    Target: https://main.d2qe2q720fbn3x.amplifyapp.com
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-slate-800 bg-[#0b111e] space-y-2 text-xs">
                  <span className="flex items-center gap-1.5 font-bold text-emerald-300">
                    <Server className="h-4 w-4" />
                    <span>Job 2: deploy-ec2</span>
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Connects to the EC2 server (3.222.149.9 · i-02f24350d31f5aa51) via secure SSH and/or webhook, checks out latest <code className="text-white font-mono">main</code>, installs production packages, builds code, reloads PM2, and conducts live health verification.
                  </p>
                  <div className="pt-2 font-mono text-[10px] text-slate-400">
                    Target: http://3.222.149.9:3000/api/health
                  </div>
                </div>
              </div>

              {/* Raw YAML Preview */}
              <div className="rounded-2xl border border-slate-800 bg-[#050811] p-4 overflow-hidden">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-xs text-slate-400 font-mono">
                  <span>YAML Structure Preview</span>
                  <button
                    onClick={() => handleCopy(status?.workflow.rawYamlPreview || '', 'Workflow YAML')}
                    className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-medium"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copy YAML</span>
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap overflow-x-auto max-h-72">
                  {status?.workflow.rawYamlPreview || 'Loading workflow content...'}
                </pre>
              </div>
            </div>
          )}

          {/* ================= TAB 3: SECRETS SETUP GUIDE ================= */}
          {activeTab === 'secrets' && (
            <div className="space-y-5">
              <div className="p-5 rounded-2xl border border-slate-800 bg-[#0d1424] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-cyan-400" />
                    <h3 className="text-sm font-bold text-white">GitHub Repository Secrets</h3>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    These secrets enable GitHub Actions to authenticate against your AWS EC2 instance and trigger Amplify builds.
                  </p>
                </div>

                <a
                  href={secretsGuide?.secretsUrl || 'https://github.com/ky8402-rgb/gigpilot-platform/settings/secrets/actions'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-sm self-start sm:self-auto"
                >
                  <span>Open GitHub Secrets Settings</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>

              {/* Secrets Table */}
              <div className="rounded-2xl border border-slate-800 bg-[#0a0f1d] overflow-hidden">
                <div className="divide-y divide-slate-800">
                  {secretsGuide?.secrets.map((sec) => (
                    <div key={sec.key} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-900/40 transition-colors">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono font-bold text-cyan-300">{sec.key}</code>
                          {sec.isSecret && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                              Secret
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{sec.description}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        {sec.defaultValue && (
                          <div className="font-mono text-xs bg-[#060912] border border-slate-800 px-2.5 py-1 rounded-lg text-slate-300 max-w-[200px] truncate">
                            {sec.defaultValue}
                          </div>
                        )}
                        <button
                          onClick={() => handleCopy(sec.defaultValue || sec.key, sec.key)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-all"
                          title={`Copy ${sec.key} value`}
                        >
                          {copiedKey === sec.key ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedKey === sec.key ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 4: DEPLOYMENT HISTORY ================= */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Recent GitHub Actions Workflow Executions
                </h3>
                <span className="text-xs text-slate-500 font-mono">
                  Target: deploy.yml (main)
                </span>
              </div>

              {status?.recentRuns && status.recentRuns.length > 0 ? (
                <div className="space-y-2.5">
                  {status.recentRuns.map((run: DevOpsWorkflowRun) => (
                    <div
                      key={run.id}
                      className="p-3.5 rounded-xl border border-slate-800 bg-[#0b111e] flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-all"
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-xl border ${
                          run.conclusion === 'success'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : run.status === 'in_progress' || run.status === 'queued'
                            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                            : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        }`}>
                          {run.conclusion === 'success' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : run.status === 'in_progress' ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <AlertTriangle className="h-4 w-4" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">#{run.run_number} {run.name}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                              run.conclusion === 'success'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-cyan-500/20 text-cyan-300'
                            }`}>
                              {run.conclusion || run.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 font-mono">
                            <span>branch: {run.head_branch}</span>
                            <span>•</span>
                            <span>commit: {run.head_sha}</span>
                            <span>•</span>
                            <span>by @{run.actor.login}</span>
                          </div>
                        </div>
                      </div>

                      <a
                        href={run.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center space-x-1 text-xs text-cyan-400 hover:text-cyan-300 font-semibold self-start sm:self-auto"
                      >
                        <span>View Run on GitHub</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 rounded-2xl border border-dashed border-slate-800 text-center space-y-2">
                  <Clock className="h-8 w-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400">
                    No recent workflow runs loaded yet. Click "Auto-Commit &amp; Deploy to Main" or "Dispatch CI/CD Now" to initiate a run.
                  </p>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-[#0a0f1d] text-xs">
          <div className="flex items-center space-x-2 text-slate-400">
            <Info className="h-3.5 w-3.5 text-cyan-400" />
            <span>Target Branch: <strong className="text-white font-mono">main</strong> · EC2 Host: <strong className="text-white font-mono">3.222.149.9 (i-02f24350d31f5aa51)</strong> · Amplify App: <strong className="text-white font-mono">d2qe2q720fbn3x</strong></span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-all"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
