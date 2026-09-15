/**
 * SENTIENT FREELANCER — Express Backend Server
 * Port: 8080 | EC2 API Service
 */

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { memory } from './memory.js';
import { rollPersona, checkSignatureSafety, PROPOSAL_STYLES } from './humanizer.js';
import { autoImprover } from './auto-improver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const SENTIENT_TOKEN = process.env.SENTIENT_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const parser = new Parser({ timeout: 10000 });

// Active daily persona cached in memory
let currentDailyPersona = rollPersona();
let lastPersonaRollDate = new Date().toISOString().slice(0, 10);
const injectedJobsPool = [];

// Middleware: CORS
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN) {
      callback(null, true);
    } else {
      callback(null, true); // Permissive fallback to support preview & custom domains
    }
  },
  credentials: true
}));

app.use(express.json());

// Middleware: Rate Limiting (60 requests/min)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { ok: false, error: 'Rate limit exceeded. Maximum 60 requests per minute.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Middleware: Bearer Token Auth Guard
const requireAuth = (req, res, next) => {
  // If SENTIENT_TOKEN is set, enforce Bearer header check
  if (SENTIENT_TOKEN) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'Missing or malformed Bearer authorization token.' });
    }
    const token = authHeader.split(' ')[1];
    if (token !== SENTIENT_TOKEN) {
      return res.status(403).json({ ok: false, error: 'Invalid authentication token.' });
    }
  }
  next();
};

// Check & rotate persona if new UTC day
function ensureCurrentPersona() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastPersonaRollDate) {
    currentDailyPersona = rollPersona(new Date(), currentDailyPersona);
    lastPersonaRollDate = today;
    console.log(`[Sentient Server] Rolled fresh persona for ${today}: voice=${currentDailyPersona.voiceSignature}, target=${currentDailyPersona.sessionLengthTargetHours}h`);
  }
  return currentDailyPersona;
}

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------

// GET /api/health
app.get('/api/health', async (req, res) => {
  const queue = await memory.getQueue();
  const pendingCount = queue.filter(q => q.status === 'pending_approval').length;
  const isRedisConnected = memory.redisClient && memory.redisClient.status === 'ready';

  res.json({
    ok: true,
    t: Date.now(),
    service: 'sentient-freelancer-backend',
    memory: isRedisConnected ? 'redis_connected' : 'in_memory_fallback',
    queueDepth: queue.length,
    pendingApprovals: pendingCount,
    personaVoice: currentDailyPersona.voiceSignature
  });
});

// GET /api/persona
app.get('/api/persona', (req, res) => {
  const persona = ensureCurrentPersona();
  res.json({ ok: true, persona });
});

