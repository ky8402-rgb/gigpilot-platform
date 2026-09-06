import { Router, Request, Response } from 'express';
import {
  getAutoDeployPipelineStatus,
  generateWorkflowFile,
  executeAutoDeploy,
  getSecretsConfigurationGuide,
} from './autoDeployTool.js';
import { triggerWorkflowDispatch, listWorkflowRuns } from './devops_actions.js';

const router = Router();

/**
 * GET /api/auto-deploy/status
 * Fetches real-time status of the automated GitHub Actions -> EC2 & Amplify pipeline
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await getAutoDeployPipelineStatus();
    return res.json(status);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auto-deploy/generate-workflow
 * Generates and validates the .github/workflows/deploy.yml file on disk
 */
router.post('/generate-workflow', async (_req: Request, res: Response) => {
  try {
    const result = generateWorkflowFile();
    const status = await getAutoDeployPipelineStatus();
    return res.json({
      ...result,
      workflow: status.workflow,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auto-deploy/run
 * One-click push & auto-deploy tool execution:
 * Commits, pushes to main, activates GitHub Actions -> EC2 and AWS Amplify -> Frontend
 */
router.post('/run', async (req: Request, res: Response) => {
  try {
    const { commitMessage, author, branch = 'main' } = req.body || {};
    const result = await executeAutoDeploy({
      commitMessage,
      author,
      branch,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auto-deploy/trigger-workflow
 * Directly triggers the GitHub Actions deploy.yml workflow run
 */
router.post('/trigger-workflow', async (req: Request, res: Response) => {
  try {
    const { branch = 'main', triggeredBy = 'User (Auto-Deploy Tool)' } = req.body || {};
    const result = await triggerWorkflowDispatch({
      workflowId: 'deploy.yml',
      branch,
      triggeredBy,
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/auto-deploy/secrets-guide
 * Returns guide and values for setting up GitHub Actions secrets
 */
router.get('/secrets-guide', async (_req: Request, res: Response) => {
  try {
    const guide = getSecretsConfigurationGuide();
    return res.json({ success: true, ...guide });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/auto-deploy/runs
 * Returns recent GitHub Actions workflow runs
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

export default router;
