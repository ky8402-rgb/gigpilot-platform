import fs from 'fs';
import path from 'path';
import os from 'os';
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

const HOME_DIR = os.homedir() || '/root';
const SSH_DIR = path.join(HOME_DIR, '.ssh');
const ED25519_KEY_PATH = path.join(SSH_DIR, 'id_ed25519');
const ED25519_PUB_PATH = path.join(SSH_DIR, 'id_ed25519.pub');
const RSA_KEY_PATH = path.join(SSH_DIR, 'id_rsa');
const RSA_PUB_PATH = path.join(SSH_DIR, 'id_rsa.pub');
const SSH_CONFIG_PATH = path.join(SSH_DIR, 'config');
const KNOWN_HOSTS_PATH = path.join(SSH_DIR, 'known_hosts');

// Persistence backup path in workspace so keys are retained across restarts
const BACKUP_DIR = path.join(process.cwd(), 'server', 'data');
const BACKUP_FILE = path.join(BACKUP_DIR, 'github_ssh_backup.json');

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
 * Runs an authenticated Git operation (status, fetch, pull, push)
 */
export async function executeGitOperation(
  operation: 'status' | 'fetch' | 'pull' | 'push',
  branch?: string,
  remote: string = 'origin'
): Promise<GitOperationResult> {
  const start = Date.now();
  const targetBranch = branch || 'main';

  let cmd = '';
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

  // Force git to use SSH with strict batch mode and accept-new host checking
  const env = {
    ...process.env,
    GIT_SSH_COMMAND: 'ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes',
  };

  try {
    const { stdout, stderr } = await execPromise(cmd, { env });
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return {
      success: true,
      operation,
      exitCode: 0,
      output: output || 'Command completed successfully with zero output.',
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n').trim();
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
