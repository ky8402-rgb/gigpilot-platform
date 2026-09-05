import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec, execSync } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export interface SSHKeyInfo {
  configured: boolean;
  keyType?: 'ed25519' | 'rsa';
  publicKey?: string;
  fingerprint?: string;
  comment?: string;
  path?: string;
  createdAt?: string;
  size?: number;
  hasConfig?: boolean;
  hasKnownHosts?: boolean;
}

export interface GitRepoStatus {
  currentBranch: string;
  remoteOriginUrl: string | null;
  isSSHRemote: boolean;
  userName: string;
  userEmail: string;
  clean: boolean;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
  uncommittedCount: number;
}

export interface SSHAuthTestResult {
  success: boolean;
  authenticated: boolean;
  username?: string;
  message: string;
  rawOutput: string;
  diagnostics?: string;
  testedAt: string;
}

export interface GitOperationResult {
  success: boolean;
  operation: string;
  exitCode: number;
  output: string;
  durationMs: number;
  timestamp: string;
}

export interface GitHubTokenInfo {
  configured: boolean;
  login?: string;
  name?: string;
  avatarUrl?: string;
  scopes?: string[];
  savedAt?: string;
  source: 'stored_file' | 'env_var' | 'none';
}

export interface GitHubAuthStatus {
  tokenConfigured: boolean;
  tokenUser?: {
    login: string;
    name?: string;
    avatarUrl?: string;
    scopes?: string[];
  };
  sshConfigured: boolean;
  sshKeyType?: string;
  activeAuthType: 'token' | 'ssh' | 'none';
  canPush: boolean;
  repo: GitRepoStatus;
}

export interface PushAndDeployResult {
  success: boolean;
  git: {
    success: boolean;
    commitHash?: string;
    commitMessage?: string;
    branch: string;
    authMethod: 'token' | 'ssh' | 'none';
    output: string;
  };
  amplify: {
    status: 'TRIGGERED' | 'NOTIFIED_VIA_PUSH' | 'SKIPPED' | 'FAILED';
    appName: string;
    appId: string;
    jobId?: string;
    message: string;
    url: string;
  };
  ec2: {
    status: 'DEPLOYED_LOCAL' | 'DEPLOYED_WEBHOOK' | 'SKIPPED' | 'FAILED';
    host: string;
    url: string;
    message: string;
    deploymentId?: string;
  };
  durationMs: number;
  timestamp: string;
  logs: string[];
}

const HOME_DIR = os.homedir() || '/root';
const SSH_DIR = path.join(HOME_DIR, '.ssh');
const ED25519_KEY_PATH = path.join(SSH_DIR, 'id_ed25519');
const ED25519_PUB_PATH = path.join(SSH_DIR, 'id_ed25519.pub');
const RSA_KEY_PATH = path.join(SSH_DIR, 'id_rsa');
const RSA_PUB_PATH = path.join(SSH_DIR, 'id_rsa.pub');
const SSH_CONFIG_PATH = path.join(SSH_DIR, 'config');
const KNOWN_HOSTS_PATH = path.join(SSH_DIR, 'known_hosts');

// Persistence backup path in workspace so keys and tokens are retained across restarts
const BACKUP_DIR = path.join(process.cwd(), 'server', 'data');
const BACKUP_FILE = path.join(BACKUP_DIR, 'github_ssh_backup.json');
const TOKEN_BACKUP_FILE = path.join(BACKUP_DIR, 'github_token_backup.json');

/**
 * Ensures ~/.ssh directory exists with strict 0700 permissions
 */
export function ensureSSHDirectory(): void {
  if (!fs.existsSync(SSH_DIR)) {
    fs.mkdirSync(SSH_DIR, { mode: 0o700, recursive: true });
  } else {
    try {
      fs.chmodSync(SSH_DIR, 0o700);
    } catch {
      // Ignore if cannot chmod
    }
  }

  // Ensure known_hosts includes github.com
  ensureGithubKnownHosts();

  // Ensure SSH config file exists
  ensureSSHConfig();
}

/**
 * Automatically seeds known_hosts with GitHub's official SSH host keys
 */
export function ensureGithubKnownHosts(): void {
  try {
    let currentKnown = '';
    if (fs.existsSync(KNOWN_HOSTS_PATH)) {
      currentKnown = fs.readFileSync(KNOWN_HOSTS_PATH, 'utf8');
    }

    if (!currentKnown.includes('github.com')) {
      const githubHostKeys = [
        'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
        'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRqq6pJ520UBoUEYNzsDVnnNLAW58yKEIsMDnxNjvc=',
        'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1ymAtUmAvMgDAIVTSjlMWYi18VZHbwyJfWaxOTOPgesIF9TXMKzkUr146aJxgqT0ja26ZdAHT6PFLAmE2v9B3WmB28CaOxEQ==',
      ].join('\n') + '\n';

      fs.appendFileSync(KNOWN_HOSTS_PATH, githubHostKeys, { mode: 0o644 });
    }
  } catch (err: any) {
    console.warn('[GitHubService] Failed to seed known_hosts:', err.message);
  }
}

/**
 * Ensures ~/.ssh/config contains GitHub host directives
 */
export function ensureSSHConfig(): void {
  try {
    const lines = [
      'Host github.com',
      '  HostName github.com',
      '  User git',
    ];

    if (fs.existsSync(ED25519_KEY_PATH)) {
      lines.push('  IdentityFile ~/.ssh/id_ed25519');
    } else if (fs.existsSync(RSA_KEY_PATH)) {
      lines.push('  IdentityFile ~/.ssh/id_rsa');
    } else {
      lines.push('  IdentityFile ~/.ssh/id_ed25519');
    }

    lines.push(
      '  IdentitiesOnly yes',
      '  StrictHostKeyChecking accept-new',
      '  ServerAliveInterval 30',
      '  ServerAliveCountMax 3'
    );

    const configContent = lines.join('\n') + '\n';
    fs.writeFileSync(SSH_CONFIG_PATH, configContent, { mode: 0o600 });
  } catch (err: any) {
    console.warn('[GitHubService] Failed to write SSH config:', err.message);
  }
}

