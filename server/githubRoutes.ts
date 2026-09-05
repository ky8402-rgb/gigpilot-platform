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
  verifyGitHubSignature,
  executePushToDeploy,
  getDeploymentHistory,
  getWebhookInfo,
  saveGitHubToken,
  deleteGitHubToken,
  getGitHubAuthStatus,
  pushAndDeployAll,
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

/**
 * GET /api/github/webhook-info
 * Returns the exact GitHub Webhook URL, secret configuration status, and tracked repository
 */
githubRoutes.get('/webhook-info', async (req, res) => {
  try {
    const info = getWebhookInfo();
    const repo = await getGitRepoStatus();
    return res.json({
      success: true,
      webhook: info,
      repo,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to retrieve webhook info',
    });
  }
});

/**
 * POST /api/github/webhook
 * Incoming GitHub webhook handler (push and ping events)
 * Authenticates HMAC-SHA256 signature and triggers automated push-to-deploy
 */
githubRoutes.post('/webhook', async (req: any, res) => {
  const event = (req.headers['x-github-event'] as string) || 'push';
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const deliveryId = req.headers['x-github-delivery'] || `del-${Date.now()}`;

  console.log(`[GitHub Webhook] Received ${event} event (Delivery: ${deliveryId})`);

  // Verify signature (allows test/ping handshakes while strictly enforcing push deployments)
  const rawBody = req.rawBody || req.body;
  const verification = verifyGitHubSignature(signature, rawBody, event);

  if (!verification.valid) {
    console.info(`[GitHub Webhook] Signature verification notice: ${verification.reason}`);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid GitHub webhook signature',
      reason: verification.reason,
    });
  }

  // Handle ping event (GitHub sends this on webhook creation or test)
  if (event === 'ping') {
    return res.status(200).json({
      success: true,
      message: 'Pong! GigPilot EC2 backend received and verified GitHub Webhook ping.',
      zen: req.body?.zen,
      hookId: req.body?.hook_id,
    });
  }

  // Handle push event
  if (event === 'push') {
    const payload = req.body || {};
    const ref = payload.ref || 'refs/heads/master';
    const branch = ref.replace('refs/heads/', '');
    const commitHash = payload.after || payload.head_commit?.id;
    const commitMessage = payload.head_commit?.message;
    const author = payload.head_commit?.author?.name || payload.pusher?.name || 'GitHub Pusher';

    console.log(`[GitHub Webhook] Validated push to "${branch}" by "${author}". Commit: ${commitHash?.substring(0, 7) || 'HEAD'}`);

    // Immediate response to GitHub to prevent HTTP timeout
    res.status(202).json({
      success: true,
      message: `Push-to-deploy triggered for branch "${branch}"`,
      commit: commitHash,
      branch,
      author,
      timestamp: new Date().toISOString(),
    });

    // Execute push-to-deploy asynchronously
    executePushToDeploy({
      branch,
      commitHash,
      commitMessage,
      author,
      trigger: 'webhook_push',
    }).catch((err) => {
      console.error('[GitHub Webhook] Background deployment execution error:', err);
    });

    return;
  }

  // Other GitHub events acknowledge with 200
  return res.status(200).json({
    success: true,
    message: `Event "${event}" acknowledged. No deployment action required.`,
  });
});

/**
 * GET /api/github/deployments
 * Returns history of automated push-to-deploy executions
 */
githubRoutes.get('/deployments', (req, res) => {
  return res.json({
    success: true,
    deployments: getDeploymentHistory(),
  });
});

/**
 * POST /api/github/trigger-deploy
 * Manually initiates push-to-deploy without waiting for GitHub push event
 */
githubRoutes.post('/trigger-deploy', async (req, res) => {
  try {
    const { branch = 'master' } = req.body || {};
    const deployment = await executePushToDeploy({
      branch,
      trigger: 'manual',
      author: req.body?.author || 'Manual Trigger',
      commitMessage: req.body?.reason || 'Manual deployment triggered from interface',
    });

    return res.json({
      success: deployment.status === 'SUCCESS',
      deployment,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to trigger deployment',
    });
  }
});

/**
 * GET /api/github/auth-status
 * Returns combined GitHub authentication state (Token + SSH + Repo)
 */
githubRoutes.get('/auth-status', async (req, res) => {
  try {
    const status = await getGitHubAuthStatus();
    return res.json({
      success: true,
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to load GitHub authentication status',
    });
  }
});

/**
 * POST /api/github/save-token
 * Validates and saves a GitHub Personal Access Token
 */
githubRoutes.post('/save-token', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({
        success: false,
        error: 'GitHub Personal Access Token is required.',
      });
    }

    const result = await saveGitHubToken(token);
    const authStatus = await getGitHubAuthStatus();

    return res.json({
      success: true,
      message: result.message,
      user: result.user,
      scopes: result.scopes,
      authStatus,
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to validate or store GitHub token',
    });
  }
});

/**
 * DELETE /api/github/delete-token
 * Removes stored GitHub Personal Access Token
 */
githubRoutes.delete('/delete-token', async (req, res) => {
  try {
    const result = deleteGitHubToken();
    const authStatus = await getGitHubAuthStatus();

    return res.json({
      success: result.success,
      message: result.message,
      authStatus,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to remove GitHub token',
    });
  }
});

/**
 * POST /api/github/push-and-deploy
 * Unified Push-to-Deploy: stages & commits pending work, pushes to GitHub,
 * and triggers automated deployments on AWS Amplify and AWS EC2!
 */
githubRoutes.post('/push-and-deploy', async (req, res) => {
  try {
    const {
      commitMessage,
      branch,
      token,
      skipAmplify = false,
      skipEc2 = false,
    } = req.body || {};

    const result = await pushAndDeployAll({
      commitMessage,
      branch,
      token,
      skipAmplify,
      skipEc2,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Push-and-deploy execution encountered a critical error.',
    });
  }
});


