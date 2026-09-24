import { Router, Request, Response } from 'express';
import { aiAgent } from './ai/agent.js';
import { getApplicationContext, getSystemState } from './ai/context.js';
import { getAllRegisteredTools, getToolsSummaryForAI } from './tools/index.js';
import { learningPipeline } from './aiops/training.js';
import { issueClassifier } from './aiops/classifier.js';
import { failurePredictor } from './aiops/predictor.js';
import { remediationSelector } from './aiops/remediationSelector.js';
import { anomalyDetector } from './aiops/anomalyDetector.js';
import { captureCurrentTelemetry } from './aiops/telemetry.js';
import { eventBus } from './events/eventBus.js';
import { auditStore } from './ai/auditStore.js';
import { aiPlanner } from './ai/planner.js';

export const aiRouter = Router();

// 1. Live Context API
aiRouter.get('/api/ai/context', async (req: Request, res: Response) => {
  try {
    const context = await getApplicationContext();
    res.json({ success: true, context });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Real System State API (Zod Validated)
aiRouter.get('/api/ai/state', async (req: Request, res: Response) => {
  try {
    const state = await getSystemState();
    res.json({ success: true, state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. AI Tool Registry List
aiRouter.get('/api/ai/tools', (req: Request, res: Response) => {
  try {
    const tools = getToolsSummaryForAI();
    res.json({ success: true, tools, count: tools.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. AI Intent Dry-Run Analysis
aiRouter.post('/api/ai/intent', async (req: Request, res: Response) => {
  try {
    const { message, conversationId } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'Message text is required' });
      return;
    }
    const telemetry = await captureCurrentTelemetry();
    const issue = issueClassifier.classify(telemetry);
    const intent = await aiPlanner.classifyIntent(message, conversationId || 'session', issue);
    res.json({ success: true, intent });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Immutable Audit Events Query API
aiRouter.get('/api/ai/audit', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const conversationId = req.query.conversationId as string | undefined;
    const planId = req.query.planId as string | undefined;
    const eventType = req.query.eventType as any;
    const status = req.query.status as string | undefined;

    const events = auditStore.getEvents({
      limit,
      conversationId,
      planId,
      eventType,
      status,
    });

    res.json({ success: true, events, count: events.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. AI Chat Execution (REST Direct)
aiRouter.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { message, userConfirmed, conversationId } = req.body || {};
    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'Message text is required' });
      return;
    }

    const result = await aiAgent.handleCommand(
      message,
      Boolean(userConfirmed),
      undefined,
      conversationId || 'default-session'
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. AI Chat Streaming (Server-Sent Events)
aiRouter.post('/api/ai/chat/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const { message, userConfirmed, conversationId } = req.body || {};
  if (!message || typeof message !== 'string') {
    res.write(`data: ${JSON.stringify({ state: 'FAILED', message: 'Message is required' })}\n\n`);
    res.end();
    return;
  }

  const onProgress = (event: any) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {}
  };

  try {
    const result = await aiAgent.handleCommand(
      message,
      Boolean(userConfirmed),
      onProgress,
      conversationId || 'default-session'
    );
    res.write(`data: ${JSON.stringify({ state: 'DONE', result })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ state: 'FAILED', message: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// 8. System Event Bus Live SSE Stream for Frontend Dashboard
aiRouter.get('/api/ai/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  // Send initial recent events
  const recent = eventBus.getRecentEvents(10);
  res.write(`data: ${JSON.stringify({ type: 'INITIAL_EVENTS', events: recent })}\n\n`);

  const unsubscribe = eventBus.registerSseClient((event) => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'EVENT', event })}\n\n`);
    } catch {}
  });

  req.on('close', () => {
    unsubscribe();
  });
});

// 9. ML AIOps Models Status
aiRouter.get('/api/aiops/models', async (req: Request, res: Response) => {
  try {
    const telemetry = await captureCurrentTelemetry();
    const issue = issueClassifier.classify(telemetry);
    const failure = failurePredictor.predict(telemetry);
    const remediation = remediationSelector.selectRemediation(issue);
    const anomaly = anomalyDetector.detect(telemetry);

    res.json({
      success: true,
      activeModel: learningPipeline.getActiveModel(),
      candidateModel: learningPipeline.getCandidateModel(),
      models: {
        model1_classifier: {
          name: 'Telemetry Issue Classifier',
          currentPrediction: issue,
          features: ['cpu', 'memory', 'db_latency', 'queue_depth', 'scraper_status'],
        },
        model2_predictor: {
          name: 'Component Failure Predictor',
          currentPrediction: failure,
        },
        model3_remediation: {
          name: 'Remediation Selector',
          currentRecommendation: remediation,
        },
        model4_anomaly: {
          name: 'Telemetry Anomaly Detector',
          currentDetection: anomaly,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Retrain & Model Promotion Endpoint
aiRouter.post('/api/aiops/retrain', async (req: Request, res: Response) => {
  try {
    const report = await learningPipeline.retrainCandidateModel();
    res.json({
      success: true,
      ...report,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Model Rollback Endpoint
aiRouter.post('/api/aiops/rollback', (req: Request, res: Response) => {
  try {
    const { targetVersion } = req.body || {};
    const report = learningPipeline.rollbackModel(targetVersion);
    res.json({
      success: true,
      ...report,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Incident History Endpoint
aiRouter.get('/api/aiops/incidents', (req: Request, res: Response) => {
  try {
    const incidents = learningPipeline.getIncidentHistory();
    res.json({ success: true, incidents, count: incidents.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
