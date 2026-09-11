import express, { Request, Response } from 'express';
import {
  executeSelfUpdatingPipeline,
  runPrompt1Orchestrator,
  runPrompt2SelfUpdatingEngine,
  runSandboxTestsAndTelemetry,
  getAllExecutionRuns,
  getExecutionRunById,
  rollbackLiveUpdate,
  PRESET_SCENARIOS,
  PipelineInput
} from './orchestratorEngine.js';

const router = express.Router();

/**
 * GET /api/orchestrator/presets
 * Returns predefined sample user chat and AIOps error log scenarios
 */
router.get('/presets', (_req: Request, res: Response) => {
  res.json({
    success: true,
    presets: PRESET_SCENARIOS
  });
});

/**
 * GET /api/orchestrator/runs
 * Returns all historical closed-loop pipeline execution runs
 */
router.get('/runs', (_req: Request, res: Response) => {
  const runs = getAllExecutionRuns();
  res.json({
    success: true,
    total: runs.length,
    runs
  });
});

/**
 * GET /api/orchestrator/runs/:id
 * Get a specific pipeline run by ID
 */
router.get('/runs/:id', (req: Request, res: Response) => {
  const run = getExecutionRunById(req.params.id);
  if (!run) {
    return res.status(404).json({ success: false, error: 'Pipeline run not found' });
  }
  res.json({ success: true, run });
});

/**
 * POST /api/orchestrator/pipeline/run
 * Executes the entire closed loop:
 * [ User Chat ] OR [ AIOps Error Log ] 
 *               │
 *               ▼
 *     [ Prompt 1: Orchestrator ] 
 *               │ (Creates Structured Specs)
 *               ▼
 *     [ Prompt 2: Self-Updating Engine ] ──► [ Modifies Code in Sandbox ]
 *               ▲                                      │
 *               │ (If Tests/Telemetry Fail)            ▼
 *               └─────────────────────────── [ Runs App & Tests ]
 *                                                      │ (If Success)
 *                                                      ▼
 *                                            [ Live App Updates ]
 */
router.post('/pipeline/run', async (req: Request, res: Response) => {
  try {
    const { source, content, context, maxIterations, simulateFailureOnFirstIteration } = req.body;

    if (!source || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: source (user_chat | aiops_error_log) and content string.'
      });
    }

    const input: PipelineInput = {
      source: source === 'aiops_error_log' ? 'aiops_error_log' : 'user_chat',
      content: String(content).trim(),
      context: context || {}
    };

    const run = await executeSelfUpdatingPipeline(input, {
      maxIterations: Number(maxIterations) || 3,
      simulateFailureOnFirstIteration: Boolean(simulateFailureOnFirstIteration)
    });

    res.json({
      success: run.status === 'live_deployed',
      run
    });
  } catch (err: any) {
    console.error('🚨 [OrchestratorRoute] Pipeline execution error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Internal pipeline execution error'
    });
  }
});

/**
 * POST /api/orchestrator/spec
 * Runs Prompt 1 (Orchestrator) independently to generate a Structured Spec
 */
router.post('/spec', async (req: Request, res: Response) => {
  try {
    const { source, content, context } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: 'Content is required' });
    }

    const input: PipelineInput = {
      source: source === 'aiops_error_log' ? 'aiops_error_log' : 'user_chat',
      content: String(content).trim(),
      context: context || {}
    };

    const spec = await runPrompt1Orchestrator(input);
    res.json({ success: true, spec });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orchestrator/update-engine
 * Runs Prompt 2 (Self-Updating Engine) on a provided spec
 */
router.post('/update-engine', async (req: Request, res: Response) => {
  try {
    const { spec, iteration, previousFailure, customInstructions } = req.body;
    if (!spec) {
      return res.status(400).json({ success: false, error: 'Structured Spec is required' });
    }

    const patch = await runPrompt2SelfUpdatingEngine({
      spec,
      iteration: Number(iteration) || 1,
      previousFailure,
      customInstructions
    });

    res.json({ success: true, patch });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orchestrator/test-run
 * Runs sandbox tests and telemetry assertions on a patch
 */
router.post('/test-run', async (req: Request, res: Response) => {
  try {
    const { spec, patch, iteration, simulateFailure } = req.body;
    if (!spec || !patch) {
      return res.status(400).json({ success: false, error: 'Spec and Patch are required' });
    }

    const testResult = await runSandboxTestsAndTelemetry({
      spec,
      patch,
      iteration: Number(iteration) || 1,
      simulateFailureOnFirstIteration: Boolean(simulateFailure)
    });

    res.json({ success: true, testResult });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orchestrator/rollback/:id
 * Rolls back a deployed live update
 */
router.post('/rollback/:id', async (req: Request, res: Response) => {
  try {
    const result = await rollbackLiveUpdate(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
