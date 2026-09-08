import React, { useState, useEffect } from 'react';
import {
  Key,
  Github,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Trash2,
  Terminal,
  Upload,
  Download,
  AlertTriangle,
  GitBranch,
  GitPullRequest,
  ArrowUpRight,
  ShieldAlert,
  HelpCircle,
  Eye,
  EyeOff,
  Code,
  Webhook,
  Zap,
  Activity,
  Rocket,
  Cloud,
  Server,
  Lock,
  Layers,
  Flame,
  Play
} from 'lucide-react';
import {
  fetchGitHubStatus,
  generateGitHubSSHKey,
  saveGitHubSSHKey,
  deleteGitHubSSHKey,
  configureGitHubRemote,
  testGitHubSSHConnection,
  executeGitOp,
  fetchGitHubWebhookInfo,
  triggerManualDeploy,
  fetchGitHubDeployments,
  fetchGitHubAuthStatus,
  saveGitHubToken,
  deleteGitHubToken,
  triggerPushAndDeploy,
  fetchDevOpsStatus,
  fetchDevOpsRuns,
  triggerDevOpsDeploy,
  DevOpsWorkflow,
  DevOpsWorkflowRun,
  DevOpsDeployResponse,
  GitHubSSHKeyInfo,
  GitHubRepoStatus,
  GitHubSSHTestResult,
  GitOperationClientResult,
  GitHubWebhookInfo,
  PushAndDeployResponse,
  GitHubAuthStatusResponse
} from '../services/api';

export interface GitHubSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  onRemoteConfigured?: (remoteUrl: string) => void;
  onOpenAutoDeploy?: () => void;
}