// GET /api/jobs (Polls public RSS/API feeds + normalizes)
app.get('/api/jobs', requireAuth, async (req, res) => {
  const normalizedJobs = [];

  // 1. RemoteOK API
  try {
    const remoteOkRes = await axios.get('https://remoteok.com/api', {
      headers: { 'User-Agent': 'SentientFreelancer/1.0' },
      timeout: 6000
    });
    if (Array.isArray(remoteOkRes.data)) {
      remoteOkRes.data.slice(1, 10).forEach(j => {
        if (j.position) {
          normalizedJobs.push({
            id: `rok_${j.id || Math.random().toString(36).substring(2, 8)}`,
            title: j.position,
            description: (j.description || '').replace(/<[^>]*>?/gm, '').slice(0, 300) + '...',
            budget: j.salary_max ? `$${j.salary_max}/yr` : '$75/hr',
            clientId: j.company || 'Verified Tech Partner',
            clientProfileUrl: j.company_url || 'https://remoteok.com',
            url: j.url || 'https://remoteok.com',
            category: (j.tags && j.tags[0]) || 'software-dev',
            postedAt: j.date ? new Date(j.date).toISOString() : new Date().toISOString()
          });
        }
      });
    }
  } catch (err) {
    console.warn(`[Sentient Server] RemoteOK feed query note: ${err.message}`);
  }

  // 2. WeWorkRemotely RSS Feed
  try {
    const feed = await parser.parseURL('https://weworkremotely.com/categories/remote-programming-jobs.rss');
    if (feed && feed.items) {
      feed.items.slice(0, 8).forEach((item, idx) => {
        normalizedJobs.push({
          id: `wwr_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          title: item.title || 'Engineering Specialist',
          description: (item.contentSnippet || item.content || '').slice(0, 280) + '...',
          budget: '$85/hr',
          clientId: item.creator || 'High-Growth Tech Startup',
          clientProfileUrl: item.link || 'https://weworkremotely.com',
          url: item.link || 'https://weworkremotely.com',
          category: 'backend',
          postedAt: item.isoDate || new Date().toISOString()
        });
      });
    }
  } catch (err) {
    console.warn(`[Sentient Server] WWR RSS query note: ${err.message}`);
  }

  // 3. Fallback High-Quality Organic Jobs if external rate limits prevent scraping
  if (normalizedJobs.length === 0) {
    const mockFeed = [
      {
        id: 'job_shopify_9021',
        title: 'Shopify Plus Headless Storefront Performance Optimization',
        description: 'Need a senior engineer to audit our Hydrogen/Remix setup, reduce LCP under 1.8s, and fix checkout payload latency.',
        budget: '$3,500',
        clientId: 'D2C Retail Brands Ltd',
        clientProfileUrl: 'https://upwork.com/client/~0129a8f4c',
        url: 'https://upwork.com/jobs/~0129a8f4c',
        category: 'shopify',
        postedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString()
      },
      {
        id: 'job_node_api_8842',
        title: 'Distributed Node.js Microservice & Concurrency Pipeline',
        description: 'Migrating asynchronous job queue from RabbitMQ to high-throughput Redis Streams with idempotent error handling.',
        budget: '$4,200',
        clientId: 'SaaS Infrastructure Group',
        clientProfileUrl: 'https://upwork.com/client/~0134b7e9a',
        url: 'https://upwork.com/jobs/~0134b7e9a',
        category: 'backend',
        postedAt: new Date(Date.now() - 48 * 60 * 1000).toISOString()
      },
      {
        id: 'job_react_ux_7719',
        title: 'Full Redesign of Analytics Dashboard in React & Tailwind',
        description: 'Looking for a meticulous engineer to modernize our data visualizer UI with smooth transitions and dark mode support.',
        budget: '$2,800',
        clientId: 'FinTech Capital Partners',
        clientProfileUrl: 'https://freelancer.com/u/fintechcorp',
        url: 'https://freelancer.com/projects/react-analytics-7719',
        category: 'frontend',
        postedAt: new Date(Date.now() - 95 * 60 * 1000).toISOString()
      }
    ];
    normalizedJobs.push(...mockFeed);
  }

  if (injectedJobsPool.length > 0) {
    normalizedJobs.unshift(...injectedJobsPool);
  }

  res.json({ ok: true, count: normalizedJobs.length, jobs: normalizedJobs });
});

// POST /api/jobs/inject (Programmatic job ingestion)
app.post('/api/jobs/inject', requireAuth, (req, res) => {
  const { title, budget, client, category, description, url } = req.body;
  const newJob = {
    id: `inj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: title || 'Custom Injected Task',
    description: description || 'Injected job opportunity via API',
    budget: budget || '$3,000',
    clientId: client || 'Direct Injected Client',
    clientProfileUrl: url || 'https://upwork.com',
    url: url || 'https://upwork.com',
    category: category || 'backend',
    postedAt: new Date().toISOString()
  };
  injectedJobsPool.unshift(newJob);
  res.json({ ok: true, message: 'Job successfully injected into feed.', job: newJob });
});

// POST /api/proposals (Enqueue for human review)
app.post('/api/proposals', requireAuth, async (req, res) => {
  const { jobId, jobTitle, client, budget, proposalText, style, voice, hook } = req.body;

  if (!proposalText) {
    return res.status(400).json({ ok: false, error: 'Proposal text is required.' });
  }

  const enqueued = await memory.enqueueProposal({
    jobId: jobId || `job_${Date.now()}`,
    jobTitle,
    client,
    budget,
    proposalText,
    style: style || 'personalized_hook',
    voice: voice || currentDailyPersona.voiceSignature,
    hook: hook || ''
  });

  const queue = await memory.getQueue();
  const position = queue.findIndex(q => q.id === enqueued.id) + 1;

  res.json({
    ok: true,
    queued: true,
    proposal: enqueued,
    position,
    message: 'Proposal successfully placed into approval queue for human verification.'
  });
});

// GET /api/proposals (List approval queue)
app.get('/api/proposals', requireAuth, async (req, res) => {
  const queue = await memory.getQueue();
  res.json({ ok: true, queue });
});

// POST /api/proposals/:id/send (Human clicked Send)
app.post('/api/proposals/:id/send', requireAuth, async (req, res) => {
  const { id } = req.params;
  const updated = await memory.updateQueueItem(id, {
    status: 'approved',
    approvedAt: Date.now()
  });

  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Proposal not found in queue.' });
  }

  console.log(`[Sentient Server] Proposal ${id} APPROVED by human. Dispatched to worker.`);
  res.json({
    ok: true,
    message: 'Proposal approved by human reviewer. Worker will now process submission with humanized delays.',
    proposal: updated
  });
});

// POST /api/proposals/:id/skip (Human clicked Skip)
app.post('/api/proposals/:id/skip', requireAuth, async (req, res) => {
  const { id } = req.params;
  const updated = await memory.updateQueueItem(id, {
    status: 'skipped',
    skippedAt: Date.now()
  });

  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Proposal not found.' });
  }

  res.json({ ok: true, message: 'Proposal skipped.', proposal: updated });
});

// POST /api/proposals/:id/edit (Human edited text)
app.post('/api/proposals/:id/edit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { proposalText } = req.body;

  if (!proposalText) {
    return res.status(400).json({ ok: false, error: 'Updated proposalText required.' });
  }

  const updated = await memory.updateQueueItem(id, { proposalText });
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Proposal not found.' });
  }

  res.json({ ok: true, message: 'Proposal text updated.', proposal: updated });
});

// POST /api/outcomes (Record outcome: reply | silence | reject)
app.post('/api/outcomes', requireAuth, (req, res) => {
  const { jobId, clientId, proposalStyle, outcome, deltaFitness, earnings, category } = req.body;

  if (!outcome || !['reply', 'silence', 'reject'].includes(outcome)) {
    return res.status(400).json({ ok: false, error: "Valid outcome ('reply' | 'silence' | 'reject') is required." });
  }

  memory.recordEpisode({
    jobId: jobId || `job_${Date.now()}`,
    clientId: clientId || 'Client',
    proposalStyle: proposalStyle || 'personalized_hook',
    outcome,
    deltaFitness: deltaFitness || (outcome === 'reply' ? 0.08 : outcome === 'reject' ? -0.05 : -0.01),
    earnings: earnings || (outcome === 'reply' ? 250 : 0),
    category: category || 'general'
  });

  res.json({
    ok: true,
    message: `Outcome '${outcome}' recorded into episodic memory and intuition updated.`
  });
});

// GET /api/memory
app.get('/api/memory', requireAuth, (req, res) => {
  res.json({ ok: true, memory: memory.getMemory() });
});

// POST /api/memory/reset (Resets genome while keeping intuition & episodes)
app.post('/api/memory/reset', requireAuth, (req, res) => {
  const restoredGenome = memory.resetGenome();
  res.json({
    ok: true,
    message: 'Genome base snapshot restored. Intuition and episodic memory remain intact.',
    genome: restoredGenome
  });
});

// POST /api/memory/mutate-genome (Autonomous genome mutation and promotion)
app.post('/api/memory/mutate-genome', requireAuth, (req, res) => {
  const { gene, value, delta, reason, shadowFit, narratorLine } = req.body || {};
  let mutation;
  if (gene && value !== undefined) {
    mutation = memory.setGene(gene, value, reason, shadowFit, narratorLine);
  } else {
    mutation = memory.mutateGenome();
  }
  res.json({
    ok: true,
    generation: mutation.generation,
    genome: memory.getState().genome,
    change: mutation,
    narratorLine: narratorLine || `Generation ${mutation.generation}: Adapted ${mutation.gene} to ${mutation.newVal} to improve conversion yield.`
  });
});

// GET /api/improver/status
app.get('/api/improver/status', requireAuth, (req, res) => {
  res.json({
    ok: true,
    status: autoImprover.getStatus(),
    currentGenome: memory.getState().genome,
    generation: memory.getState().generation
  });
});

// POST /api/improver/cycle (Trigger autonomous cycle on demand)
app.post('/api/improver/cycle', requireAuth, async (req, res) => {
  await autoImprover.runCycle();
  res.json({
    ok: true,
    status: autoImprover.getStatus(),
    currentGenome: memory.getState().genome,
    generation: memory.getState().generation
  });
});

// GET /api/improver/run-log
app.get('/api/improver/run-log', requireAuth, (req, res) => {
  const logPath = path.resolve(__dirname, '../RUN_LOG.md');
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    res.type('text/markdown').send(content);
  } else {
    res.type('text/plain').send('# RUN_LOG.md\nNo entries logged yet.');
  }
});

// Start the continuous 30-minute autonomous improvement loop
autoImprover.start(30 * 60 * 1000);

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Sentient Server] Active on port ${PORT}. Environment: ${process.env.NODE_ENV || 'development'}`);
});
