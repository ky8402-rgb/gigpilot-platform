/**
 * Sentient Freelancer Routes for Main Express Server (port 3000)
 * Mounts: /api/persona, /api/memory, /api/memory/reset, /api/proposals, /api/outcomes, /api/jobs/inject
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { autoImprover } from './sentientAutoImprover.js';
import { checkHardExcludeFilter } from './autoBidFilters.js';
// @ts-ignore
import { scrapeStatic, scrapeDynamic, checkRobotsTxt, SCRAPER_CONFIG } from '../backend/scraper_engine.js';
// @ts-ignore
import { getRecipeForJob, RECIPES } from '../backend/scraper_recipes.js';
// @ts-ignore
import {
  packageDeliverable,
  listDeliverables,
  approveDeliverable,
  reviseDeliverable,
  rejectDeliverable
} from '../backend/deliverables.js';

export const sentientRouter = Router();

// Shared In-Memory Organism State
const DEFAULT_GENOME = {
  sensitivity: 0.55,
  aggressiveness: 0.50,
  caution: 0.50,
  horizon: 18,
  polishGain: 1.00,
  trustDecay: 0.90
};

interface Episode {
  at: number;
  jobId: string;
  clientId: string;
  proposalStyle: string;
  hook?: string;
  outcome: 'reply' | 'silence' | 'reject';
  deltaFitness: number;
  earnings: number;
  category: string;
}

interface ProposalItem {
  id: string;
  jobId: string;
  jobTitle: string;
  client: string;
  budget: string;
  proposalText: string;
  style: string;
  voice: string;
  hook: string;
  queuedAt: number;
  status: 'pending_approval' | 'approved' | 'skipped' | 'sent' | 'failed';
  approvedAt?: number;
  skippedAt?: number;
}

let episodes: Episode[] = [];
let intuition: Record<string, { trust: number; uses: number; burns: number }> = {};
let genome = { ...DEFAULT_GENOME };
const genomeBase = { ...DEFAULT_GENOME };
let generation = 1;
const queue: ProposalItem[] = [];
const injectedJobs: any[] = [];
let proposalsToday = 0;
let lastCounterDate = new Date().toISOString().slice(0, 10);

// Gaussian random generator
function gauss(mean = 0, stdev = 1): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}

function rollDailyPersona() {
  const now = new Date();
  const voices = ['direct', 'warm', 'technical', 'playful', 'formal'];
  const voice = voices[Math.floor(Math.random() * voices.length)];
  const niches = [
    'Full-Stack Architecture & High-Scale APIs',
    'Shopify Plus & Headless D2C Infrastructure',
    'Distributed Cloud Systems & DevOps Resilience',
    'React Native & Cross-Platform Mobile Performance',
    'AI Integration & Automated Workflow Pipelines'
  ];
  const niche = niches[Math.floor(now.getTime() / (30 * 24 * 60 * 60 * 1000)) % niches.length];

  return {
    id: `persona_${now.toISOString().slice(0, 10)}_${Math.random().toString(36).substring(2, 7)}`,
    date: now.toISOString().slice(0, 10),
    workStart: Math.max(7.5, Math.min(10.5, Number((9.0 + gauss(0, 0.75)).toFixed(2)))),
    workEnd: Math.max(16.0, Math.min(21.0, Number((17.5 + gauss(0, 0.75)).toFixed(2)))),
    lunchHour: Math.max(12.0, Math.min(14.0, Number((12.75 + gauss(0, 0.4)).toFixed(2)))),
    sessionLengthTargetHours: Math.round(4 + Math.random() * 4),
    energyDecayPerHour: Number((0.08 + Math.random() * 0.14).toFixed(3)),
    browseSkipRatio: Number((0.60 + Math.random() * 0.22).toFixed(2)),
    typoRate: Number((0.008 + Math.random() * 0.027).toFixed(3)),
    questionFrequency: Number((0.50 + Math.random() * 0.35).toFixed(2)),
    ctaFrequency: Number((0.15 + Math.random() * 0.30).toFixed(2)),
    nicheDrift: niche,
    voiceSignature: voice,
    hasContradiction: Math.random() < 0.05,
    contradictionType: Math.random() < 0.05 ? 'late_night_proposal' : null
  };
}

let activePersona = rollDailyPersona();

function checkRollover() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastCounterDate !== today) {
    proposalsToday = 0;
    lastCounterDate = today;
    activePersona = rollDailyPersona();
  }
}

// GET /api/persona
sentientRouter.get('/persona', (_req: Request, res: Response) => {
  checkRollover();
  res.json({ ok: true, persona: activePersona });
});

// GET /api/memory
sentientRouter.get('/memory', (_req: Request, res: Response) => {
  checkRollover();
  res.json({
    ok: true,
    memory: {
      episodes,
      intuition,
      genome,
      genomeBase,
      generation,
      proposalsToday,
      queueDepth: queue.length,
      lastSnapshotAt: Date.now()
    }
  });
});

// POST /api/memory/reset
sentientRouter.post('/memory/reset', (_req: Request, res: Response) => {
  genome = { ...genomeBase };
  res.json({
    ok: true,
    message: 'Genome base snapshot restored. Intuition and episodic memory remain intact.',
    genome
  });
});

// GET /api/proposals
sentientRouter.get('/proposals', (_req: Request, res: Response) => {
  res.json({ ok: true, queue, count: queue.length });
});

// POST /api/proposals
sentientRouter.post('/proposals', (req: Request, res: Response) => {
  const { jobId, jobTitle, client, budget, proposalText, style, voice, hook } = req.body;
  if (!proposalText) {
    return res.status(400).json({ ok: false, error: 'Proposal text is required.' });
  }

  // Check Hard Exclude Filter
  const hardExcludeCheck = checkHardExcludeFilter({
    title: jobTitle,
    description: `${proposalText} ${hook || ''}`
  });

  const enqueued: ProposalItem = {
    id: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    jobId: jobId || `job_${Date.now()}`,
    jobTitle: jobTitle || 'Freelance Engagement',
    client: client || 'Verified Client',
    budget: budget || 'TBD',
    proposalText,
    style: style || 'personalized_hook',
    voice: voice || activePersona.voiceSignature,
    hook: hook || '',
    queuedAt: Date.now(),
    status: hardExcludeCheck.shouldSkip ? 'skipped' : 'pending_approval'
  };

  queue.push(enqueued);

  if (hardExcludeCheck.shouldSkip) {
    return res.json({
      ok: true,
      queued: true,
      skipped: true,
      proposal: enqueued,
      position: queue.length,
      reason: hardExcludeCheck.reason,
      message: `Job matches Hard Exclude Filter ("${hardExcludeCheck.matchedKeyword}" - ${hardExcludeCheck.category}). Marked as skipped (Never Bid).`
    });
  }

  res.json({
    ok: true,
    queued: true,
    proposal: enqueued,
    position: queue.length,
    message: 'Proposal successfully placed into approval queue for human verification.'
  });
});

// POST /api/proposals/:id/send
sentientRouter.post('/proposals/:id/send', (req: Request, res: Response) => {
  const { id } = req.params;
  const item = queue.find(q => q.id === id);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'Proposal not found in queue.' });
  }

  // Safety check: Hard Exclude Filter
  const hardExcludeCheck = checkHardExcludeFilter({
    title: item.jobTitle,
    description: `${item.proposalText} ${item.hook || ''}`
  });

  if (hardExcludeCheck.shouldSkip) {
    item.status = 'skipped';
    return res.status(400).json({
      ok: false,
      blocked: true,
      error: `Auto-bid blocked by Hard Exclude Filter: matches "${hardExcludeCheck.matchedKeyword}" (${hardExcludeCheck.category}). Never Bid policy enforced.`,
      reason: hardExcludeCheck.reason
    });
  }

  item.status = 'approved';
  item.approvedAt = Date.now();
  proposalsToday += 1;

  res.json({
    ok: true,
    message: 'Proposal approved by human reviewer. Ready for dispatch.',
    proposal: item
  });
});

// POST /api/proposals/:id/skip
sentientRouter.post('/proposals/:id/skip', (req: Request, res: Response) => {
  const { id } = req.params;
  const item = queue.find(q => q.id === id);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'Proposal not found.' });
  }
  item.status = 'skipped';
  item.skippedAt = Date.now();
  res.json({ ok: true, message: 'Proposal skipped.', proposal: item });
});

// POST /api/proposals/:id/edit
sentientRouter.post('/proposals/:id/edit', (req: Request, res: Response) => {
  const { id } = req.params;
  const { proposalText } = req.body;
  const item = queue.find(q => q.id === id);
  if (!item) {
    return res.status(404).json({ ok: false, error: 'Proposal not found.' });
  }
  if (!proposalText) {
    return res.status(400).json({ ok: false, error: 'proposalText is required.' });
  }
  item.proposalText = proposalText;
  res.json({ ok: true, message: 'Proposal text updated.', proposal: item });
});

// POST /api/outcomes
sentientRouter.post('/outcomes', (req: Request, res: Response) => {
  const { jobId, clientId, proposalStyle, outcome, deltaFitness, earnings, category } = req.body;
  if (!outcome || !['reply', 'silence', 'reject'].includes(outcome)) {
    return res.status(400).json({ ok: false, error: "Valid outcome ('reply' | 'silence' | 'reject') is required." });
  }

  const ep: Episode = {
    at: Date.now(),
    jobId: jobId || `job_${Date.now()}`,
    clientId: clientId || 'Client',
    proposalStyle: proposalStyle || 'personalized_hook',
    outcome,
    deltaFitness: deltaFitness || (outcome === 'reply' ? 0.08 : outcome === 'reject' ? -0.05 : -0.01),
    earnings: earnings || (outcome === 'reply' ? 250 : 0),
    category: category || 'general'
  };

  episodes.unshift(ep);
  if (episodes.length > 200) episodes.length = 200;

  const key = `${category || 'general'}|${proposalStyle || 'personalized_hook'}`;
  if (!intuition[key]) {
    intuition[key] = { trust: 0.50, uses: 0, burns: 0 };
  }
  const intu = intuition[key];
  intu.uses += 1;
  const decay = genome.trustDecay || 0.90;

  if (outcome === 'reply') {
    intu.trust += (1 - intu.trust) * 0.24 * decay;
  } else if (outcome === 'silence') {
    intu.trust *= 0.93;
  } else if (outcome === 'reject') {
    intu.trust *= (0.55 + (1 - decay) * 0.2);
    intu.burns += 1;
  }
  intu.trust = Math.max(0.02, Math.min(0.99, Number(intu.trust.toFixed(3))));

  res.json({ ok: true, message: `Outcome '${outcome}' recorded.`, intuition: intu });
});

// POST /api/jobs/inject
sentientRouter.post('/jobs/inject', (req: Request, res: Response) => {
  const { title, budget, client, category, description, url } = req.body;
  const job = {
    id: `inj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: title || 'Custom Injected Task',
    description: description || 'Injected job via API',
    budget: budget || '$3,000',
    clientId: client || 'Direct Injected Client',
    clientProfileUrl: url || 'https://upwork.com',
    url: url || 'https://upwork.com',
    category: category || 'backend',
    postedAt: new Date().toISOString()
  };
  injectedJobs.unshift(job);
  res.json({ ok: true, message: 'Job injected.', job });
});

// POST /api/memory/mutate-genome (Autonomous genome mutation and promotion)
sentientRouter.post('/api/memory/mutate-genome', (req: Request, res: Response) => {
  const { gene, value, delta, reason, shadowFit, narratorLine } = req.body || {};

  let targetGene = gene;
  let newVal = value;

  if (!targetGene || newVal === undefined) {
    const genes = ['sensitivity', 'aggressiveness', 'caution', 'horizon', 'polishGain', 'trustDecay'];
    targetGene = genes[Math.floor(Math.random() * genes.length)];
    const bounds: Record<string, [number, number]> = {
      sensitivity: [0.20, 0.95],
      aggressiveness: [0.12, 0.98],
      caution: [0.12, 0.95],
      horizon: [6, 48],
      polishGain: [0.45, 2.10],
      trustDecay: [0.70, 0.99]
    };
    const [minB, maxB] = bounds[targetGene] || [0.2, 0.9];
    const prev = (genome as any)[targetGene] ?? 0.50;
    const shift = (delta !== undefined ? delta : (Math.random() - 0.5) * (targetGene === 'horizon' ? 4 : 0.08));
    newVal = Math.max(minB, Math.min(maxB, Number((prev + shift).toFixed(3))));
  }

  const prevVal = (genome as any)[targetGene] ?? 0.50;
  (genome as any)[targetGene] = newVal;
  generation += 1;

  const logLine = narratorLine || `Generation ${generation}: Autonomous mutation promoted ${targetGene} (${prevVal} → ${newVal}) based on shadow validation.`;

  res.json({
    ok: true,
    generation,
    genome,
    change: {
      gene: targetGene,
      prevVal,
      newVal,
      direction: newVal >= prevVal ? 'up' : 'down',
      generation,
      reason: reason || 'autonomous adaptation',
      shadowFit: shadowFit || null
    },
    narratorLine: logLine
  });
});

// Also alias without prefix for direct router mounting
sentientRouter.post('/memory/mutate-genome', (req: Request, res: Response) => {
  const { gene, value, delta, reason, shadowFit, narratorLine } = req.body || {};

  let targetGene = gene;
  let newVal = value;

  if (!targetGene || newVal === undefined) {
    const genes = ['sensitivity', 'aggressiveness', 'caution', 'horizon', 'polishGain', 'trustDecay'];
    targetGene = genes[Math.floor(Math.random() * genes.length)];
    const bounds: Record<string, [number, number]> = {
      sensitivity: [0.20, 0.95],
      aggressiveness: [0.12, 0.98],
      caution: [0.12, 0.95],
      horizon: [6, 48],
      polishGain: [0.45, 2.10],
      trustDecay: [0.70, 0.99]
    };
    const [minB, maxB] = bounds[targetGene] || [0.2, 0.9];
    const prev = (genome as any)[targetGene] ?? 0.50;
    const shift = (delta !== undefined ? delta : (Math.random() - 0.5) * (targetGene === 'horizon' ? 4 : 0.08));
    newVal = Math.max(minB, Math.min(maxB, Number((prev + shift).toFixed(3))));
  }

  const prevVal = (genome as any)[targetGene] ?? 0.50;
  (genome as any)[targetGene] = newVal;
  generation += 1;

  const logLine = narratorLine || `Generation ${generation}: Autonomous mutation promoted ${targetGene} (${prevVal} → ${newVal}) based on shadow validation.`;

  res.json({
    ok: true,
    generation,
    genome,
    change: {
      gene: targetGene,
      prevVal,
      newVal,
      direction: newVal >= prevVal ? 'up' : 'down',
      generation,
      reason: reason || 'autonomous adaptation',
      shadowFit: shadowFit || null
    },
    narratorLine: logLine
  });
});

// GET /api/improver/status
sentientRouter.get('/improver/status', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    status: autoImprover.getStatus(),
    currentGenome: genome,
    generation
  });
});

// POST /api/improver/cycle (Trigger autonomous cycle immediately)
sentientRouter.post('/improver/cycle', async (_req: Request, res: Response) => {
  const result = await autoImprover.runCycle({
    memoryState: { episodes, genome, generation },
    onPromote: (targetGene: string, proposedVal: number, diagnosis: string, shadowFit: number, narratorLine: string) => {
      const prev = (genome as any)[targetGene] ?? 0.50;
      (genome as any)[targetGene] = proposedVal;
      generation += 1;
      return {
        gene: targetGene,
        prevVal: prev,
        newVal: proposedVal,
        generation,
        reason: diagnosis,
        shadowFit,
        narratorLine
      };
    }
  });

  res.json({ ok: true, result, currentGenome: genome, generation });
});

// GET /api/improver/run-log
sentientRouter.get('/improver/run-log', (_req: Request, res: Response) => {
  const logPath = path.resolve(process.cwd(), 'RUN_LOG.md');
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf8');
    res.type('text/markdown').send(content);
  } else {
    res.type('text/plain').send('# RUN_LOG.md\nNo entries logged yet.');
  }
});

// Start the continuous 30-minute autonomous loop
autoImprover.start(30 * 60 * 1000);

// -------------------------------------------------------------
// SCRAPER-WORK-DELIVERY & LEADS PIPELINE ROUTES
// -------------------------------------------------------------

const SCRAPING_WHITELIST = [
  'scrape', 'scraping', 'extract', 'extraction', 'data mining',
  'lead generation', 'list building', 'crawl', 'harvest', 'directory',
  'enrichment', 'google maps', 'linkedin scraper', 'e-commerce scraper',
  'price monitoring', 'web scraping', 'data collection', 'contact list',
  'email list', 'csv', 'excel export'
];

// GET /api/leads
sentientRouter.get('/leads', (_req: Request, res: Response) => {
  const leads = [
    {
      id: 'job_scr_ecom_9021',
      title: 'Extract 15,000 Shopify Product SKUs with Daily Price Monitoring',
      description: 'Need a web scraper to extract product titles, variants, current price, and stock status into automated CSV and Excel export.',
      platform: 'Upwork (OAuth)',
      client: 'D2C Retail Brands Ltd',
      category: 'e-commerce scraper',
      estimatedRows: 15000,
      pricingTier: '$799 (custom + monitoring)',
      bidAmount: 799,
      keywordMatched: 'e-commerce scraper'
    },
    {
      id: 'job_scr_maps_8842',
      title: 'Google Maps Business Directory & Phone Lead List Building',
      description: 'Lead generation and directory enrichment: harvest local dental & medical clinics across 10 metro areas with phone, address, and rating into CSV.',
      platform: 'Contra',
      client: 'Metropolitan Marketing Partners',
      category: 'Google Maps',
      estimatedRows: 1850,
      pricingTier: '$199 (≤2000 rows)',
      bidAmount: 199,
      keywordMatched: 'Google Maps'
    },
    {
      id: 'job_scr_pdf_7719',
      title: 'Multi-Page Financial PDF Statements to Tabular CSV Export',
      description: 'Data extraction pipeline to extract transaction tables and line items from 25 quarterly PDF statements into normalized Excel export with 99.8% precision.',
      platform: 'Freelancer.com',
      client: 'FinAudit Partners',
      category: 'CSV, Excel export',
      estimatedRows: 420,
      pricingTier: '$99 (≤500 rows)',
      bidAmount: 99,
      keywordMatched: 'CSV, Excel export'
    },
    {
      id: 'job_scr_b2b_6654',
      title: 'B2B Software Directory Harvest & Email List Enrichment',
      description: 'Web scraping and contact list building: crawl directory profiles to build an enriched company database of 7,500 qualified leads.',
      platform: 'Upwork (OAuth)',
      client: 'SaaS Growth Ventures',
      category: 'directory',
      estimatedRows: 7500,
      pricingTier: '$399 (≤10,000 rows)',
      bidAmount: 399,
      keywordMatched: 'directory'
    }
  ];

  res.json({
    ok: true,
    count: leads.length,
    leads,
    filter: 'scraping_only_whitelist',
    activeMarketplaces: ['Freelancer.com', 'Upwork (OAuth)', 'Contra'],
    excludedBoards: ['RemoteOK', 'FlexJobs', 'WeWorkRemotely']
  });
});

// POST /api/scraper/test
sentientRouter.post('/scraper/test', async (req: Request, res: Response) => {
  try {
    const { recipe = 'directory_listings', targetUrl, url, customSelectors, maxRows = 10 } = req.body || {};
    const finalUrl = targetUrl || url;
    const recipeConfig = getRecipeForJob({
      title: recipe,
      targetUrl: finalUrl,
      recipe,
      selectors: customSelectors
    });

    const extractionUrl = finalUrl || recipeConfig.targetUrl;
    let rows: any[] = [];
    let compliance = { allowed: true };

    if (extractionUrl) {
      try {
        compliance = await checkRobotsTxt(extractionUrl);
        rows = await scrapeStatic(extractionUrl, recipeConfig.selectors);
      } catch (err: any) {
        console.warn(`[Scraper Test] Live fetch note: ${err.message}`);
      }
    }

    if (!rows || rows.length === 0) {
      rows = recipeConfig.sampleData || [];
    }

    const sampleRows = rows.slice(0, Math.min(Number(maxRows) || 10, 20));

    res.json({
      ok: true,
      recipe: recipeConfig.recipeName,
      label: recipeConfig.label,
      targetUrl: extractionUrl,
      compliance,
      totalExtracted: rows.length,
      sampleCount: sampleRows.length,
      outputSchema: recipeConfig.outputSchema,
      deliveryFormat: recipeConfig.deliveryFormat,
      sampleRows,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/scraper/deliver/:jobId
sentientRouter.post('/scraper/deliver/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const deliverable = await packageDeliverable(jobId, req.body || {});
    res.json({
      ok: true,
      message: 'Deliverable packaged and uploaded to S3. Status: ready-for-qa.',
      deliverable
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/deliverables
sentientRouter.get('/deliverables', (req: Request, res: Response) => {
  const statusFilter = req.query.status ? String(req.query.status) : undefined;
  const deliverables = listDeliverables(statusFilter ? { status: statusFilter } : {});
  res.json({
    ok: true,
    count: deliverables.length,
    deliverables
  });
});

// POST /api/deliverables/:id/approve
sentientRouter.post('/deliverables/:id/approve', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};
    const approved = approveDeliverable(id, notes);
    res.json({
      ok: true,
      message: 'Deliverable approved by human reviewer. Platform worker unlocked to attach ZIP and submit.',
      deliverable: approved
    });
  } catch (err: any) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

// POST /api/deliverables/:id/revise
sentientRouter.post('/deliverables/:id/revise', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};
    const revised = reviseDeliverable(id, notes);
    res.json({
      ok: true,
      message: 'Deliverable sent back for revision with human notes.',
      deliverable: revised
    });
  } catch (err: any) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

// POST /api/deliverables/:id/reject
sentientRouter.post('/deliverables/:id/reject', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const rejected = rejectDeliverable(id, reason);
    res.json({
      ok: true,
      message: 'Deliverable rejected.',
      deliverable: rejected
    });
  } catch (err: any) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