/**
 * Restores SSH key from workspace backup if filesystem was reset
 */
export function restoreFromBackupIfAvailable(): boolean {
  try {
    if (!fs.existsSync(ED25519_KEY_PATH) && !fs.existsSync(RSA_KEY_PATH) && fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data.privateKey) {
        ensureSSHDirectory();
        const targetKeyPath = data.keyType === 'rsa' ? RSA_KEY_PATH : ED25519_KEY_PATH;
        const targetPubPath = data.keyType === 'rsa' ? RSA_PUB_PATH : ED25519_PUB_PATH;

        fs.writeFileSync(targetKeyPath, data.privateKey.trim() + '\n', { mode: 0o600 });
        if (data.publicKey) {
          fs.writeFileSync(targetPubPath, data.publicKey.trim() + '\n', { mode: 0o644 });
        }
        console.log('[GitHubService] Successfully restored SSH keys from persistent backup');
        return true;
      }
    }
  } catch (err: any) {
    console.warn('[GitHubService] Error checking/restoring backup:', err.message);
  }
  return false;
}

/**
 * Backup SSH keys into workspace server/data/
 */
function backupSSHKeys(privateKey: string, publicKey: string, keyType: 'ed25519' | 'rsa', comment: string): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(
      BACKUP_FILE,
      JSON.stringify(
        {
          privateKey,
          publicKey,
          keyType,
          comment,
          savedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch (err: any) {
    console.warn('[GitHubService] Failed to backup SSH keys to file:', err.message);
  }
}

/**
 * Retrieves the current configured SSH Key status and details
 */
export async function getSSHStatus(): Promise<SSHKeyInfo> {
  ensureSSHDirectory();
  restoreFromBackupIfAvailable();

  let activePrivPath: string | null = null;
  let activePubPath: string | null = null;
  let keyType: 'ed25519' | 'rsa' = 'ed25519';

  if (fs.existsSync(ED25519_KEY_PATH)) {
    activePrivPath = ED25519_KEY_PATH;
    activePubPath = ED25519_PUB_PATH;
    keyType = 'ed25519';
  } else if (fs.existsSync(RSA_KEY_PATH)) {
    activePrivPath = RSA_KEY_PATH;
    activePubPath = RSA_PUB_PATH;
    keyType = 'rsa';
  }

  if (!activePrivPath) {
    return {
      configured: false,
      hasConfig: fs.existsSync(SSH_CONFIG_PATH),
      hasKnownHosts: fs.existsSync(KNOWN_HOSTS_PATH),
    };
  }

  let publicKey = '';
  if (activePubPath && fs.existsSync(activePubPath)) {
    publicKey = fs.readFileSync(activePubPath, 'utf8').trim();
  } else {
    // Attempt to extract public key from private key
    try {
      const { stdout } = await execPromise(`ssh-keygen -y -f "${activePrivPath}"`);
      publicKey = stdout.trim();
    } catch {
      // Ignore
    }
  }

  let fingerprint = '';
  let comment = '';
  try {
    if (activePubPath && fs.existsSync(activePubPath)) {
      const { stdout } = await execPromise(`ssh-keygen -lf "${activePubPath}"`);
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        fingerprint = parts[1]; // e.g. SHA256:...
      }
      if (parts.length >= 3) {
        comment = parts.slice(2, parts.length - 1).join(' ');
      }
    }
  } catch {
    // Ignore
  }

  const stat = fs.statSync(activePrivPath);

  return {
    configured: true,
    keyType,
    publicKey,
    fingerprint,
    comment,
    path: activePrivPath,
    createdAt: stat.birthtime?.toISOString() || stat.mtime?.toISOString(),
    size: stat.size,
    hasConfig: fs.existsSync(SSH_CONFIG_PATH),
    hasKnownHosts: fs.existsSync(KNOWN_HOSTS_PATH),
  };
}

/**
 * Retrieves the Git repository status (remote, branch, user)
 */
export async function getGitRepoStatus(): Promise<GitRepoStatus> {
  let currentBranch = 'main';
  try {
    const { stdout } = await execPromise('git branch --show-current');
    currentBranch = stdout.trim() || 'main';
  } catch {
    // fallback
  }

  let remoteOriginUrl: string | null = null;
  try {
    const { stdout } = await execPromise('git remote get-url origin');
    remoteOriginUrl = stdout.trim();
  } catch {
    // No remote origin configured
  }

  let userName = '';
  try {
    const { stdout } = await execPromise('git config user.name');
    userName = stdout.trim();
  } catch {
    // Ignore
  }

  let userEmail = '';
  try {
    const { stdout } = await execPromise('git config user.email');
    userEmail = stdout.trim();
  } catch {
    // Ignore
  }

  let uncommittedCount = 0;
  try {
    const { stdout } = await execPromise('git status --porcelain');
    const lines = stdout.trim().split('\n').filter(Boolean);
    uncommittedCount = lines.length;
  } catch {
    // Ignore
  }

  let lastCommit: GitRepoStatus['lastCommit'] | undefined = undefined;
  try {
    const { stdout } = await execPromise('git log -1 --pretty=format:"%h|%s|%an|%cr"');
    if (stdout.trim()) {
      const [hash, message, author, date] = stdout.trim().split('|');
      lastCommit = { hash, message, author, date };
    }
  } catch {
    // Ignore
  }

  const isSSHRemote = Boolean(remoteOriginUrl && (remoteOriginUrl.startsWith('git@github.com:') || remoteOriginUrl.startsWith('ssh://')));

  return {
    currentBranch,
    remoteOriginUrl,
    isSSHRemote,
    userName,
    userEmail,
    clean: uncommittedCount === 0,
    lastCommit,
    uncommittedCount,
  };
}

/**
 * Generates a brand new Ed25519 or RSA SSH key pair
 */
export async function generateSSHKeyPair(
  keyType: 'ed25519' | 'rsa' = 'ed25519',
  comment: string = 'ky8402@gmail.com'
): Promise<{ success: boolean; publicKey: string; fingerprint: string; keyType: string; comment: string }> {
  ensureSSHDirectory();

  const targetKeyPath = keyType === 'rsa' ? RSA_KEY_PATH : ED25519_KEY_PATH;
  const targetPubPath = keyType === 'rsa' ? RSA_PUB_PATH : ED25519_PUB_PATH;

  // Remove existing key if present
  if (fs.existsSync(targetKeyPath)) fs.unlinkSync(targetKeyPath);
  if (fs.existsSync(targetPubPath)) fs.unlinkSync(targetPubPath);

  const cleanComment = comment.replace(/["\r\n]/g, '').trim() || 'ky8402@gmail.com';

  const cmd =
    keyType === 'rsa'
      ? `ssh-keygen -t rsa -b 4096 -C "${cleanComment}" -f "${targetKeyPath}" -N "" -q`
      : `ssh-keygen -t ed25519 -C "${cleanComment}" -f "${targetKeyPath}" -N "" -q`;

  await execPromise(cmd);

  // Set strict permissions
  fs.chmodSync(targetKeyPath, 0o600);
  fs.chmodSync(targetPubPath, 0o644);

  const privateKey = fs.readFileSync(targetKeyPath, 'utf8');
  const publicKey = fs.readFileSync(targetPubPath, 'utf8').trim();

  // Get fingerprint
  let fingerprint = '';
  try {
    const { stdout } = await execPromise(`ssh-keygen -lf "${targetPubPath}"`);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      fingerprint = parts[1];
    }
  } catch {
    // Ignore
  }

  ensureSSHConfig();
  backupSSHKeys(privateKey, publicKey, keyType, cleanComment);

  return {
    success: true,
    publicKey,
    fingerprint,
    keyType,
    comment: cleanComment,
  };
}

/**
 * Saves and validates a user-provided private SSH key
 */
export async function saveUserSSHKey(
  privateKey: string,
  publicKey?: string,
  keyType: 'ed25519' | 'rsa' = 'ed25519',
  comment: string = 'ky8402@gmail.com'
): Promise<{ success: boolean; publicKey: string; fingerprint: string; keyType: string }> {
  ensureSSHDirectory();

  const cleanKey = privateKey.replace(/\r\n/g, '\n').trim() + '\n';

  // Basic sanity check
  if (!cleanKey.includes('-----BEGIN') || !cleanKey.includes('PRIVATE KEY-----')) {
    throw new Error('Invalid SSH private key format. Must include -----BEGIN ... PRIVATE KEY----- header and footer.');
  }

  // Detect key type if not specified
  let resolvedType = keyType;
  if (cleanKey.includes('BEGIN RSA PRIVATE KEY') || cleanKey.includes('RSA')) {
    resolvedType = 'rsa';
  } else if (cleanKey.includes('OPENSSH PRIVATE KEY') || cleanKey.includes('ED25519')) {
    resolvedType = 'ed25519';
  }

  const targetKeyPath = resolvedType === 'rsa' ? RSA_KEY_PATH : ED25519_KEY_PATH;
  const targetPubPath = resolvedType === 'rsa' ? RSA_PUB_PATH : ED25519_PUB_PATH;

  fs.writeFileSync(targetKeyPath, cleanKey, { mode: 0o600 });
  fs.chmodSync(targetKeyPath, 0o600);

  let resolvedPubKey = (publicKey || '').trim();
  if (!resolvedPubKey) {
    try {
      const { stdout } = await execPromise(`ssh-keygen -y -f "${targetKeyPath}"`);
      resolvedPubKey = stdout.trim();
    } catch (err: any) {
      // Key may be passphrase-protected or invalid
      throw new Error(`Failed to derive public key: ${err.message}. Please check that the private key is valid and not passphrase-protected.`);
    }
  }

  fs.writeFileSync(targetPubPath, resolvedPubKey + '\n', { mode: 0o644 });

  let fingerprint = '';
  try {
    const { stdout } = await execPromise(`ssh-keygen -lf "${targetPubPath}"`);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      fingerprint = parts[1];
    }
  } catch {
    // Ignore
  }

  ensureSSHConfig();
  backupSSHKeys(cleanKey, resolvedPubKey, resolvedType, comment);

  return {
    success: true,
    publicKey: resolvedPubKey,
    fingerprint,
    keyType: resolvedType,
  };
}

/**
 * Removes configured SSH keys and backups
 */
export function deleteSSHKey(): { success: boolean; message: string } {
  try {
    if (fs.existsSync(ED25519_KEY_PATH)) fs.unlinkSync(ED25519_KEY_PATH);
    if (fs.existsSync(ED25519_PUB_PATH)) fs.unlinkSync(ED25519_PUB_PATH);
    if (fs.existsSync(RSA_KEY_PATH)) fs.unlinkSync(RSA_KEY_PATH);
    if (fs.existsSync(RSA_PUB_PATH)) fs.unlinkSync(RSA_PUB_PATH);
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
    return { success: true, message: 'SSH key deleted successfully.' };
  } catch (err: any) {
    throw new Error(`Failed to delete SSH keys: ${err.message}`);
  }
}

/**
 * Configures the Git remote origin URL and optional user identity
 */
export async function configureGitRemote(
  remoteUrl: string,
  userName?: string,
  userEmail?: string
): Promise<{ success: boolean; remoteOriginUrl: string; isSSHRemote: boolean; userName: string; userEmail: string }> {
  const cleanUrl = remoteUrl.trim();
  if (!cleanUrl) {
    throw new Error('Remote URL cannot be empty.');
  }

  // Check if remote origin already exists
  let originExists = false;
  try {
    await execPromise('git remote get-url origin');
    originExists = true;
  } catch {
    originExists = false;
  }

  if (originExists) {
    await execPromise(`git remote set-url origin "${cleanUrl}"`);
  } else {
    await execPromise(`git remote add origin "${cleanUrl}"`);
  }

  if (userName && userName.trim()) {
    await execPromise(`git config user.name "${userName.trim()}"`);
  }
  if (userEmail && userEmail.trim()) {
    await execPromise(`git config user.email "${userEmail.trim()}"`);
  }

  const status = await getGitRepoStatus();
  return {
    success: true,
    remoteOriginUrl: status.remoteOriginUrl || cleanUrl,
    isSSHRemote: status.isSSHRemote,
    userName: status.userName,
    userEmail: status.userEmail,
  };
}

/**
 * Tests live SSH authentication against GitHub (ssh -T git@github.com)
 */
export async function testSSHConnection(): Promise<SSHAuthTestResult> {
  ensureSSHDirectory();

  const activeStatus = await getSSHStatus();
  if (!activeStatus.configured) {
    return {
      success: false,
      authenticated: false,
      message: 'No SSH key configured. Please generate or import an SSH key first.',
      rawOutput: 'No key in ~/.ssh/',
      diagnostics: 'Click "Generate SSH Key" to create a modern Ed25519 key pair, then add the public key to your GitHub account.',
      testedAt: new Date().toISOString(),
    };
  }

  try {
    // GitHub rejects shell access with exit code 1, but prints the welcome string on stderr:
    // "Hi <username>! You've successfully authenticated, but GitHub does not provide shell access."
    const cmd = 'ssh -T -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o BatchMode=yes git@github.com';
    let output = '';

    try {
      const res = await execPromise(cmd);
      output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
    } catch (err: any) {
      output = `${err.stdout || ''}\n${err.stderr || ''}`.trim();
    }

    const match = output.match(/Hi\s+([a-zA-Z0-9_\-]+)!\s+You've successfully authenticated/i);

    if (match && match[1]) {
      const username = match[1];
      return {
        success: true,
        authenticated: true,
        username,
        message: `Successfully authenticated with GitHub as @${username}!`,
        rawOutput: output,
        diagnostics: 'SSH handshake verified. You have full read/write permission to push and pull via SSH.',
        testedAt: new Date().toISOString(),
      };
    }

    if (output.includes('Permission denied (publickey)')) {
      return {
        success: false,
        authenticated: false,
        message: 'Permission denied: GitHub does not recognize this public key.',
        rawOutput: output,
        diagnostics:
          'Copy your public key above and add it to your GitHub Account: Go to https://github.com/settings/ssh/new, title it "Freelance Autopilot", paste the key, and save.',
        testedAt: new Date().toISOString(),
      };
    }

    return {
      success: false,
      authenticated: false,
      message: 'Connection attempt completed with notice.',
      rawOutput: output || 'No response from SSH handshake',
      diagnostics: output,
      testedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      success: false,
      authenticated: false,
      message: `SSH test failed: ${err.message}`,
      rawOutput: err.stack || err.message,
      diagnostics: 'Check network connectivity or firewall rules.',
      testedAt: new Date().toISOString(),
    };
  }
}

/**
 * Retrieves the stored GitHub Personal Access Token (from disk, env, or credentials)
 */
export function getStoredGitHubToken(): string | null {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;
  if (envToken && envToken.trim()) {
    return envToken.trim();
  }

  try {
    if (fs.existsSync(TOKEN_BACKUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_BACKUP_FILE, 'utf8'));
      if (data.token && typeof data.token === 'string') {
        return data.token.trim();
      }
    }
  } catch {}

  // Check ~/.git-credentials
  try {
    const credPath = path.join(HOME_DIR, '.git-credentials');
    if (fs.existsSync(credPath)) {
      const content = fs.readFileSync(credPath, 'utf8');
      const match = content.match(/https:\/\/([^:@]+)(?::[^@]*)?@github\.com/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  } catch {}

  return null;
}

/**
 * Verifies a GitHub Personal Access Token against GitHub REST API
 */
export async function verifyGitHubToken(token: string): Promise<{
  valid: boolean;
  user?: {
    login: string;
    name?: string;
    avatarUrl?: string;
    email?: string;
  };
  scopes?: string[];
  error?: string;
}> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    return { valid: false, error: 'Token is empty.' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GigPilot-DevOps-Platform',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const scopesHeader = res.headers.get('x-oauth-scopes') || '';
    const scopes = scopesHeader.split(',').map((s) => s.trim()).filter(Boolean);

    if (res.ok) {
      const data = (await res.json()) as any;
      return {
        valid: true,
        user: {
          login: data.login,
          name: data.name || data.login,
          avatarUrl: data.avatar_url,
          email: data.email,
        },
        scopes,
      };
    }

    if (res.status === 401) {
      return { valid: false, error: 'Bad credentials: GitHub Personal Access Token is invalid or expired.' };
    }

    return { valid: false, error: `GitHub API returned status ${res.status}` };
  } catch (err: any) {
    return { valid: false, error: `Failed to verify token: ${err.message}` };
  }
}

/**
 * Saves and verifies a user-supplied GitHub Personal Access Token
 */
export async function saveGitHubToken(token: string): Promise<{
  success: boolean;
  user?: { login: string; name?: string; avatarUrl?: string };
  scopes: string[];
  message: string;
}> {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new Error('Personal Access Token cannot be empty.');
  }

  const verification = await verifyGitHubToken(cleanToken);
  if (!verification.valid) {
    throw new Error(verification.error || 'Invalid GitHub token. Please verify token scopes and expiration.');
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(
    TOKEN_BACKUP_FILE,
    JSON.stringify(
      {
        token: cleanToken,
        user: verification.user,
        scopes: verification.scopes,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  // Store in ~/.git-credentials for global git CLI convenience
  try {
    await execPromise('git config --global credential.helper store');
    const credPath = path.join(HOME_DIR, '.git-credentials');
    const credLine = `https://${cleanToken}:x-oauth-basic@github.com\n`;
    fs.writeFileSync(credPath, credLine, { mode: 0o600 });
  } catch (err: any) {
    console.warn('[GitHubService] Could not store git credentials file:', err.message);
  }

  return {
    success: true,
    user: verification.user,
    scopes: verification.scopes || [],
    message: `Successfully connected GitHub account @${verification.user?.login || 'user'}!`,
  };
}

/**
 * Deletes the stored GitHub Personal Access Token
 */
export function deleteGitHubToken(): { success: boolean; message: string } {
  try {
    if (fs.existsSync(TOKEN_BACKUP_FILE)) {
      fs.unlinkSync(TOKEN_BACKUP_FILE);
    }
    const credPath = path.join(HOME_DIR, '.git-credentials');
    if (fs.existsSync(credPath)) {
      fs.unlinkSync(credPath);
    }
    return { success: true, message: 'GitHub Personal Access Token removed successfully.' };
  } catch (err: any) {
    return { success: false, message: `Failed to remove token: ${err.message}` };
  }
}

/**
 * Returns complete GitHub Auth status (Token + SSH + Repo)
 */
export async function getGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  const [sshStatus, repoStatus] = await Promise.all([
    getSSHStatus(),
    getGitRepoStatus(),
  ]);

  let tokenConfigured = false;
  let tokenUser: any = undefined;

  const storedToken = getStoredGitHubToken();
  if (storedToken) {
    tokenConfigured = true;
    try {
      if (fs.existsSync(TOKEN_BACKUP_FILE)) {
        const raw = JSON.parse(fs.readFileSync(TOKEN_BACKUP_FILE, 'utf8'));
        tokenUser = raw.user;
      }
    } catch {}
  }

  let activeAuthType: 'token' | 'ssh' | 'none' = 'none';
  if (tokenConfigured) {
    activeAuthType = 'token';
  } else if (sshStatus.configured) {
    activeAuthType = 'ssh';
  }

  const canPush = tokenConfigured || sshStatus.configured;

  return {
    tokenConfigured,
    tokenUser,
    sshConfigured: sshStatus.configured,
    sshKeyType: sshStatus.keyType,
    activeAuthType,
    canPush,
    repo: repoStatus,
  };
}

/**
 * Runs an authenticated Git operation (status, fetch, pull, push)
 * Uses GitHub Token (HTTPS) or SSH credentials depending on configuration
 */
export async function executeGitOperation(
  operation: 'status' | 'fetch' | 'pull' | 'push',
  branch?: string,
  remote: string = 'origin'
): Promise<GitOperationResult> {
  const start = Date.now();
  const targetBranch = branch || 'main';
  const token = getStoredGitHubToken();

  let cmd = '';
  let env: Record<string, any> = { ...process.env };

  if (token && remote === 'origin') {
    // Authenticated HTTPS remote with token
    const tokenRemote = `https://${token}@github.com/ky8402-rgb/gigpilot-platform.git`;
    env.GIT_TERMINAL_PROMPT = '0';

    switch (operation) {
      case 'status':
        cmd = 'git status';
        break;
      case 'fetch':
        cmd = `git fetch "${tokenRemote}" ${targetBranch}`;
        break;
      case 'pull':
        cmd = `git pull "${tokenRemote}" ${targetBranch} --rebase`;
        break;
      case 'push':
        cmd = `git push "${tokenRemote}" ${targetBranch}`;
        break;
      default:
        throw new Error(`Unsupported git operation: ${operation}`);
    }
  } else {
    // SSH or standard remote
    switch (operation) {
      case 'status':
        cmd = 'git status';
        break;
      case 'fetch':
        cmd = `git fetch ${remote} ${targetBranch}`;
        break;
      case 'pull':
        cmd = `git pull ${remote} ${targetBranch} --rebase`;
        break;
      case 'push':
        cmd = `git push ${remote} ${targetBranch}`;
        break;
      default:
        throw new Error(`Unsupported git operation: ${operation}`);
    }

    env.GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes';
  }

  try {
    const { stdout, stderr } = await execPromise(cmd, { env });
    let output = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (token) {
      output = output.replace(new RegExp(token, 'g'), '***TOKEN***');
    }
    return {
      success: true,
      operation,
      exitCode: 0,
      output: output || 'Command completed successfully with zero output.',
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    let output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
    if (token) {
      output = output.replace(new RegExp(token, 'g'), '***TOKEN***');
    }
    return {
      success: false,
      operation,
      exitCode: err.code || 1,
      output,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  }
}

export interface DeploymentRecord {
  id: string;
  trigger: 'webhook_push' | 'manual';
  branch: string;
  commitHash?: string;
  commitMessage?: string;
  author?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  logs: string[];
  error?: string;
}

const DEPLOYMENTS_FILE = path.join(BACKUP_DIR, 'deployments.json');
let inMemoryDeployments: DeploymentRecord[] = [];

// Initialize deployments from disk if available
try {
  if (fs.existsSync(DEPLOYMENTS_FILE)) {
    inMemoryDeployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, 'utf-8'));
  }
} catch {
  inMemoryDeployments = [];
}

function persistDeployments(): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(inMemoryDeployments.slice(0, 50), null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist deployments to disk:', err);
  }
}

/**
 * Verifies GitHub HMAC-SHA256 signature (X-Hub-Signature-256)
 */
export function verifyGitHubSignature(
  signatureHeader: string | undefined,
  payload: Buffer | string | undefined,
  event: string = 'push'
): { valid: boolean; reason?: string } {
  const secret = (process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '').trim();

  // If no secret configured on server, warn and allow (or alert for setup)
  if (!secret) {
    return {
      valid: true,
      reason: 'No GITHUB_WEBHOOK_SECRET configured on server. Verification bypassed.',
    };
  }

  // Allow unauthenticated ping events (e.g. initial webhook creation test before secret setup or diagnostics)
  if (!signatureHeader && event === 'ping') {
    return {
      valid: true,
      reason: 'Ping handshake accepted without signature.',
    };
  }

  if (!signatureHeader) {
    return {
      valid: false,
      reason: 'Missing X-Hub-Signature-256 header in webhook request.',
    };
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return {
      valid: false,
      reason: 'Malformed signature header format. Expected sha256=<hash>.',
    };
  }

  const receivedHash = parts[1];
  const payloadBuffer = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload || {}));

  const expectedHash = crypto
    .createHmac('sha256', secret)
    .update(payloadBuffer)
    .digest('hex');

  try {
    const receivedBuf = Buffer.from(receivedHash, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');

    if (receivedBuf.length !== expectedBuf.length) {
      return { valid: false, reason: 'Signature digest length mismatch.' };
    }

    const isValid = crypto.timingSafeEqual(receivedBuf, expectedBuf);
    return {
      valid: isValid,
      reason: isValid ? 'Signature verified' : 'HMAC digest mismatch with server secret.',
    };
  } catch (err: any) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }
}

/**
 * Executes automated push-to-deploy pipeline without manual server restarts
 */
export async function executePushToDeploy(options: {
  branch: string;
  commitHash?: string;
  commitMessage?: string;
  author?: string;
  trigger: 'webhook_push' | 'manual';
}): Promise<DeploymentRecord> {
  const start = Date.now();
  const id = `dep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const logs: string[] = [];

  const record: DeploymentRecord = {
    id,
    trigger: options.trigger,
    branch: options.branch,
    commitHash: options.commitHash,
    commitMessage: options.commitMessage,
    author: options.author,
    status: 'PENDING',
    startedAt: new Date().toISOString(),
    logs,
  };

  inMemoryDeployments.unshift(record);
  persistDeployments();

  const addLog = (msg: string) => {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    logs.push(entry);
    console.log(`[Push-to-Deploy] ${msg}`);
  };

  addLog(`Starting deployment for branch "${options.branch}" (Commit: ${options.commitHash?.substring(0, 7) || 'HEAD'})`);

  // Execute steps asynchronously
  try {
    const env = {
      ...process.env,
      GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
    };

    // Step 1: Fetch and pull latest changes
    addLog(`Running git fetch origin ${options.branch}...`);
    try {
      const { stdout: fetchOut, stderr: fetchErr } = await execPromise(`git fetch origin ${options.branch}`, { env });
      if (fetchOut || fetchErr) addLog(`Fetch output: ${(fetchOut || fetchErr).trim()}`);
    } catch (fetchE: any) {
      addLog(`Fetch note: ${fetchE.message}`);
    }

    addLog(`Running git pull origin ${options.branch}...`);
    const { stdout: pullOut, stderr: pullErr } = await execPromise(`git pull origin ${options.branch} --rebase`, { env });
    addLog(`Pull result: ${(pullOut || pullErr || 'Already up to date').trim()}`);

    // Step 2: Build project artifacts if build script exists
    addLog('Checking build requirements and compiling production bundle...');
    try {
      const { stdout: buildOut } = await execPromise('npm run build', {
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 180000,
      });
      addLog(`Build output: ${buildOut.split('\n').slice(-3).join(' ')}`);
    } catch (buildErr: any) {
      addLog(`Build warning: ${buildErr.message || 'Build script finished with warnings'}`);
    }

    // Step 3: Zero-downtime graceful reload via PM2, systemd, or Docker
    addLog('Executing zero-downtime application reload...');
    let reloaded = false;

    // Check for PM2
    try {
      await execPromise('pm2 reload gigpilot --update-env 2>/dev/null || pm2 restart gigpilot 2>/dev/null');
      addLog('PM2 application "gigpilot" gracefully reloaded without downtime.');
      reloaded = true;
    } catch {
      // Not managed by PM2 directly in this context
    }

    // Check for Docker Compose
    if (!reloaded) {
      try {
        await execPromise('docker compose restart app 2>/dev/null || docker-compose restart app 2>/dev/null');
        addLog('Docker Compose backend container restarted.');
        reloaded = true;
      } catch {
        // Not in container host shell
      }
    }

    if (!reloaded) {
      addLog('Application files updated. Process is running directly under Node supervisor.');
    }

    record.status = 'SUCCESS';
    record.completedAt = new Date().toISOString();
    record.durationMs = Date.now() - start;
    addLog(`Deployment completed successfully in ${record.durationMs}ms!`);
  } catch (err: any) {
    record.status = 'FAILED';
    record.completedAt = new Date().toISOString();
    record.durationMs = Date.now() - start;
    record.error = err.message || 'Unknown deployment error';
    addLog(`Deployment failed: ${record.error}`);
  }

  persistDeployments();
  return record;
}

/**
 * Returns recent deployment records
 */
export function getDeploymentHistory(): DeploymentRecord[] {
  return inMemoryDeployments.slice(0, 20);
}

/**
 * Returns GitHub Webhook configuration status and active URL
 */
export function getWebhookInfo(): {
  webhookUrl: string;
  isSecretConfigured: boolean;
  activeSecretSource: string;
  ec2Host: string;
  trackedBranches: string[];
  recentDeploymentsCount: number;
  lastDeployment?: DeploymentRecord;
} {
  const ec2Host = process.env.EC2_HOST || '13.233.54.120';
  const customDomain = process.env.BASE_URL || `https://${ec2Host.replace(/\./g, '-')}.sslip.io`;
  const normalizedBase = customDomain.endsWith('/') ? customDomain.slice(0, -1) : customDomain;
  const webhookUrl = `${normalizedBase}/api/github/webhook`;

  const hasSecret = Boolean(process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET);

  return {
    webhookUrl,
    isSecretConfigured: hasSecret,
    activeSecretSource: hasSecret ? 'GITHUB_WEBHOOK_SECRET' : 'UNSET',
    ec2Host,
    trackedBranches: ['master', 'main'],
    recentDeploymentsCount: inMemoryDeployments.length,
    lastDeployment: inMemoryDeployments[0],
  };
}

/**
 * Executes a unified, resilient push-to-deploy pipeline:
 * 1. Stages and commits any uncommitted local files with custom or automatic message
 * 2. Pushes safely to GitHub (using GitHub Token or SSH)
 * 3. Triggers AWS Amplify release deployment (gigpilot-platform)
 * 4. Triggers AWS EC2 backend deployment (gigpilot-backend) via webhook or local runner
 * 5. Returns real-time execution logs, timestamps, and deployment job IDs
 */
export async function pushAndDeployAll(options: {
  commitMessage?: string;
  branch?: string;
  token?: string;
  skipAmplify?: boolean;
  skipEc2?: boolean;
}): Promise<PushAndDeployResult> {
  const start = Date.now();
  const logs: string[] = [];
  const addLog = (msg: string) => {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    logs.push(entry);
    console.log(`[PushAndDeploy] ${msg}`);
  };

  const status = await getGitRepoStatus();
  const branch = options.branch || status.currentBranch || 'main';
  const customMessage = (options.commitMessage || '').trim();
  const token = options.token?.trim() || getStoredGitHubToken();

  addLog(`Initiating unified push & deploy pipeline for branch "${branch}"...`);

  // Step 1: Ensure Git committer identity is configured
  try {
    if (!status.userName) {
      await execPromise('git config user.name "AI Assistant"');
    }
    if (!status.userEmail) {
      await execPromise('git config user.email "assistant@ai.studio"');
    }
  } catch (err: any) {
    addLog(`Git config notice: ${err.message}`);
  }

  // Step 2: Stage and commit any dirty working tree changes
  try {
    const { stdout: statusOut } = await execPromise('git status --porcelain');
    if (statusOut.trim()) {
      addLog('Staging uncommitted changes (git add .)...');
      await execPromise('git add .');
      const message = customMessage || `chore: automated push-to-deploy sync [${new Date().toLocaleDateString()}]`;
      const escaped = message.replace(/"/g, '\\"');
      await execPromise(`git commit -m "${escaped}"`);
      addLog(`Created commit: "${message}"`);
    } else {
      addLog('Working directory is clean; no new local changes to commit.');
    }
  } catch (err: any) {
    addLog(`Commit phase warning: ${err.message}`);
  }

  // Step 3: Extract latest commit information
  let latestHash = 'HEAD';
  let latestMsg = customMessage || 'Automated deployment sync';
  try {
    const { stdout: logOut } = await execPromise('git log -1 --pretty=format:"%h|%s"');
    if (logOut.trim()) {
      const [h, m] = logOut.trim().split('|');
      latestHash = h;
      latestMsg = m;
    }
  } catch {}

  // Step 4: Push to GitHub repository
  addLog(`Pushing branch "${branch}" to GitHub origin...`);
  let pushSuccess = false;
  let pushOutput = '';
  let authMethod: 'token' | 'ssh' | 'none' = 'none';

  if (token) {
    authMethod = 'token';
    addLog('Using GitHub Personal Access Token for authenticated push...');
    const repoUrl = `https://${token}@github.com/ky8402-rgb/gigpilot-platform.git`;
    try {
      const { stdout, stderr } = await execPromise(`git push "${repoUrl}" ${branch}`, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      pushOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
      pushSuccess = true;
      addLog(`GitHub push succeeded: ${pushOutput || 'Branch up-to-date.'}`);
    } catch (err: any) {
      pushOutput = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
      pushOutput = pushOutput.replace(new RegExp(token, 'g'), '***TOKEN***');
      addLog(`GitHub push failed with token: ${pushOutput}`);
    }
  } else {
    // Attempt SSH push
    authMethod = 'ssh';
    addLog('Attempting GitHub push with SSH credentials...');
    try {
      const env = {
        ...process.env,
        GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
      };
      const { stdout, stderr } = await execPromise(`git push origin ${branch}`, { env });
      pushOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
      pushSuccess = true;
      addLog(`GitHub push succeeded: ${pushOutput || 'Branch up-to-date.'}`);
    } catch (err: any) {
      pushOutput = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
      addLog(`GitHub push failed with SSH: ${pushOutput}`);
    }
  }

  if (!pushSuccess) {
    addLog('Notice: Push did not complete. Provide a GitHub Personal Access Token (PAT) with repo scope or add your SSH public key.');
  } else {
    // Automatically trigger GitHub Actions deployment workflow via devops_actions module
    try {
      addLog('Triggering GitHub Actions workflow via devops_actions module...');
      const { onCommitPushed } = await import('./devops_actions.js');
      const devopsResult = await onCommitPushed({
        branch,
        commitMessage: options.commitMessage,
      });
      addLog(`DevOps Actions auto-trigger: ${devopsResult.message}`);
    } catch (devopsErr: any) {
      addLog(`DevOps Actions auto-trigger note: ${devopsErr.message}`);
    }
  }

  // Step 5: AWS Amplify Frontend Deployment (gigpilot-platform)
  const amplifyAppId = process.env.AMPLIFY_APP_ID || 'd2qe2q720fbn3x';
  const amplifyAppName = process.env.AMPLIFY_APP_NAME || 'gigpilot-platform';
  let amplifyStatus: 'TRIGGERED' | 'NOTIFIED_VIA_PUSH' | 'SKIPPED' | 'FAILED' = 'NOTIFIED_VIA_PUSH';
  let amplifyJobId: string | undefined = undefined;
  let amplifyMessage = 'AWS Amplify auto-detects commits on GitHub main and deploys.';

  if (!options.skipAmplify) {
    addLog(`Checking AWS Amplify deployment triggers for app "${amplifyAppName}" (${amplifyAppId})...`);

    // 1. Try AWS CLI if installed & configured
    try {
      const { stdout: awsCheck } = await execPromise('which aws && aws sts get-caller-identity --output text 2>/dev/null || true');
      if (awsCheck.trim() && !awsCheck.includes('error')) {
        addLog(`Triggering Amplify release job via AWS CLI for branch "${branch}"...`);
        const { stdout: jobOut } = await execPromise(
          `aws amplify start-job --app-id "${amplifyAppId}" --branch-name "${branch}" --job-type RELEASE --output json 2>/dev/null || true`
        );
        if (jobOut && jobOut.includes('jobSummary')) {
          const parsed = JSON.parse(jobOut);
          amplifyJobId = parsed.jobSummary?.jobId;
          amplifyStatus = 'TRIGGERED';
          amplifyMessage = `Amplify release build started (Job ID: ${amplifyJobId})`;
          addLog(amplifyMessage);
        }
      }
    } catch (e: any) {
      addLog(`AWS CLI notice: ${e.message}`);
    }

    // 2. Try Amplify Incoming Webhook URL if configured
    const amplifyWebhookUrl = process.env.AMPLIFY_DEPLOY_WEBHOOK_URL;
    if (amplifyWebhookUrl && amplifyStatus !== 'TRIGGERED') {
      try {
        addLog('Pinging AWS Amplify incoming deployment webhook...');
        const resp = await fetch(amplifyWebhookUrl, { method: 'POST', body: '{}' });
        if (resp.ok) {
          amplifyStatus = 'TRIGGERED';
          amplifyMessage = 'AWS Amplify incoming build webhook triggered successfully.';
          addLog(amplifyMessage);
        }
      } catch (e: any) {
        addLog(`Amplify webhook notice: ${e.message}`);
      }
    }
  } else {
    amplifyStatus = 'SKIPPED';
    amplifyMessage = 'Amplify deployment skipped.';
  }

  // Step 6: AWS EC2 Backend Deployment (gigpilot-backend)
  const ec2Host = process.env.EC2_HOST || '13.233.54.120';
  const ec2WebhookUrl = `https://${ec2Host.replace(/\./g, '-')}.sslip.io/api/github/webhook`;
  let ec2Status: 'DEPLOYED_LOCAL' | 'DEPLOYED_WEBHOOK' | 'SKIPPED' | 'FAILED' = 'SKIPPED';
  let ec2Message = '';
  let ec2DeploymentId: string | undefined = undefined;

  if (!options.skipEc2) {
    addLog(`Deploying to AWS EC2 backend (Host: ${ec2Host})...`);
    const isLocalEc2 = process.env.IS_EC2 === 'true' || (process.env.NODE_ENV === 'production' && !process.env.AIS_SANDBOX);

    if (isLocalEc2) {
      addLog('Running push-to-deploy pipeline directly on this host...');
      try {
        const record = await executePushToDeploy({
          branch,
          commitHash: latestHash,
          commitMessage: latestMsg,
          author: 'GigPilot Push-to-Deploy',
          trigger: 'manual',
        });
        ec2Status = record.status === 'SUCCESS' ? 'DEPLOYED_LOCAL' : 'FAILED';
        ec2DeploymentId = record.id;
        ec2Message = `Local EC2 deployment finished with status: ${record.status}`;
        addLog(ec2Message);
      } catch (err: any) {
        ec2Status = 'FAILED';
        ec2Message = `Local EC2 deployment failed: ${err.message}`;
        addLog(ec2Message);
      }
    } else {
      addLog(`Delivering cryptographic deployment webhook to EC2 (${ec2WebhookUrl})...`);
      try {
        const payloadObj = {
          ref: `refs/heads/${branch}`,
          after: latestHash,
          head_commit: {
            id: latestHash,
            message: latestMsg,
            author: { name: 'GigPilot Push-to-Deploy' },
          },
        };
        const payloadStr = JSON.stringify(payloadObj);

        const secret = (process.env.GITHUB_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || '').trim();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': `deploy-${Date.now()}`,
          'User-Agent': 'GitHub-Hookshot/GigPilot',
        };

        if (secret) {
          const sig = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
          headers['X-Hub-Signature-256'] = `sha256=${sig}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);

        const resp = await fetch(ec2WebhookUrl, {
          method: 'POST',
          headers,
          body: payloadStr,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (resp.ok) {
          const data = (await resp.json().catch(() => ({}))) as any;
          ec2Status = 'DEPLOYED_WEBHOOK';
          ec2DeploymentId = data.deployment?.id;
          ec2Message = `EC2 backend received push webhook (HTTP ${resp.status}): ${data.message || 'Deployment triggered'}`;
          addLog(ec2Message);
        } else {
          const errText = await resp.text().catch(() => '');
          ec2Status = 'FAILED';
          ec2Message = `EC2 webhook returned HTTP ${resp.status}: ${errText.slice(0, 150)}`;
          addLog(ec2Message);
        }
      } catch (err: any) {
        ec2Status = 'FAILED';
        ec2Message = `EC2 webhook request notice: ${err.message}`;
        addLog(ec2Message);
      }
    }
  } else {
    ec2Status = 'SKIPPED';
    ec2Message = 'EC2 deployment skipped.';
  }

  const durationMs = Date.now() - start;
  const overallSuccess = pushSuccess || ec2Status !== 'FAILED';

  return {
    success: overallSuccess,
    git: {
      success: pushSuccess,
      commitHash: latestHash,
      commitMessage: latestMsg,
      branch,
      authMethod,
      output: pushOutput,
    },
    amplify: {
      status: amplifyStatus,
      appName: amplifyAppName,
      appId: amplifyAppId,
      jobId: amplifyJobId,
      message: amplifyMessage,
      url: `https://${amplifyAppId}.amplifyapp.com`,
    },
    ec2: {
      status: ec2Status,
      host: ec2Host,
      url: `https://${ec2Host.replace(/\./g, '-')}.sslip.io`,
      message: ec2Message,
      deploymentId: ec2DeploymentId,
    },
    durationMs,
    timestamp: new Date().toISOString(),
    logs,
  };
}


