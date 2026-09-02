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
  Code
} from 'lucide-react';
import {
  fetchGitHubStatus,
  generateGitHubSSHKey,
  saveGitHubSSHKey,
  deleteGitHubSSHKey,
  configureGitHubRemote,
  testGitHubSSHConnection,
  executeGitOp,
  GitHubSSHKeyInfo,
  GitHubRepoStatus,
  GitHubSSHTestResult,
  GitOperationClientResult
} from '../services/api';

export interface GitHubSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  onRemoteConfigured?: (remoteUrl: string) => void;
}

export const GitHubSettingsModal: React.FC<GitHubSettingsModalProps> = ({
  isOpen,
  onClose,
  showToast = () => {},
  onRemoteConfigured
}) => {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'keys' | 'test' | 'remote' | 'gitops'>('keys');

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

  // Load status on open
  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

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
    } catch (err: any) {
      console.error('Failed to load GitHub status:', err);
    } finally {
      setIsLoading(false);
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

          <button
            id="btn-close-github-modal"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
            title="Close modal (Esc)"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-1 px-6 pt-3 pb-0 border-b border-slate-800/80 bg-[#0e1424]/60 overflow-x-auto">
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
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
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
              <div className="rounded-2xl border border-slate-800 bg-[#0d1322] p-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>How to Authorize with GitHub (Quick 4-Step Setup)</span>
                </h3>

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
                      Click &quot;Copy Public Key&quot; above to copy the generated <code className="text-emerald-400">ssh-ed25519</code> token.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-[#090e1a] p-3.5 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                      Step 3
                    </span>
                    <h4 className="text-xs font-bold text-white">Add on GitHub</h4>
                    <p className="text-[11px] text-slate-400">
                      Visit <a href="https://github.com/settings/ssh/new" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">GitHub SSH Settings</a>, title it &quot;Freelance Autopilot&quot;, and save.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-[#090e1a] p-3.5 space-y-1">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                      Step 4
                    </span>
                    <h4 className="text-xs font-bold text-white">Verify Handshake</h4>
                    <p className="text-[11px] text-slate-400">
                      Click the &quot;Handshake Diagnostic&quot; tab to test authenticated read/write access.
                    </p>
                  </div>
                </div>
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
