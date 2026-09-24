import { Router, Request, Response } from 'express';
import {
  listWorkflows,
  triggerWorkflowDispatch,
  listWorkflowRuns,
  onCommitPushed,
  getRepoOwnerAndName,
} from './devops_actions.js';
import { getGitRepoStatus } from './githubService.js';

const router = Router();

/**
 * GET /api/devops/status
 * Fetches DevOps actions integration status, repository details, and available workflows
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const [{ owner, repo }, repoStatus, workflows, runs] = await Promise.all([
      getRepoOwnerAndName(),
      getGitRepoStatus(),
      listWorkflows(),
      listWorkflowRuns(5),
    ]);

    return res.json({
      success: true,
      repository: { owner, repo, currentBranch: repoStatus.currentBranch },
      autoTriggerOnPush: true,
      workflowsCount: workflows.length,
      workflows,
      recentRuns: runs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/devops/workflows
 * Lists all GitHub Actions workflows in the repo
 */
router.get('/workflows', async (_req: Request, res: Response) => {
  try {
    const workflows = await listWorkflows();
    return res.json({ success: true, workflows });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/devops/runs
 * Lists recent workflow runs
 */
router.get('/runs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const runs = await listWorkflowRuns(limit);
    return res.json({ success: true, runs });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/devops/deploy
 * Directly triggers the deployment workflow (deploy.yml) via GitHub Actions API
 */
router.post('/deploy', async (req: Request, res: Response) => {
  try {
    const {
      workflowId = 'deploy.yml',
      branch = 'main',
      inputs = {},
      triggeredBy = 'User (Dashboard)',
    } = req.body || {};

    const result = await triggerWorkflowDispatch({
      workflowId,
      branch,
      inputs,
      triggeredBy,
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/devops/auto-trigger-on-push
 * Hook called when new commits are pushed to auto-trigger the deployment workflow
 */
router.post('/auto-trigger-on-push', async (req: Request, res: Response) => {
  try {
    const { commitHash, commitMessage, branch, author } = req.body || {};

    const result = await onCommitPushed({
      commitHash,
      commitMessage,
      branch,
      author,
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