export const GitHubSettingsModal: React.FC<GitHubSettingsModalProps> = ({
  isOpen,
  onClose,
  showToast = () => {},
  onRemoteConfigured,
  onOpenAutoDeploy
}) => {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'deploy' | 'keys' | 'test' | 'remote' | 'gitops' | 'webhook'>('deploy');

  // Unified Push & Deploy State
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatusResponse | null>(null);
  const [tokenInput, setTokenInput] = useState<string>('');
  const [isSavingToken, setIsSavingToken] = useState<boolean>(false);
  const [isDeletingToken, setIsDeletingToken] = useState<boolean>(false);
  const [commitMessageInput, setCommitMessageInput] = useState<string>('');
  const [isPushAndDeploying, setIsPushAndDeploying] = useState<boolean>(false);
  const [pushAndDeployResult, setPushAndDeployResult] = useState<PushAndDeployResponse | null>(null);
  const [skipAmplify, setSkipAmplify] = useState<boolean>(false);
  const [skipEc2, setSkipEc2] = useState<boolean>(false);

  // DevOps Actions & GitHub Actions Automated Deployments
  const [devOpsWorkflows, setDevOpsWorkflows] = useState<DevOpsWorkflow[]>([]);
  const [devOpsRuns, setDevOpsRuns] = useState<DevOpsWorkflowRun[]>([]);
  const [isTriggeringDevOpsDeploy, setIsTriggeringDevOpsDeploy] = useState<boolean>(false);
  const [devOpsDeployResult, setDevOpsDeployResult] = useState<DevOpsDeployResponse | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('deploy.yml');

  // Loading & Execution States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSavingRemote, setIsSavingRemote] = useState<boolean>(false);
  const [isExecutingGit, setIsExecutingGit] = useState<string | null>(null);

  // Status Data
  const [sshInfo, setSshInfo] = useState<GitHubSSHKeyInfo>({ configured: false });
  const [repoStatus, setRepoStatus] = useState<GitHubRepoStatus>({
    currentBranch: 'main',
    remoteOriginUrl: null,
    isSSHRemote: false,
    userName: 'ky8402',
    userEmail: 'ky8402@gmail.com',
    clean: true,
    uncommittedCount: 0
  });
  const [testResult, setTestResult] = useState<GitHubSSHTestResult | null>(null);
  const [gitOpResult, setGitOpResult] = useState<GitOperationClientResult | null>(null);

  // Webhook & Push-to-Deploy State
  const [webhookInfo, setWebhookInfo] = useState<GitHubWebhookInfo | null>(null);
  const [deployments, setDeployments] = useState<any[]>([]);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [hasCopiedWebhook, setHasCopiedWebhook] = useState<boolean>(false);

  // Key Generation Form State
  const [keyType, setKeyType] = useState<'ed25519' | 'rsa'>('ed25519');
  const [keyComment, setKeyComment] = useState<string>('ky8402@gmail.com');

  // Manual Import Key State
  const [showManualImport, setShowManualImport] = useState<boolean>(false);
  const [manualPrivateKey, setManualPrivateKey] = useState<string>('');
  const [manualPublicKey, setManualPublicKey] = useState<string>('');
  const [showPrivateKeyText, setShowPrivateKeyText] = useState<boolean>(false);

  // Remote URL Configuration State
  const [remoteUrlInput, setRemoteUrlInput] = useState<string>('');
  const [userNameInput, setUserNameInput] = useState<string>('ky8402');
  const [userEmailInput, setUserEmailInput] = useState<string>('ky8402@gmail.com');

  // Copy Clipboard State
  const [hasCopiedPub, setHasCopiedPub] = useState<boolean>(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);
  const [showDetailedGuide, setShowDetailedGuide] = useState<boolean>(true);

  // Load status on open
  useEffect(() => {
    if (isOpen) {
      loadStatus();
      loadWebhookStatus();
    }
  }, [isOpen]);

  const loadWebhookStatus = async () => {
    try {
      const [whData, depData] = await Promise.all([
        fetchGitHubWebhookInfo(),
        fetchGitHubDeployments()
      ]);
      if (whData.success && whData.webhook) {
        setWebhookInfo(whData.webhook);
      }
      if (depData.success && depData.deployments) {
        setDeployments(depData.deployments);
      }
    } catch (err) {
      console.warn('Could not load webhook info:', err);
    }
  };

  const handleTriggerDeploy = async () => {
    setIsDeploying(true);
    try {
      showToast('Initiating zero-downtime deployment...', 'info');
      const res = await triggerManualDeploy(repoStatus.currentBranch || 'master');
      if (res.success) {
        showToast('Deployment completed successfully!', 'success');
        await loadWebhookStatus();
      } else {
        showToast(res.error || 'Deployment failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Deployment execution error', 'error');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleCopyWebhookUrl = () => {
    const url = webhookInfo?.webhookUrl || 'https://3-222-149-9.sslip.io/api/github/webhook';
    navigator.clipboard.writeText(url);
    setHasCopiedWebhook(true);
    showToast('Webhook URL copied to clipboard!', 'success');
    setTimeout(() => setHasCopiedWebhook(false), 2500);
  };

  const loadStatus = async () => {
    setIsLoading(true);
    try {
      const data = await fetchGitHubStatus();
      if (data.success) {
        setSshInfo(data.ssh);
        setRepoStatus(data.repo);
        if (data.repo.remoteOriginUrl) {
          setRemoteUrlInput(data.repo.remoteOriginUrl);
        }
        if (data.repo.userName) setUserNameInput(data.repo.userName);
        if (data.repo.userEmail) setUserEmailInput(data.repo.userEmail);
        if (data.ssh.comment) setKeyComment(data.ssh.comment);
      }

      const [authData, devopsData] = await Promise.all([
        fetchGitHubAuthStatus(),
        fetchDevOpsStatus().catch(() => null)
      ]);
      setAuthStatus(authData);
      if (devopsData && devopsData.success) {
        if (devopsData.workflows?.length) setDevOpsWorkflows(devopsData.workflows);
        if (devopsData.recentRuns?.length) setDevOpsRuns(devopsData.recentRuns);
      }
    } catch (err: any) {
      console.error('Failed to load GitHub status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTriggerDevOpsDeploy = async () => {
    setIsTriggeringDevOpsDeploy(true);
    try {
      showToast('Dispatching GitHub Actions workflow deploy...', 'info');
      const res = await triggerDevOpsDeploy({
        workflowId: selectedWorkflowId,
        branch: repoStatus.currentBranch || 'main',
      });
      setDevOpsDeployResult(res);
      if (res.success) {
        showToast(res.message || 'Deploy workflow dispatched on GitHub Actions!', 'success');
        const updatedRuns = await fetchDevOpsRuns();
        if (updatedRuns.length) setDevOpsRuns(updatedRuns);
      } else {
        showToast(res.message || 'Failed to dispatch deploy workflow', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error triggering deploy workflow', 'error');
    } finally {
      setIsTriggeringDevOpsDeploy(false);
    }
  };

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) {
      showToast('Please enter a GitHub Personal Access Token', 'warning');
      return;
    }
    setIsSavingToken(true);
    try {
      const res = await saveGitHubToken(tokenInput.trim());
      if (res.success) {
        showToast(res.message || 'GitHub Personal Access Token verified and saved!', 'success');
        setTokenInput('');
        const updatedAuth = await fetchGitHubAuthStatus();
        setAuthStatus(updatedAuth);
      } else {
        showToast(res.error || 'Failed to verify GitHub token', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error validating token', 'error');
    } finally {
      setIsSavingToken(false);
    }
  };

  const handleDeleteToken = async () => {
    setIsDeletingToken(true);
    try {
      const res = await deleteGitHubToken();
      if (res.success) {
        showToast('GitHub token removed', 'info');
        const updatedAuth = await fetchGitHubAuthStatus();
        setAuthStatus(updatedAuth);
      } else {
        showToast(res.error || 'Failed to remove token', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error deleting token', 'error');
    } finally {
      setIsDeletingToken(false);
    }
  };

  const handlePushAndDeployAll = async () => {
    setIsPushAndDeploying(true);
    try {
      showToast('Executing unified Push & Deploy pipeline...', 'info');
      const res = await triggerPushAndDeploy({
        commitMessage: commitMessageInput.trim() || undefined,
        branch: repoStatus.currentBranch || 'main',
        skipAmplify,
        skipEc2,
      });
      setPushAndDeployResult(res);
      if (res.success) {
        showToast('Pipeline completed! GitHub pushed and deployments triggered.', 'success');
        await loadStatus();
        await loadWebhookStatus();
      } else {
        showToast(res.error || 'Pipeline finished with alerts (check logs)', 'warning');
      }
    } catch (err: any) {
      showToast(err.message || 'Execution error during push & deploy', 'error');
    } finally {
      setIsPushAndDeploying(false);
    }
  };

  const handleCopyPublicKey = () => {
    if (!sshInfo.publicKey) return;
    navigator.clipboard.writeText(sshInfo.publicKey);
    setHasCopiedPub(true);
    showToast('Public SSH key copied to clipboard!', 'success');
    setTimeout(() => setHasCopiedPub(false), 2500);
  };

  const handleDownloadPublicKey = () => {
    if (!sshInfo.publicKey) return;
    const blob = new Blob([sshInfo.publicKey + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sshInfo.keyType || 'id_ed25519'}.pub`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded public SSH key file', 'info');
  };

  const handleGenerateKey = async () => {
    setIsGenerating(true);
    try {
      const res = await generateGitHubSSHKey(keyType, keyComment);
      if (res.success && res.key) {
        setSshInfo({
          configured: true,
          keyType: res.key.keyType as any,
          publicKey: res.key.publicKey,
          fingerprint: res.key.fingerprint,
          comment: res.key.comment,
          createdAt: new Date().toISOString()
        });
        if (res.repo) setRepoStatus(res.repo);
        showToast(`Successfully generated modern ${res.key.keyType.toUpperCase()} SSH key!`, 'success');
      } else {
        showToast(res.error || 'Failed to generate SSH key', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error during key generation', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveManualKey = async () => {
    if (!manualPrivateKey.trim()) {
      showToast('Please paste your private key', 'warning');
      return;
    }
    setIsGenerating(true);
    try {
      const res = await saveGitHubSSHKey(manualPrivateKey, manualPublicKey, keyType, keyComment);
      if (res.success && res.key) {
        setSshInfo({
          configured: true,
          keyType: res.key.keyType as any,
          publicKey: res.key.publicKey,
          fingerprint: res.key.fingerprint,
          comment: keyComment,
          createdAt: new Date().toISOString()
        });
        if (res.repo) setRepoStatus(res.repo);
        setManualPrivateKey('');
        setManualPublicKey('');
        setShowManualImport(false);
        showToast('SSH key saved securely and configured!', 'success');
      } else {
        showToast(res.error || 'Failed to save private key', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Invalid key format', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteKey = async () => {
    try {
      const res = await deleteGitHubSSHKey();
      if (res.success) {
        setSshInfo({ configured: false });
        setTestResult(null);
        setDeleteConfirmOpen(false);
        showToast('Configured SSH keys removed.', 'info');
      } else {
        showToast(res.error || 'Failed to delete key', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error deleting key', 'error');
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      const res = await testGitHubSSHConnection();
      setTestResult(res.result);
      if (res.result.authenticated) {
        showToast(`SSH Handshake Success! Authenticated as @${res.result.username}`, 'success');
      } else {
        showToast(res.result.message || 'SSH authentication required on GitHub', 'warning');
      }
    } catch (err: any) {
      showToast('Error testing connection', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveRemote = async () => {
    if (!remoteUrlInput.trim()) {
      showToast('Please specify a remote URL', 'warning');
      return;
    }
    setIsSavingRemote(true);
    try {
      const res = await configureGitHubRemote(remoteUrlInput, userNameInput, userEmailInput);
      if (res.success && res.config) {
        setRepoStatus(prev => ({
          ...prev,
          remoteOriginUrl: res.config!.remoteOriginUrl,
          isSSHRemote: res.config!.isSSHRemote,
          userName: res.config!.userName,
          userEmail: res.config!.userEmail
        }));
        if (onRemoteConfigured) {
          onRemoteConfigured(res.config.remoteOriginUrl);
        }
        showToast('Git remote origin and user identity saved!', 'success');
      } else {
        showToast(res.error || 'Failed to configure remote URL', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error saving remote URL', 'error');
    } finally {
      setIsSavingRemote(false);
    }
  };

  const handleExecuteGit = async (op: 'status' | 'fetch' | 'pull' | 'push') => {
    setIsExecutingGit(op);
    try {
      const res = await executeGitOp(op, repoStatus.currentBranch || 'main', 'origin');
      setGitOpResult(res.result);
      if (res.repo) setRepoStatus(res.repo);
      if (res.success) {
        showToast(`Git ${op.toUpperCase()} completed successfully!`, 'success');
      } else {
        showToast(`Git ${op} returned notice or error`, 'warning');
      }
    } catch (err: any) {
      showToast(`Error running git ${op}: ${err.message}`, 'error');
    } finally {
      setIsExecutingGit(null);
    }
  };

  // Convert HTTPS URL to SSH URL helper
  const handleConvertToSSH = () => {
    let url = remoteUrlInput.trim();
    if (url.startsWith('https://github.com/')) {
      const path = url.replace('https://github.com/', '');
      const cleanPath = path.endsWith('.git') ? path : `${path}.git`;
      setRemoteUrlInput(`git@github.com:${cleanPath}`);
      showToast('Converted to authenticated SSH format (git@github.com:...)', 'info');
    } else if (!url.includes('@') && url.includes('/')) {
      const clean = url.replace(/^github\.com\//, '');
      setRemoteUrlInput(`git@github.com:${clean.endsWith('.git') ? clean : clean + '.git'}`);
      showToast('Formatted as SSH remote', 'info');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="github-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#0b101d] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0e1424]">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-900 to-slate-800 border border-slate-700 shadow-md">
              <Github className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  GitHub Integration &amp; SSH Authentication
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  {sshInfo.configured ? 'SSH Active' : 'Setup Required'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Securely store SSH keys, authenticate with GitHub, and configure push/pull operations
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {onOpenAutoDeploy && (
              <button
                id="btn-modal-open-autodeploy"
                onClick={() => {
                  onClose();
                  onOpenAutoDeploy();
                }}
                className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 font-bold text-xs shadow-sm transition-all"
                title="Open dedicated Auto-Deploy Pipeline Tool for EC2 & Amplify"
              >
                <Rocket className="h-3.5 w-3.5 text-cyan-400" />
                <span>Auto-Deploy Tool</span>
              </button>
            )}

            <button
              id="btn-header-deploy"
              onClick={handleTriggerDevOpsDeploy}
              disabled={isTriggeringDevOpsDeploy}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
              title="Deploy to AWS Amplify & EC2 via GitHub Actions"
            >
              <Play className={`h-3.5 w-3.5 fill-current ${isTriggeringDevOpsDeploy ? 'animate-spin' : ''}`} />
              <span>{isTriggeringDevOpsDeploy ? 'Deploying...' : 'Deploy'}</span>
            </button>

            <button
              id="btn-close-github-modal"
              onClick={onClose}
              className="rounded-full p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              title="Close modal (Esc)"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1 px-6 pt-3 pb-0 border-b border-slate-800/80 bg-[#0e1424]/60 overflow-x-auto">
          <button
            id="tab-btn-push-deploy"
            onClick={() => {
              setActiveTab('deploy');
              loadStatus();
              loadWebhookStatus();
            }}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'deploy'
                ? 'border-cyan-400 text-cyan-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Rocket className="h-3.5 w-3.5 text-cyan-400" />
            <span>Push &amp; Auto-Deploy</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/20 text-cyan-300 font-mono">
              Amplify + EC2
            </span>
          </button>

          <button
            id="tab-btn-ssh-keys"
            onClick={() => setActiveTab('keys')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'keys'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Key className="h-3.5 w-3.5" />
            <span>SSH Keys &amp; Pair</span>
          </button>

          <button
            id="tab-btn-ssh-test"
            onClick={() => {
              setActiveTab('test');
              if (!testResult && sshInfo.configured) {
                handleTestConnection();
              }
            }}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'test'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Handshake Diagnostic</span>
            {testResult?.authenticated && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          <button
            id="tab-btn-ssh-remote"
            onClick={() => setActiveTab('remote')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'remote'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>Remote &amp; Git Identity</span>
          </button>

          <button
            id="tab-btn-ssh-gitops"
            onClick={() => setActiveTab('gitops')}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'gitops'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Push &amp; Pull Terminal</span>
          </button>

          <button
            id="tab-btn-ssh-webhook"
            onClick={() => {
              setActiveTab('webhook');
              loadWebhookStatus();
            }}
            className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 transition-all whitespace-nowrap ${
              activeTab === 'webhook'
                ? 'border-emerald-400 text-emerald-300 bg-slate-900/60'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/30'
            }`}
          >
            <Webhook className="h-3.5 w-3.5" />
            <span>Push-to-Deploy Webhook</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-mono">
              Auto
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ================= TAB 0: UNIFIED PUSH & AUTO-DEPLOY ================= */}
          {activeTab === 'deploy' && (
            <div className="space-y-6">

              {/* Pipeline Hero Diagram */}
              <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/40 via-slate-900/80 to-blue-950/30 p-5 shadow-lg">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                        <Rocket className="h-5 w-5" />
                      </span>
                      <h3 className="text-base font-bold text-white tracking-tight">
                        Unified Push-to-Deploy Automation Pipeline
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        Live Multi-Target
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                      Pushing to GitHub triggers automated continuous deployment to both your <strong className="text-white">AWS Amplify Frontend</strong> (<code className="text-cyan-300 font-mono">gigpilot-platform</code>) and your <strong className="text-white">AWS EC2 Backend</strong> (<code className="text-cyan-300 font-mono">gigpilot-backend</code>) with zero downtime.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 self-start md:self-auto">
                    <button
                      id="btn-deploy-pipeline-run"
                      onClick={handlePushAndDeployAll}
                      disabled={isPushAndDeploying}
                      className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-cyan-950/50 transition-all disabled:opacity-50"
                    >
                      <Rocket className={`h-4 w-4 ${isPushAndDeploying ? 'animate-bounce' : ''}`} />
                      <span>{isPushAndDeploying ? 'Deploying Pipeline...' : 'Push & Deploy to All'}</span>
                    </button>
                  </div>
                </div>

                {/* 3-Step Flow Pipeline Display */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5 pt-4 border-t border-slate-800/80">
                  {/* Step 1: GitHub */}
                  <div className="rounded-xl border border-slate-800 bg-[#0c1220]/80 p-3.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center space-x-1.5 text-xs font-bold text-white">
                        <Github className="h-4 w-4 text-slate-300" />
                        <span>1. GitHub Push</span>
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${authStatus?.canPush ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'}`}>
                        {authStatus?.canPush ? 'Auth Ready' : 'Needs Token/SSH'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      origin/{repoStatus.currentBranch || 'main'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      Target: ky8402-rgb/gigpilot-platform
                    </div>
                  </div>

                  {/* Step 2: AWS Amplify */}
                  <div className="rounded-xl border border-slate-800 bg-[#0c1220]/80 p-3.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center space-x-1.5 text-xs font-bold text-white">
                        <Cloud className="h-4 w-4 text-cyan-400" />
                        <span>2. AWS Amplify (Frontend)</span>
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                        gigpilot-platform
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      App ID: d2qe2q720fbn3x
                    </div>
                    <a
                      href="https://main.d2qe2q720fbn3x.amplifyapp.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 mt-1"
                    >
                      <span>Open Live Frontend</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  {/* Step 3: AWS EC2 */}
                  <div className="rounded-xl border border-slate-800 bg-[#0c1220]/80 p-3.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center space-x-1.5 text-xs font-bold text-white">
                        <Server className="h-4 w-4 text-emerald-400" />
                        <span>3. AWS EC2 (Backend)</span>
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        gigpilot-backend
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      Host: 3.222.149.9 (i-02f24350d31f5aa51)
                    </div>
                    <a
                      href="https://3-222-149-9.sslip.io/api/health"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 mt-1"
                    >
                      <span>Verify API Health</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>

              {/* GitHub Authentication Manager Card */}
              <div className="rounded-2xl border border-slate-800 bg-[#0f1629] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700">
                      <Lock className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">GitHub Authentication</h4>
                      <p className="text-xs text-slate-400">
                        Provide a GitHub Personal Access Token (PAT) or use your SSH key for authenticated push operations.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {authStatus?.tokenConfigured ? (
                      <span className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Token Connected {authStatus.tokenUser?.login ? `(@${authStatus.tokenUser.login})` : ''}</span>
                      </span>
                    ) : authStatus?.sshConfigured ? (
                      <span className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>SSH Key Active</span>
                      </span>
                    ) : (
                      <span className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>Auth Token Required</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Token Configuration Box */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="md:col-span-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        GitHub Personal Access Token (PAT)
                      </label>
                      <a
                        href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=GigPilot+Automated+Deployment"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium"
                      >
                        <span>Generate Token on GitHub</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <input
                      id="input-github-pat"
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder={authStatus?.tokenConfigured ? '••••••••••••••••••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                      className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3.5 py-2.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                    />
                    <p className="text-[11px] text-slate-500">
                      Requires <code className="text-cyan-300 font-mono">repo</code> scope to allow git push to <code className="text-slate-300 font-mono">ky8402-rgb/gigpilot-platform</code>.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      id="btn-save-github-token"
                      onClick={handleSaveToken}
                      disabled={isSavingToken || !tokenInput.trim()}
                      className="flex-1 flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-sm"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{isSavingToken ? 'Verifying...' : 'Save & Verify Token'}</span>
                    </button>

                    {authStatus?.tokenConfigured && (
                      <button
                        id="btn-delete-github-token"
                        onClick={handleDeleteToken}
                        disabled={isDeletingToken}
                        className="px-3 py-2.5 rounded-xl border border-red-500/30 bg-red-950/20 hover:bg-red-900/30 text-red-400 text-xs font-semibold transition-all"
                        title="Remove saved GitHub token"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Commit & Push Pipeline Trigger Card */}
              <div className="rounded-2xl border border-slate-800 bg-[#0f1629] p-5 space-y-4">
                <div className="flex items-center space-x-2 pb-2 border-b border-slate-800/80">
                  <Terminal className="h-4 w-4 text-cyan-400" />
                  <h4 className="text-sm font-bold text-white">Trigger Push &amp; Deployment Execution</h4>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Commit Message
                    </label>
                    <input
                      id="input-commit-msg"
                      type="text"
                      value={commitMessageInput}
                      onChange={(e) => setCommitMessageInput(e.target.value)}
                      placeholder={`feat: sync changes to Amplify & EC2 (${new Date().toLocaleDateString()})`}
                      className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3.5 py-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  {/* Deployment Targets Toggles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <label className="flex items-center space-x-2.5 p-3 rounded-xl border border-slate-800 bg-[#090e1a] cursor-pointer hover:border-slate-700 transition-all">
                      <input
                        type="checkbox"
                        checked={!skipAmplify}
                        onChange={(e) => setSkipAmplify(!e.target.checked)}
                        className="rounded border-slate-700 text-cyan-500 focus:ring-0 h-4 w-4"
                      />
                      <div className="text-xs">
                        <span className="font-semibold text-white block">Auto-Deploy AWS Amplify</span>
                        <span className="text-slate-400 text-[11px]">Frontend (gigpilot-platform)</span>
                      </div>
                    </label>

                    <label className="flex items-center space-x-2.5 p-3 rounded-xl border border-slate-800 bg-[#090e1a] cursor-pointer hover:border-slate-700 transition-all">
                      <input
                        type="checkbox"
                        checked={!skipEc2}
                        onChange={(e) => setSkipEc2(!e.target.checked)}
                        className="rounded border-slate-700 text-emerald-500 focus:ring-0 h-4 w-4"
                      />
                      <div className="text-xs">
                        <span className="font-semibold text-white block">Auto-Deploy AWS EC2</span>
                        <span className="text-slate-400 text-[11px]">Backend (gigpilot-backend)</span>
                      </div>
                    </label>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                    <div className="text-xs text-slate-400 flex items-center space-x-2">
                      <span>Working Tree:</span>
                      <span className={repoStatus.clean ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                        {repoStatus.clean ? 'Clean' : `${repoStatus.uncommittedCount} modified file(s) will be auto-staged & committed`}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto">
                      <button
                        id="btn-devops-trigger-deploy"
                        onClick={handleTriggerDevOpsDeploy}
                        disabled={isTriggeringDevOpsDeploy}
                        className="w-full sm:w-auto flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-xs shadow-lg transition-all disabled:opacity-50"
                        title="Trigger GitHub Actions deployment workflow (deploy.yml)"
                      >
                        <Play className={`h-4 w-4 fill-current ${isTriggeringDevOpsDeploy ? 'animate-spin' : ''}`} />
                        <span>{isTriggeringDevOpsDeploy ? 'Deploying...' : 'Deploy'}</span>
                      </button>

                      <button
                        id="btn-execute-push-deploy-all"
                        onClick={handlePushAndDeployAll}
                        disabled={isPushAndDeploying}
                        className="w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:from-emerald-400 hover:to-cyan-500 text-white font-bold text-xs shadow-lg transition-all disabled:opacity-50"
                      >
                        <Rocket className={`h-4 w-4 ${isPushAndDeploying ? 'animate-bounce' : ''}`} />
                        <span>{isPushAndDeploying ? 'Executing Pipeline...' : 'Push to GitHub & Auto-Deploy Both'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Execution Result & Console Stream */}
              {pushAndDeployResult && (
                <div className="rounded-2xl border border-slate-800 bg-[#0a0f1d] overflow-hidden space-y-0">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-[#0e1424]">
                    <div className="flex items-center space-x-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${pushAndDeployResult.success ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <h4 className="text-xs font-bold text-white">
                        Pipeline Execution Summary ({pushAndDeployResult.durationMs}ms)
                      </h4>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(pushAndDeployResult.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Status Badges */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-[#090d18] border-b border-slate-800/80 text-xs">
                    <div className="p-2.5 rounded-xl border border-slate-800 bg-[#0d1322]">
                      <div className="text-[10px] text-slate-500 uppercase font-semibold">GitHub Push</div>
                      <div className={`font-bold mt-0.5 ${pushAndDeployResult.git.success ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pushAndDeployResult.git.success ? `✔ Pushed to ${pushAndDeployResult.git.branch}` : '✖ Push Failed'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                        Auth: {pushAndDeployResult.git.authMethod}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl border border-slate-800 bg-[#0d1322]">
                      <div className="text-[10px] text-slate-500 uppercase font-semibold">Amplify Frontend</div>
                      <div className={`font-bold mt-0.5 ${pushAndDeployResult.amplify.status === 'FAILED' ? 'text-red-400' : 'text-cyan-400'}`}>
                        {pushAndDeployResult.amplify.status}
                      </div>
                      <a
                        href={pushAndDeployResult.amplify.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 mt-0.5"
                      >
                        <span>Open Amplify</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>

                    <div className="p-2.5 rounded-xl border border-slate-800 bg-[#0d1322]">
                      <div className="text-[10px] text-slate-500 uppercase font-semibold">EC2 Backend</div>
                      <div className={`font-bold mt-0.5 ${pushAndDeployResult.ec2.status === 'FAILED' ? 'text-red-400' : 'text-emerald-400'}`}>
                        {pushAndDeployResult.ec2.status}
                      </div>
                      <a
                        href={`${pushAndDeployResult.ec2.url}/api/health`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 mt-0.5"
                      >
                        <span>Check EC2 Health</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </div>

                  {/* Terminal Log Output */}
                  <div className="p-4 bg-[#060911]">
                    <div className="text-[11px] font-mono text-slate-400 mb-2 font-semibold flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Pipeline Logs</span>
                    </div>
                    <pre className="text-xs font-mono text-emerald-300/90 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed bg-[#03060c] p-3 rounded-xl border border-slate-800">
                      {pushAndDeployResult.logs.join('\n')}
                    </pre>
                  </div>
                </div>
              )}

              {/* DevOps Actions Workflow & Automated CI/CD Card */}
              <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
                  <div className="flex items-center space-x-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
                      <Zap className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <h4 className="text-xs font-bold text-white tracking-wide">
                          GitHub Actions DevOps Automation
                        </h4>
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>Auto-Trigger on Push: ACTIVE</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Automatically triggers workflow runs when new commits are pushed, or trigger on demand.
                      </p>
                    </div>
                  </div>

                  <button
                    id="btn-devops-card-deploy"
                    onClick={handleTriggerDevOpsDeploy}
                    disabled={isTriggeringDevOpsDeploy}
                    className="flex items-center justify-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
                  >
                    <Play className={`h-3.5 w-3.5 fill-current ${isTriggeringDevOpsDeploy ? 'animate-spin' : ''}`} />
                    <span>{isTriggeringDevOpsDeploy ? 'Dispatching...' : 'Deploy'}</span>
                  </button>
                </div>

                {/* Workflow Selector & Target Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-slate-800 bg-[#080d1a]">
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Active Workflow
                    </label>
                    <select
                      value={selectedWorkflowId}
                      onChange={(e) => setSelectedWorkflowId(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-[#0e1424] text-white text-xs px-2.5 py-1.5 focus:border-cyan-500 focus:outline-none"
                    >
                      {devOpsWorkflows.length > 0 ? (
                        devOpsWorkflows.map((wf) => (
                          <option key={wf.id} value={wf.id}>
                            {wf.name} ({wf.id})
                          </option>
                        ))
                      ) : (
                        <option value="deploy.yml">
                          Deploy to AWS Amplify (Frontend) &amp; EC2 (Backend) (deploy.yml)
                        </option>
                      )}
                    </select>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-800 bg-[#080d1a] flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-400">Target Branch</div>
                      <div className="font-mono text-cyan-400 font-semibold mt-0.5">
                        {repoStatus.currentBranch || 'main'}
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 font-mono">
                      workflow_dispatch
                    </span>
                  </div>
                </div>

                {/* DevOps Deploy Result Message */}
                {devOpsDeployResult && (
                  <div className="p-3 rounded-xl border border-blue-500/30 bg-blue-500/10 text-xs flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="text-slate-200">{devOpsDeployResult.message}</span>
                    </div>
                    {devOpsDeployResult.runUrl && (
                      <a
                        href={devOpsDeployResult.runUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 shrink-0 ml-3"
                      >
                        <span>GitHub Actions</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}

                {/* Recent Workflow Runs */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Recent GitHub Actions Workflow Runs</span>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const runs = await fetchDevOpsRuns();
                        if (runs.length) setDevOpsRuns(runs);
                        showToast('Refreshed workflow runs', 'info');
                      }}
                      className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                    >
                      <RefreshCw className="h-2.5 w-2.5" />
                      <span>Refresh</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {devOpsRuns.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-slate-800 bg-[#090e1b] text-xs hover:border-slate-700 transition-all"
                      >
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              run.conclusion === 'success'
                                ? 'bg-emerald-400'
                                : run.status === 'in_progress'
                                ? 'bg-blue-400 animate-ping'
                                : run.conclusion === 'failure'
                                ? 'bg-red-400'
                                : 'bg-amber-400'
                            }`}
                          />
                          <div className="truncate">
                            <span className="font-semibold text-white truncate block">
                              {run.name}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              #{run.run_number} &bull; {run.head_branch} ({run.head_sha || 'commit'}) &bull; {new Date(run.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0 ml-2">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase ${
                              run.conclusion === 'success'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : run.status === 'in_progress'
                                ? 'bg-blue-500/15 text-blue-300'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {run.conclusion || run.status}
                          </span>
                          <a
                            href={run.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 text-slate-400 hover:text-cyan-300 transition-all"
                            title="Open Run in GitHub Actions"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* CLI Instructions Card */}
              <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-slate-400" />
                    <span>Deploy from your Terminal or CI/CD</span>
                  </h5>
                  <span className="text-[10px] text-slate-500 font-mono">npm run deploy:all</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-2">
                  You can also run the unified push and deploy automation directly from your shell at any time:
                </p>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#060911] border border-slate-800 font-mono text-xs text-cyan-300">
                  <code>npm run deploy:all -m &quot;feat: your custom message&quot;</code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText('npm run deploy:all');
                      showToast('Copied CLI command!', 'info');
                    }}
                    className="p-1 text-slate-400 hover:text-white"
                    title="Copy command"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* ================= TAB 1: SSH KEY CONFIGURATION ================= */}
          {activeTab === 'keys' && (
            <div className="space-y-6">
              
              {/* Current Key Card */}
              <div className="rounded-2xl border border-slate-800 bg-[#0f1629] p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2.5 rounded-xl border ${sshInfo.configured ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                      <Key className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-white">
                          {sshInfo.configured ? `${sshInfo.keyType?.toUpperCase()} Authentication Key` : 'No SSH Key Configured'}
                        </span>
                        {sshInfo.configured && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Strict 0600 Perms
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {sshInfo.configured
                          ? `Fingerprint: ${sshInfo.fingerprint || 'Verified'}`
                          : 'Generate a new Ed25519 key or paste an existing private key to enable SSH authentication.'}
                      </p>
                    </div>
                  </div>

                  {sshInfo.configured && (
                    <div className="flex items-center space-x-2">
                      <button
                        id="btn-copy-public-key"
                        onClick={handleCopyPublicKey}
                        className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-sm"
                      >
                        {hasCopiedPub ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        <span>{hasCopiedPub ? 'Copied!' : 'Copy Public Key'}</span>
                      </button>

                      <button
                        id="btn-download-public-key"
                        onClick={handleDownloadPublicKey}
                        className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white transition-all"
                        title="Download .pub file"
                      >
                        <Download className="h-4 w-4" />
                      </button>

                      <button
                        id="btn-delete-ssh-key"
                        onClick={() => setDeleteConfirmOpen(true)}
                        className="p-1.5 rounded-lg border border-red-500/30 bg-red-950/30 text-red-400 hover:bg-red-900/50 transition-all"
                        title="Delete key"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Public Key Display Box */}
                {sshInfo.configured && sshInfo.publicKey && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-mono text-[11px] text-slate-300">Public Key (Add to GitHub Account)</span>
                      <a
                        href="https://github.com/settings/ssh/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-1 text-emerald-400 hover:text-emerald-300 underline font-medium"
                      >
                        <span>Open GitHub SSH Settings</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="relative">
                      <pre className="p-3 text-[11px] font-mono rounded-xl bg-[#090d18] border border-slate-800 text-slate-300 overflow-x-auto whitespace-pre-wrap break-all select-all">
                        {sshInfo.publicKey}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Delete Confirmation Alert */}
                {deleteConfirmOpen && (
                  <div className="mt-4 p-4 rounded-xl border border-red-500/40 bg-red-950/40 flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-2 text-xs text-red-200">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                      <span>Are you sure you want to remove this configured SSH key from the workspace?</span>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      <button
                        onClick={() => setDeleteConfirmOpen(false)}
                        className="px-3 py-1 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteKey}
                        className="px-3 py-1 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-500 text-white"
                      >
                        Confirm Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* GitHub 4-Step Walkthrough Guide */}
              <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>How to Authorize with GitHub (Automated Push/Pull Setup)</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowDetailedGuide(!showDetailedGuide)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>{showDetailedGuide ? 'Collapse Detailed Guide' : 'View Full Guide'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-slate-800/80 bg-[#090e1a] p-3.5 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                      Step 1
                    </span>
                    <h4 className="text-xs font-bold text-white">Generate or Import</h4>
                    <p className="text-[11px] text-slate-400">
                      Create an Ed25519 key pair below with 1-click or paste an existing private key.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-[#090e1a] p-3.5 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                      Step 2
                    </span>
                    <h4 className="text-xs font-bold text-white">Copy Public Key</h4>
                    <p className="text-[11px] text-slate-400">
                      Click &quot;Copy Public Key&quot; to copy the <code className="text-emerald-400 font-mono">ssh-ed25519</code> payload to your clipboard.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-[#090e1a] p-3.5 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                      Step 3
                    </span>
                    <h4 className="text-xs font-bold text-white">Add on GitHub</h4>
                    <p className="text-[11px] text-slate-400">
                      Open <a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline font-medium inline-flex items-center gap-0.5">GitHub Settings <ExternalLink className="h-2.5 w-2.5 inline" /></a>, paste into the Key field, and click Save.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-[#090e1a] p-3.5 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                      Step 4
                    </span>
                    <h4 className="text-xs font-bold text-white">Verify Handshake</h4>
                    <p className="text-[11px] text-slate-400">
                      Switch to the &quot;Handshake Diagnostic&quot; tab to test authenticated read/write access.
                    </p>
                  </div>
                </div>

                {/* Detailed Instruction Guide Panel */}
                {showDetailedGuide && (
                  <div className="mt-4 rounded-xl border border-cyan-500/20 bg-[#070d1a] p-4.5 space-y-3.5 text-xs text-slate-300">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2 text-cyan-300 font-bold">
                        <Github className="h-4 w-4" />
                        <span>Step-by-Step Instructions: Adding Key to GitHub Account Settings</span>
                      </div>
                      <a
                        href="https://github.com/settings/ssh/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors shadow-sm self-start sm:self-auto"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        <span>Open GitHub SSH Keys Page</span>
                      </a>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                      <div className="p-3 rounded-lg bg-[#0b1222] border border-slate-800/80 space-y-1.5">
                        <div className="text-slate-400 font-semibold text-[11px]">1. Navigate &amp; Label</div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          In GitHub, go to <strong className="text-white">Settings &rarr; SSH and GPG keys &rarr; New SSH key</strong>. In the <strong className="text-white">Title</strong> field, enter <span className="font-mono text-cyan-300">GigPilot Backend</span> or <span className="font-mono text-cyan-300">Freelance Autopilot</span>.
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-[#0b1222] border border-slate-800/80 space-y-1.5">
                        <div className="text-slate-400 font-semibold text-[11px]">2. Select Key Type &amp; Paste</div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          Leave <strong className="text-white">Key type</strong> as <span className="text-emerald-400 font-semibold">Authentication Key</span>. In the <strong className="text-white">Key</strong> field, paste your copied public key (starts with <code className="text-cyan-300 font-mono">ssh-ed25519</code>).
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-[#0b1222] border border-slate-800/80 space-y-1.5">
                        <div className="text-slate-400 font-semibold text-[11px]">3. Enable Push / Pull Automation</div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          Click <strong className="text-white">Add SSH key</strong>. Your backend service can now autonomously execute non-interactive <strong className="text-white">git pull</strong> and <strong className="text-white">git push</strong> operations without entering passwords or Personal Access Tokens (PATs)!
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>Backend uses strict 0600 file permissions and BatchMode non-interactive SSH transport.</span>
                      </span>
                      <span className="font-mono text-slate-400">
                        Verification CLI: <code className="text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">ssh -T git@github.com</code>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Generate New Key Section */}
              <div className="rounded-2xl border border-slate-800 bg-[#0f1629] p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white">Generate Brand-New SSH Key Pair</h3>
                    <p className="text-xs text-slate-400">
                      Creates a cryptographically secure key in <code className="text-slate-300 font-mono">~/.ssh/</code> with automated host configuration
                    </p>
                  </div>

                  <button
                    id="btn-toggle-manual-import"
                    onClick={() => setShowManualImport(!showManualImport)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium underline flex items-center gap-1"
                  >
                    <Upload className="h-3 w-3" />
                    <span>{showManualImport ? 'Switch to Generator' : 'Or Import Existing Key'}</span>
                  </button>
                </div>

                {!showManualImport ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">Algorithm</label>
                      <select
                        id="select-ssh-algorithm"
                        value={keyType}
                        onChange={(e) => setKeyType(e.target.value as any)}
                        className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="ed25519">Ed25519 (Recommended by GitHub - Elliptic Curve)</option>
                        <option value="rsa">RSA 4096-bit (Legacy compatibility)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">Email / Key Comment</label>
                      <input
                        id="input-key-comment"
                        type="text"
                        value={keyComment}
                        onChange={(e) => setKeyComment(e.target.value)}
                        placeholder="your-email@domain.com"
                        className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none font-mono"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        id="btn-generate-ssh-key"
                        onClick={handleGenerateKey}
                        disabled={isGenerating}
                        className="w-full flex items-center justify-center space-x-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 text-xs font-bold transition-all shadow-md active:scale-95"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                        <span>{isGenerating ? 'Generating...' : 'Generate SSH Key Pair'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Manual Import Form */
                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-semibold text-slate-300">
                          Paste Private Key (id_ed25519 or id_rsa)
                        </label>
                        <button
                          onClick={() => setShowPrivateKeyText(!showPrivateKeyText)}
                          className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
                        >
                          {showPrivateKeyText ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          <span>{showPrivateKeyText ? 'Mask' : 'Show'}</span>
                        </button>
                      </div>
                      <textarea
                        id="textarea-private-key"
                        value={manualPrivateKey}
                        onChange={(e) => setManualPrivateKey(e.target.value)}
                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                        rows={4}
                        className={`w-full rounded-xl border border-slate-700 bg-[#090d18] p-3 text-xs font-mono text-slate-200 focus:border-emerald-500 focus:outline-none ${
                          !showPrivateKeyText ? 'filter blur-[1.5px] hover:blur-none transition-all' : ''
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Public Key (Optional - will be derived automatically if blank)
                      </label>
                      <input
                        id="input-manual-public-key"
                        type="text"
                        value={manualPublicKey}
                        onChange={(e) => setManualPublicKey(e.target.value)}
                        placeholder="ssh-ed25519 AAAAC3... email@domain.com"
                        className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3 py-2 text-xs font-mono text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex justify-end space-x-2 pt-2">
                      <button
                        onClick={() => setShowManualImport(false)}
                        className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        id="btn-save-manual-key"
                        onClick={handleSaveManualKey}
                        disabled={isGenerating || !manualPrivateKey.trim()}
                        className="flex items-center space-x-1.5 px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Save &amp; Store Key</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ================= TAB 2: LIVE SSH HANDSHAKE TEST ================= */}
          {activeTab === 'test' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-800 bg-[#0f1629] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-400" />
                      <span>Live GitHub SSH Handshake Verification</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Executes an authentic SSH probe directly to <code className="text-cyan-300 font-mono">git@github.com</code> using your installed credentials
                    </p>
                  </div>

                  <button
                    id="btn-test-ssh-connection"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                    <span>{isTesting ? 'Testing Handshake...' : 'Run SSH Probe Now'}</span>
                  </button>
                </div>

                {/* Handshake Result Box */}
                {testResult ? (
                  <div
                    className={`rounded-xl border p-4 transition-all ${
                      testResult.authenticated
                        ? 'border-emerald-500/40 bg-emerald-950/20'
                        : 'border-amber-500/40 bg-amber-950/20'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      {testResult.authenticated ? (
                        <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                      ) : (
                        <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                          <ShieldAlert className="h-5 w-5" />
                        </div>
                      )}

                      <div className="flex-1 space-y-1">
                        <div className="flex items-center space-x-2">
                          <h4 className="text-xs font-bold text-white">
                            {testResult.authenticated ? 'Authentication Successful!' : 'Authentication Notice'}
                          </h4>
                          {testResult.username && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              @{testResult.username}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-slate-300">{testResult.message}</p>

                        {testResult.diagnostics && (
                          <p className="text-[11px] text-slate-400 pt-1 font-mono">
                            {testResult.diagnostics}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Raw Terminal Output */}
                    <div className="mt-3 pt-3 border-t border-slate-800/80">
                      <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500">
                        Raw SSH Handshake Output
                      </span>
                      <pre className="mt-1 p-2.5 rounded-lg bg-[#070a12] border border-slate-800 text-[11px] font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap">
                        {testResult.rawOutput}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-800 bg-[#090e1a] p-6 text-center space-y-2">
                    <Terminal className="h-8 w-8 text-slate-600 mx-auto" />
                    <p className="text-xs text-slate-300">No probe executed yet for this session.</p>
                    <p className="text-[11px] text-slate-500">
                      Click &quot;Run SSH Probe Now&quot; to test whether your public key is accepted by GitHub.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= TAB 3: REPOSITORY REMOTE & USER IDENTITY ================= */}
          {activeTab === 'remote' && (
            <div className="space-y-6">
              
              {/* Remote Origin URL Form */}
              <div className="rounded-2xl border border-slate-800 bg-[#0f1629] p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-cyan-400" />
                    <span>Git Remote Origin &amp; Identity Configuration</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure your repository to use authenticated SSH format (<code className="text-emerald-300 font-mono">git@github.com:owner/repo.git</code>)
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold text-slate-300">
                        Remote Origin URL
                      </label>
                      <button
                        type="button"
                        onClick={handleConvertToSSH}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 underline font-medium"
                      >
                        Auto-Convert HTTPS to SSH
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="input-remote-origin-url"
                        type="text"
                        value={remoteUrlInput}
                        onChange={(e) => setRemoteUrlInput(e.target.value)}
                        placeholder="git@github.com:username/repository.git"
                        className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3.5 py-2.5 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                      <span>Format: git@github.com:owner/repo.git</span>
                      <span className={repoStatus.isSSHRemote ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>
                        {repoStatus.isSSHRemote ? '✓ Remote uses SSH' : 'Notice: HTTPS remote requires PAT or SSH switch'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Git Committer Name (git config user.name)
                      </label>
                      <input
                        id="input-git-user-name"
                        type="text"
                        value={userNameInput}
                        onChange={(e) => setUserNameInput(e.target.value)}
                        placeholder="Your GitHub Username"
                        className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3 py-2 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Git Committer Email (git config user.email)
                      </label>
                      <input
                        id="input-git-user-email"
                        type="email"
                        value={userEmailInput}
                        onChange={(e) => setUserEmailInput(e.target.value)}
                        placeholder="your-email@domain.com"
                        className="w-full rounded-xl border border-slate-700 bg-[#090d18] px-3 py-2 text-xs text-white font-mono focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-3">
                    <button
                      id="btn-save-remote-config"
                      onClick={handleSaveRemote}
                      disabled={isSavingRemote || !remoteUrlInput.trim()}
                      className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>{isSavingRemote ? 'Saving Configuration...' : 'Save Remote & Identity'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Current Git Status Summary */}
              <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Current Git Working Tree
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl border border-slate-800 bg-[#090e1a] p-3">
                    <span className="text-[10px] text-slate-500">Active Branch</span>
                    <div className="text-white font-mono font-bold mt-0.5">{repoStatus.currentBranch || 'main'}</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#090e1a] p-3">
                    <span className="text-[10px] text-slate-500">Working Tree</span>
                    <div className={`font-bold mt-0.5 ${repoStatus.clean ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {repoStatus.clean ? 'Clean' : `${repoStatus.uncommittedCount} modified files`}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#090e1a] p-3">
                    <span className="text-[10px] text-slate-500">Last Commit</span>
                    <div className="text-white font-mono font-semibold truncate mt-0.5">
                      {repoStatus.lastCommit?.hash || 'None'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#090e1a] p-3">
                    <span className="text-[10px] text-slate-500">Remote Protocol</span>
                    <div className={`font-semibold mt-0.5 ${repoStatus.isSSHRemote ? 'text-emerald-400' : 'text-slate-400'}`}>
                      {repoStatus.isSSHRemote ? 'SSH (Key Auth)' : 'HTTPS / Local'}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ================= TAB 4: PUSH & PULL OPERATIONS TERMINAL ================= */}
          {activeTab === 'gitops' && (
            <div className="space-y-6">
              
              <div className="rounded-2xl border border-slate-800 bg-[#0f1629] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-emerald-400" />
                      <span>Authenticated Git Operations (Push / Pull)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Executes git commands using configured SSH key with automatic batch mode and non-interactive host verification
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      id="btn-git-fetch"
                      onClick={() => handleExecuteGit('fetch')}
                      disabled={Boolean(isExecutingGit)}
                      className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all"
                    >
                      <RefreshCw className={`h-3 w-3 ${isExecutingGit === 'fetch' ? 'animate-spin' : ''}`} />
                      <span>Fetch</span>
                    </button>

                    <button
                      id="btn-git-pull"
                      onClick={() => handleExecuteGit('pull')}
                      disabled={Boolean(isExecutingGit)}
                      className="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <GitPullRequest className={`h-3.5 w-3.5 ${isExecutingGit === 'pull' ? 'animate-spin' : ''}`} />
                      <span>Pull (Rebase)</span>
                    </button>

                    <button
                      id="btn-git-push"
                      onClick={() => handleExecuteGit('push')}
                      disabled={Boolean(isExecutingGit)}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                    >
                      <ArrowUpRight className={`h-3.5 w-3.5 ${isExecutingGit === 'push' ? 'animate-spin' : ''}`} />
                      <span>Push to GitHub</span>
                    </button>
                  </div>
                </div>

                {/* Operations Terminal Console */}
                <div className="rounded-xl border border-slate-800 bg-[#060911] overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800 bg-[#0b0f1a] text-xs font-mono text-slate-400">
                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80 inline-block" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                      <span className="text-[11px] text-slate-300 ml-2">
                        terminal ~ git {isExecutingGit || gitOpResult?.operation || 'status'}
                      </span>
                    </div>
                    {gitOpResult && (
                      <span className="text-[10px] text-slate-500">
                        Execution: {gitOpResult.durationMs}ms
                      </span>
                    )}
                  </div>

                  <pre className="p-4 text-xs font-mono text-emerald-400/90 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                    {isExecutingGit ? (
                      <span className="text-cyan-300 animate-pulse">
                        $ git {isExecutingGit} origin {repoStatus.currentBranch || 'main'}...
                      </span>
                    ) : gitOpResult ? (
                      <>
                        <div className="text-slate-500 mb-1">
                          $ git {gitOpResult.operation} [exit code {gitOpResult.exitCode}]
                        </div>
                        <div className={gitOpResult.success ? 'text-emerald-300' : 'text-amber-300'}>
                          {gitOpResult.output}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-500">
                        Terminal ready. Click &quot;Fetch&quot;, &quot;Pull&quot;, or &quot;Push to GitHub&quot; to run an authenticated git operation.
                      </span>
                    )}
                  </pre>
                </div>
              </div>

            </div>
          )}

          {/* ============================================================= */}
          {/* TAB 5: WEBHOOK & PUSH-TO-DEPLOY */}
          {/* ============================================================= */}
          {activeTab === 'webhook' && (
            <div className="space-y-6">

              {/* Status Header */}
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <div className="rounded-xl p-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      <Webhook className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                        <span>Continuous Push-to-Deploy Pipeline</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          Active
                        </span>
                      </h4>
                      <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                        Whenever you push commits to GitHub, GitHub fires an authenticated webhook to your EC2 backend.
                        The server pulls the latest changes, builds production assets, and reloads without manual intervention.
                      </p>
                    </div>
                  </div>

                  <button
                    id="btn-trigger-deploy-now"
                    onClick={handleTriggerDeploy}
                    disabled={isDeploying}
                    className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition-all disabled:opacity-50"
                  >
                    <Zap className={`h-4 w-4 ${isDeploying ? 'animate-spin' : ''}`} />
                    <span>{isDeploying ? 'Deploying...' : 'Deploy Now'}</span>
                  </button>
                </div>
              </div>

              {/* Webhook URL Endpoint Box */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-200 flex items-center space-x-2">
                    <span>GitHub Webhook URL (Production Endpoint)</span>
                    <span className="text-emerald-400 text-[10px] font-mono font-normal">
                      SSL Verified (sslip.io)
                    </span>
                  </label>
                  <a
                    href={`https://github.com/${repoStatus.remoteOriginUrl ? repoStatus.remoteOriginUrl.replace(/.*github\.com[:/]([^/.]+\/[^/.]+).*/, '$1') : 'ky8402-rgb/gigpilot-platform'}/settings/hooks/new`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    <span>Open GitHub Webhooks</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-700/80 bg-slate-950 font-mono text-xs text-emerald-300 select-all overflow-x-auto whitespace-nowrap">
                    {webhookInfo?.webhookUrl || 'https://3-222-149-9.sslip.io/api/github/webhook'}
                  </div>
                  <button
                    id="btn-copy-webhook-url"
                    onClick={handleCopyWebhookUrl}
                    className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all"
                  >
                    {hasCopiedWebhook ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 text-slate-400" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Configuration Specs Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40">
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Content Type</span>
                    <span className="text-xs font-semibold text-slate-200 mt-0.5 block font-mono">application/json</span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40">
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Signature Secret</span>
                    <span className="text-xs font-semibold text-emerald-400 mt-0.5 block flex items-center space-x-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span>HMAC-SHA256 Enabled</span>
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-slate-800 bg-slate-950/40">
                    <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Monitored Events</span>
                    <span className="text-xs font-semibold text-slate-200 mt-0.5 block font-mono">push, ping</span>
                  </div>
                </div>
              </div>

              {/* Automated CLI Script Assistant */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-2">
                    <Terminal className="h-4 w-4 text-cyan-400" />
                    <span>Automated Setup Script (1-Line Association)</span>
                  </h4>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('./scripts/setup-github-webhook.sh --token <YOUR_GITHUB_TOKEN>');
                      showToast('Script command copied!', 'info');
                    }}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copy Command</span>
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Run the dedicated setup script to automatically create the webhook via GitHub REST API, generate 256-bit keys, and test the connection:
                </p>
                <div className="px-4 py-3 rounded-xl border border-slate-800 bg-slate-950 font-mono text-xs text-cyan-300 overflow-x-auto">
                  ./scripts/setup-github-webhook.sh --token &lt;YOUR_GITHUB_PERSONAL_ACCESS_TOKEN&gt;
                </div>
              </div>

              {/* Recent Deployments Table */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-2">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    <span>Recent Push Deployments</span>
                  </h4>
                  <button
                    onClick={loadWebhookStatus}
                    className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Refresh</span>
                  </button>
                </div>

                {deployments && deployments.length > 0 ? (
                  <div className="space-y-2">
                    {deployments.map((dep: any, idx: number) => (
                      <div
                        key={dep.id || idx}
                        className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/60 text-xs"
                      >
                        <div className="flex items-center space-x-3">
                          <span className={`w-2 h-2 rounded-full ${
                            dep.status === 'SUCCESS' ? 'bg-emerald-400' : dep.status === 'PENDING' ? 'bg-amber-400 animate-ping' : 'bg-red-400'
                          }`} />
                          <div>
                            <div className="font-mono text-slate-200 font-semibold flex items-center space-x-2">
                              <span>{dep.branch}</span>
                              {dep.commitHash && (
                                <span className="text-slate-500 font-normal">
                                  ({dep.commitHash.substring(0, 7)})
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {dep.commitMessage || dep.author || dep.trigger}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            dep.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                          }`}>
                            {dep.status}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-1">
                            {new Date(dep.startedAt).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No webhook deployment history yet. Commits pushed to your repository will appear here automatically.
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-[#0e1424] text-xs text-slate-400">
          <div className="flex items-center space-x-2 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>OpenSSH Client Active</span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-300">Identity: ~/.ssh/id_ed25519</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all"
            >
              Done
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
