import express from 'express';
import {
  getSSHStatus,
  getGitRepoStatus,
  generateSSHKeyPair,
  saveUserSSHKey,
  deleteSSHKey,
  configureGitRemote,
  testSSHConnection,
  executeGitOperation,
} from './githubService.js';

export const githubRoutes = express.Router();

/**
 * GET /api/github/status
 * Fetches SSH key configuration and git repository status
 */
githubRoutes.get('/status', async (req, res) => {
  try {
    const [sshStatus, repoStatus] = await Promise.all([
      getSSHStatus(),
      getGitRepoStatus(),
    ]);

    return res.json({
      success: true,
      ssh: sshStatus,
      repo: repoStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch GitHub SSH status',
    });
  }
});

/**
 * POST /api/github/generate-ssh
 * Generates a new SSH key pair (Ed25519 or RSA)
 */
githubRoutes.post('/generate-ssh', async (req, res) => {
  try {
    const { keyType = 'ed25519', comment = 'ky8402@gmail.com' } = req.body || {};
    const validKeyType = keyType === 'rsa' ? 'rsa' : 'ed25519';

    const result = await generateSSHKeyPair(validKeyType, comment);
    const repoStatus = await getGitRepoStatus();

    return res.json({
      success: true,
      message: `Successfully generated ${result.keyType.toUpperCase()} SSH key pair`,
      key: result,
      repo: repoStatus,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate SSH key pair',
    });
  }
});

/**
 * POST /api/github/save-ssh
 * Saves user-provided private and public SSH key
 */
githubRoutes.post('/save-ssh', async (req, res) => {
  try {
    const { privateKey, publicKey, keyType = 'ed25519', comment = 'ky8402@gmail.com' } = req.body || {};

    if (!privateKey || typeof privateKey !== 'string' || !privateKey.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Private key is required.',
      });
    }

    const result = await saveUserSSHKey(privateKey, publicKey, keyType, comment);
    const repoStatus = await getGitRepoStatus();

    return res.json({
      success: true,
      message: 'SSH key securely saved and configured.',
      key: result,
      repo: repoStatus,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to save SSH key',
    });
  }
});

/**
 * DELETE /api/github/delete-ssh
 * Deletes configured SSH key
 */
githubRoutes.delete('/delete-ssh', async (req, res) => {
  try {
    const result = deleteSSHKey();
    const repoStatus = await getGitRepoStatus();

    return res.json({
      success: true,
      message: result.message,
      repo: repoStatus,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to delete SSH key',
    });
  }
});

/**
 * POST /api/github/configure-remote
 * Updates Git remote origin URL and user info
 */
githubRoutes.post('/configure-remote', async (req, res) => {
  try {
    const { remoteUrl, userName, userEmail } = req.body || {};

    if (!remoteUrl || typeof remoteUrl !== 'string' || !remoteUrl.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Remote URL is required (e.g., git@github.com:username/repository.git)',
      });
    }

    const result = await configureGitRemote(remoteUrl, userName, userEmail);

    return res.json({
      success: true,
      message: 'Git remote origin successfully configured.',
      config: result,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to configure remote URL',
    });
  }
});

/**
 * POST /api/github/test-connection
 * Runs live SSH authentication check with GitHub
 */
githubRoutes.post('/test-connection', async (req, res) => {
  try {
    const result = await testSSHConnection();
    return res.json({
      success: true,
      result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to test SSH connection',
    });
  }
});

/**
 * POST /api/github/git-op
 * Executes git fetch, pull, push, or status with SSH authentication
 */
githubRoutes.post('/git-op', async (req, res) => {
  try {
    const { operation = 'status', branch = 'main', remote = 'origin' } = req.body || {};

    if (!['status', 'fetch', 'pull', 'push'].includes(operation)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid operation. Supported: status, fetch, pull, push',
      });
    }

    const result = await executeGitOperation(operation as any, branch, remote);
    const repoStatus = await getGitRepoStatus();

    return res.json({
      success: result.success,
      result,
      repo: repoStatus,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to execute git operation',
    });
  }
});
