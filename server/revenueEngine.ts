import crypto from 'crypto';
import axios from 'axios';
import { safeExecutePgQuery } from './pgDatabase.js';
import { getGeminiAI } from './gemini.js';
<<<<<<< HEAD
import { createPayPalPayout } from './paypal.js';
=======
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
import { logActivityEvent } from './activityLogger.js';
import { clearBidsCache } from './redisCache.js';

export type ProposalTone = 'formal_technical' | 'impact_driven';
export type BidOutcomeStatus = 'Won' | 'Lost' | 'Pending';

export interface BidOutcome {
  id: string;
  bid_id: string;
  project_title: string;
  bid_amount: number;
  proposal_text: string;
  proposal_tone: ProposalTone;
  outcome: BidOutcomeStatus;
  client_hire_rate: number;
  total_bids_on_project: number;
  final_payout_amount: number;
  category: string;
  conversion_trigger: boolean;
  created_at: string;
  updated_at: string;
}

export interface AutomatedPayoutRecord {
  id: string;
  work_order_id: string;
  bid_id?: string;
  project_title: string;
  client_name: string;
  amount: number;
  currency: string;
  risk_band: 'instant_transfer' | 'standard_automated' | 'high_value_review';
  status: 'completed' | 'pending_approval' | 'failed';
  payout_batch_id: string | null;
  invoice_number?: string;
  executed_at: string;
  details?: any;
}

export interface LeadFollowupRecord {
  id: string;
  bid_id: string;
  project_title: string;
  client_name: string;
  message_text: string;
  dispatched_at: string;
  status: 'sent' | 'replied' | 'converted';
  conversion_trigger: boolean;
}

export interface CategoryProfitability {
  category: string;
  totalBids: number;
  wonBids: number;
  winRate: number;
  totalRevenue: number;
  estimatedHours: number;
  netProfitPerHour: number;
  status: 'active' | 'paused_low_yield';
  pausedReason?: string;
}

// In-Memory resilient state for instant retrieval and offline fallback
class RevenueStateStore {
  bidsOutcomes: Map<string, BidOutcome> = new Map();
  automatedPayouts: AutomatedPayoutRecord[] = [];
  leadFollowups: LeadFollowupRecord[] = [];
  similarityThreshold: number = 0.75;
  lastAnalysisAt: string | null = null;
  
  // Guardrails State
  stopLossPaused: boolean = false;
  stopLossPauseReason: string = '';
  maxBidMultiplier: number = 1.0; // 1.0 = 100%, 0.8 = 20% reduction
  connectCreditsSpent7Days: number = 65; // Tracked connects cost in USD
  revenue7Days: number = 1480; // Tracked revenue in USD

  // Category tracking
  categories: Map<string, CategoryProfitability> = new Map([
    ['AI & Automation', { category: 'AI & Automation', totalBids: 48, wonBids: 19, winRate: 39.5, totalRevenue: 9800, estimatedHours: 95, netProfitPerHour: 103.15, status: 'active' }],
    ['React & Full-Stack', { category: 'React & Full-Stack', totalBids: 62, wonBids: 21, winRate: 33.8, totalRevenue: 10400, estimatedHours: 120, netProfitPerHour: 86.60, status: 'active' }],
    ['FinTech & Payments', { category: 'FinTech & Payments', totalBids: 35, wonBids: 14, winRate: 40.0, totalRevenue: 6900, estimatedHours: 65, netProfitPerHour: 106.15, status: 'active' }],
    ['Python & Scraping', { category: 'Python & Scraping', totalBids: 28, wonBids: 8, winRate: 28.5, totalRevenue: 3400, estimatedHours: 50, netProfitPerHour: 68.00, status: 'active' }],
    ['Design & Branding', { category: 'Design & Branding', totalBids: 18, wonBids: 1, winRate: 5.5, totalRevenue: 280, estimatedHours: 32, netProfitPerHour: 8.75, status: 'paused_low_yield', pausedReason: 'Effective net profit ($8.75/hr) below $10.00/hr floor' }],
  ]);

  constructor() {
    this.seedInitialOutcomes();
  }

  private seedInitialOutcomes() {
    const seed: BidOutcome[] = [
      {
        id: 'outc_1',
        bid_id: 'fl_proj_98124',
        project_title: 'Full-Stack SaaS Platform with React, Node.js & Stripe',
        bid_amount: 540,
        proposal_text: 'Formal architecture: I will deliver production architecture with verified milestones, isolated test suites, and sub-second webhook responses.',
        proposal_tone: 'formal_technical',
        outcome: 'Won',
        client_hire_rate: 92,
        total_bids_on_project: 6,
        final_payout_amount: 540,
        category: 'React & Full-Stack',
        conversion_trigger: true,
        created_at: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
        updated_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
      },
      {
        id: 'outc_2',
        bid_id: 'fl_proj_98135',
        project_title: 'Gemini 2.5 AI Workflow Agent & Webhook Automation',
        bid_amount: 380,
        proposal_text: 'High-impact delivery: Rapid 48-hour turn-around. Immediate webhook pipeline with zero-latency streaming and fallback resilience.',
        proposal_tone: 'impact_driven',
        outcome: 'Won',
        client_hire_rate: 88,
        total_bids_on_project: 4,
        final_payout_amount: 380,
        category: 'AI & Automation',
        conversion_trigger: true,
        created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
        updated_at: new Date(Date.now() - 3600000 * 20).toISOString(),
      },
      {
        id: 'outc_3',
        bid_id: 'fl_proj_98146',
        project_title: 'PayPal REST API & Razorpay Payment Integration',
        bid_amount: 290,
        proposal_text: 'I specialize in PayPal REST v2 and Razorpay webhooks. Complete sandbox-to-production certification with IPN security validation.',
        proposal_tone: 'formal_technical',
        outcome: 'Won',
        client_hire_rate: 85,
        total_bids_on_project: 8,
        final_payout_amount: 290,
        category: 'FinTech & Payments',
        conversion_trigger: false,
        created_at: new Date(Date.now() - 3600000 * 36).toISOString(),
        updated_at: new Date(Date.now() - 3600000 * 18).toISOString(),
      },
      {
        id: 'outc_4',
        bid_id: 'fl_proj_98157',
        project_title: 'Fix Next.js Production Build Memory Leak & Performance Audit',
        bid_amount: 140,
        proposal_text: 'Immediate fix: Heap dump profile, circular dependency audit, and bundle tree reduction delivered within 24 hours.',
        proposal_tone: 'impact_driven',
        outcome: 'Won',
        client_hire_rate: 95,
        total_bids_on_project: 3,
        final_payout_amount: 140,
        category: 'React & Full-Stack',
        conversion_trigger: true,
        created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
        updated_at: new Date(Date.now() - 3600000 * 30).toISOString(),
      },
      {
        id: 'outc_5',
        bid_id: 'fl_proj_98168',
        project_title: 'Crypto Telegram Pump Bot & Unverified Gateway',
        bid_amount: 450,
        proposal_text: 'Standard delivery proposal',
        proposal_tone: 'formal_technical',
        outcome: 'Lost',
        client_hire_rate: 15,
        total_bids_on_project: 32,
        final_payout_amount: 0,
        category: 'Python & Scraping',
        conversion_trigger: false,
        created_at: new Date(Date.now() - 3600000 * 60).toISOString(),
        updated_at: new Date(Date.now() - 3600000 * 48).toISOString(),
      },
    ];

    for (const item of seed) {
      this.bidsOutcomes.set(item.bid_id, item);
    }

    this.automatedPayouts = [];
  }
}

export const revenueStore = new RevenueStateStore();

// =========================================================================
// 1. DYNAMIC BID PRICING LOGIC (Requirement 2 & 10)
// =========================================================================

/**
 * Calculates optimal bid using dynamic percentile strategy (e.g., 60% of client max budget)
 * with a profitability floor and anti-bankruptcy multiplier.
 */
export function calculateOptimalBid(job: {
  budget?: any;
  title?: string;
  description?: string;
  category?: string;
}): {
  optimalBid: number;
  strategy: string;
  percentile: number;
  profitabilityFloor: number;
  originalEstimate: number;
  guardrailMultiplier: number;
} {
  const percentile = 0.60; // 60% dynamic strategy
  const profitabilityFloor = 120; // $120 floor to guarantee profit margin

  let maxBudget = 0;
  let minBudget = 0;

  if (job.budget) {
    if (typeof job.budget === 'number') {
      maxBudget = job.budget;
      minBudget = Math.round(job.budget * 0.6);
    } else if (typeof job.budget === 'object') {
      maxBudget = Number(job.budget.maximum || job.budget.max || job.budget.budget || 0);
      minBudget = Number(job.budget.minimum || job.budget.min || 0);
    } else if (typeof job.budget === 'string') {
      const numbers = job.budget.match(/\d[\d,]*/g);
      if (numbers && numbers.length >= 2) {
        minBudget = Number(numbers[0].replace(/,/g, ''));
        maxBudget = Number(numbers[1].replace(/,/g, ''));
      } else if (numbers && numbers.length === 1) {
        maxBudget = Number(numbers[0].replace(/,/g, ''));
        minBudget = Math.round(maxBudget * 0.5);
      }
    }
  }

  // Fallback estimation by domain category if client omitted budget
  if (!maxBudget || isNaN(maxBudget) || maxBudget <= 0) {
    const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
    if (text.includes('ai') || text.includes('llm') || text.includes('agent')) {
      maxBudget = 650;
      minBudget = 300;
    } else if (text.includes('full stack') || text.includes('saas') || text.includes('next.js')) {
      maxBudget = 550;
      minBudget = 250;
    } else if (text.includes('paypal') || text.includes('stripe') || text.includes('payment')) {
      maxBudget = 450;
      minBudget = 200;
    } else {
      maxBudget = 350;
      minBudget = 150;
    }
  }

  // Dynamic percentile calculation: 60% of client max budget, bounded by min budget
  let rawBid = Math.round(maxBudget * percentile);
  if (minBudget > 0 && rawBid < minBudget) {
    rawBid = minBudget;
  }

  // Enforce profitability floor
  const flooredBid = Math.max(profitabilityFloor, rawBid);

  // Apply anti-bankruptcy guardrail multiplier (lowered by 20% if revenue/bids < 1.0)
  const multiplier = revenueStore.maxBidMultiplier;
  const optimalBid = Math.max(profitabilityFloor, Math.round(flooredBid * multiplier));

  return {
    optimalBid,
    strategy: `60% percentile of $${maxBudget} client budget with $${profitabilityFloor} floor`,
    percentile: 60,
    profitabilityFloor,
    originalEstimate: maxBudget,
    guardrailMultiplier: multiplier,
  };
}

// =========================================================================
// 2. A/B TESTING PROPOSAL GENERATOR (Requirement 3)
// =========================================================================

export async function generateToneProposal(job: {
  title: string;
  description?: string;
  company?: string;
  platform?: string;
}): Promise<{
  coverLetter: string;
  tone: ProposalTone;
  variantName: string;
}> {
  // Randomly assign Variant A (formal_technical) or Variant B (impact_driven)
  const tone: ProposalTone = Math.random() < 0.5 ? 'formal_technical' : 'impact_driven';
  const variantName = tone === 'formal_technical' ? 'Formal & Technical' : 'Short & Impact-Driven';

  const ai = getGeminiAI();

  if (ai) {
    try {
      let prompt = '';
      if (tone === 'formal_technical') {
        prompt = `You are a Principal Solutions Architect. Write a formal, technical, and precise freelance bid proposal for this project:
Job Title: ${job.title}
Job Description: ${job.description || job.title}
Client: ${job.company || 'Hiring Manager'}

Format:
1. Executive Summary & Architectural Scope: Reference modern patterns (e.g., TypeScript, microservices, deterministic state).
2. Implementation Milestones: Explicit verification steps, unit test coverage, and delivery SLAs.
3. Formal Sign-off with Next Steps.
Keep tone rigorous, authoritative, and technical.`;
      } else {
        prompt = `You are a High-Speed MVP & Automation Specialist. Write a short, punchy, high-impact bid proposal for this project:
Job Title: ${job.title}
Job Description: ${job.description || job.title}
Client: ${job.company || 'Founder / Team'}

Format:
1. One-sentence hook proving direct hands-on delivery of this exact challenge.
2. 3 bullet deliverables with immediate 48-72 hour timeline.
3. Direct call-to-action to review sample repo or jump on a 5-minute sync.
Keep tone energetic, concise, and focused purely on rapid ROI.`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      if (response.text && response.text.length > 50) {
        return {
          coverLetter: response.text.trim(),
          tone,
          variantName,
        };
      }
    } catch {
      // Fall through to deterministic template
    }
  }

  // Deterministic fallback templates
  if (tone === 'formal_technical') {
    return {
      coverLetter: `Dear ${job.company || 'Hiring Team'},\n\nI reviewed your architectural requirements for "${job.title}". As a senior systems engineer, I specialize in full-stack web applications, zero-downtime deployment pipelines, and high-throughput REST/GraphQL APIs.\n\nScope of Work & Milestone Delivery:\n• Milestone 1: Architectural specification, schema definition, and isolated component hierarchy.\n• Milestone 2: Core feature implementation, automated test suites, and third-party API integration.\n• Milestone 3: End-to-end verification, performance profiling, and production deployment handoff.\n\nI look forward to discussing the technical milestones with your engineering team.\n\nSincerely,\nKundan Kumar | Senior Solutions Engineer`,
      tone,
      variantName,
    };
  } else {
    return {
      coverLetter: `Hi ${job.company || 'there'}! I saw your post for "${job.title}" and can build this cleanly within 48 to 72 hours.\n\nKey Deliverables:\n⚡ Production-ready delivery with clean, documented TypeScript code\n⚡ 100% test coverage and instant deployment to cloud container / serverless\n⚡ Zero overhead: fully self-contained execution with daily milestone updates\n\nLet me know if you would like me to start the prototype immediately!\n\nBest,\nKundan K.`,
      tone,
      variantName,
    };
  }
}

// =========================================================================
// 3. WIN/LOSS FEEDBACK LOOP & OUTCOME TRACKING (Requirement 1)
// =========================================================================

export async function recordBidOutcome(outcome: Omit<BidOutcome, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<BidOutcome> {
  const fullOutcome: BidOutcome = {
    id: outcome.id || `outc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    bid_id: outcome.bid_id,
    project_title: outcome.project_title,
    bid_amount: Number(outcome.bid_amount) || 0,
    proposal_text: outcome.proposal_text || '',
    proposal_tone: outcome.proposal_tone || 'formal_technical',
    outcome: outcome.outcome || 'Pending',
    client_hire_rate: Number(outcome.client_hire_rate) || 0,
    total_bids_on_project: Number(outcome.total_bids_on_project) || 1,
    final_payout_amount: Number(outcome.final_payout_amount) || 0,
    category: outcome.category || 'General Engineering',
    conversion_trigger: Boolean(outcome.conversion_trigger),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 1. Update in-memory store
  revenueStore.bidsOutcomes.set(fullOutcome.bid_id, fullOutcome);

  // 2. Persist to PostgreSQL if online
  await safeExecutePgQuery(
    `INSERT INTO bids_outcome (
        id, bid_id, project_title, bid_amount, proposal_text, proposal_tone,
        outcome, client_hire_rate, total_bids_on_project, final_payout_amount,
        category, conversion_trigger, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO UPDATE
     SET outcome = EXCLUDED.outcome,
         final_payout_amount = EXCLUDED.final_payout_amount,
         conversion_trigger = EXCLUDED.conversion_trigger,
         updated_at = NOW()`,
    [
      fullOutcome.id,
      fullOutcome.bid_id,
      fullOutcome.project_title,
      fullOutcome.bid_amount,
      fullOutcome.proposal_text,
      fullOutcome.proposal_tone,
      fullOutcome.outcome,
      fullOutcome.client_hire_rate,
      fullOutcome.total_bids_on_project,
      fullOutcome.final_payout_amount,
      fullOutcome.category,
      fullOutcome.conversion_trigger,
      fullOutcome.created_at,
      fullOutcome.updated_at,
    ]
  );

  return fullOutcome;
}

export async function updateBidOutcomeStatus(
  bidId: string,
  newOutcome: BidOutcomeStatus,
  finalPayout?: number
): Promise<BidOutcome | null> {
  let existing = revenueStore.bidsOutcomes.get(bidId);

  if (!existing) {
    const dbRes = await safeExecutePgQuery('SELECT * FROM bids_outcome WHERE bid_id = $1 LIMIT 1', [bidId]);
    if (dbRes && dbRes.rows.length > 0) {
      existing = dbRes.rows[0];
      if (existing) revenueStore.bidsOutcomes.set(bidId, existing);
    }
  }

  if (!existing) {
    return null;
  }

  existing.outcome = newOutcome;
  existing.updated_at = new Date().toISOString();
  if (finalPayout !== undefined && finalPayout > 0) {
    existing.final_payout_amount = finalPayout;
  }
  if (newOutcome === 'Won' && !existing.final_payout_amount) {
    existing.final_payout_amount = existing.bid_amount;
  }

  revenueStore.bidsOutcomes.set(bidId, existing);

  // Update in DB
  await safeExecutePgQuery(
    `UPDATE bids_outcome
     SET outcome = $1, final_payout_amount = COALESCE($2, final_payout_amount), updated_at = NOW()
     WHERE bid_id = $3`,
    [newOutcome, finalPayout ?? existing.final_payout_amount, bidId]
  );

  // Invalidate caches
  await clearBidsCache();

  return existing;
}

export async function getBidsOutcomes(limit: number = 50): Promise<BidOutcome[]> {
  const dbRes = await safeExecutePgQuery(
    `SELECT * FROM bids_outcome ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  if (dbRes && dbRes.rows.length > 0) {
    return dbRes.rows;
  }
  return Array.from(revenueStore.bidsOutcomes.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

// =========================================================================
// 4. REVENUE INTELLIGENCE & A/B DASHBOARD METRICS (Requirement 5)
// =========================================================================

export async function getRevenueIntelligenceStats() {
  const outcomes = await getBidsOutcomes(200);

  const totalBids = outcomes.length;
  const wonBids = outcomes.filter((o) => o.outcome === 'Won');
  const lostBids = outcomes.filter((o) => o.outcome === 'Lost');
  const pendingBids = outcomes.filter((o) => o.outcome === 'Pending');

  const winRate = totalBids > 0 ? Math.round((wonBids.length / totalBids) * 1000) / 10 : 0;
  const totalWonRevenue = wonBids.reduce((acc, o) => acc + (Number(o.final_payout_amount) || Number(o.bid_amount) || 0), 0);
  const avgWinAmount = wonBids.length > 0 ? Math.round(totalWonRevenue / wonBids.length) : 0;

  // A/B Proposal Tone Analysis
  const formalOutcomes = outcomes.filter((o) => o.proposal_tone === 'formal_technical');
  const formalWon = formalOutcomes.filter((o) => o.outcome === 'Won');
  const formalWinRate = formalOutcomes.length > 0 ? Math.round((formalWon.length / formalOutcomes.length) * 1000) / 10 : 0;
  const formalRevenue = formalWon.reduce((acc, o) => acc + (Number(o.final_payout_amount) || Number(o.bid_amount) || 0), 0);

  const impactOutcomes = outcomes.filter((o) => o.proposal_tone === 'impact_driven');
  const impactWon = impactOutcomes.filter((o) => o.outcome === 'Won');
  const impactWinRate = impactOutcomes.length > 0 ? Math.round((impactWon.length / impactOutcomes.length) * 1000) / 10 : 0;
  const impactRevenue = impactWon.reduce((acc, o) => acc + (Number(o.final_payout_amount) || Number(o.bid_amount) || 0), 0);

  const winningTone = formalWinRate > impactWinRate
    ? 'formal_technical'
    : impactWinRate > formalWinRate
    ? 'impact_driven'
    : 'neutral';

  // Projected 30-day revenue based on pending pipeline:
  // sum of (pending bid_amount * historical winRate) + rolling won run-rate
  const pendingPotential = pendingBids.reduce((acc, o) => acc + (Number(o.bid_amount) || 0), 0);
  const projectedRevenue = Math.round(totalWonRevenue + (pendingPotential * (winRate / 100)));

  return {
    winRate,
    totalBids,
    wonBidsCount: wonBids.length,
    lostBidsCount: lostBids.length,
    pendingBidsCount: pendingBids.length,
    totalWonRevenue,
    avgWinAmount,
    projectedRevenue,
    similarityThreshold: revenueStore.similarityThreshold,
    lastAnalysisAt: revenueStore.lastAnalysisAt,
    proposalTonePerformance: {
      formal_technical: {
        total: formalOutcomes.length,
        won: formalWon.length,
        winRate: formalWinRate,
        revenue: formalRevenue,
        name: 'Formal & Technical',
      },
      impact_driven: {
        total: impactOutcomes.length,
        won: impactWon.length,
        winRate: impactWinRate,
        revenue: impactRevenue,
        name: 'Short & Impact-Driven',
      },
      winningTone,
    },
    guardrails: {
      stopLossPaused: revenueStore.stopLossPaused,
      stopLossPauseReason: revenueStore.stopLossPauseReason,
      maxBidMultiplier: revenueStore.maxBidMultiplier,
      connectCreditsSpent7Days: revenueStore.connectCreditsSpent7Days,
      revenue7Days: revenueStore.revenue7Days,
      profitRatio: revenueStore.connectCreditsSpent7Days > 0 ? Math.round((revenueStore.revenue7Days / revenueStore.connectCreditsSpent7Days) * 10) / 10 : 5.0,
    },
    categories: Array.from(revenueStore.categories.values()),
    recentPayoutsCount: revenueStore.automatedPayouts.length,
  };
}

// =========================================================================
// 5. AUTO-RETRAIN TRIGGER & MIDNIGHT WIN RATE ANALYSIS (Requirement 6)
// =========================================================================

export async function runMidnightWinRateAnalysis(): Promise<{
  previousThreshold: number;
  newThreshold: number;
  winRate: number;
  adjustmentReason: string;
  timestamp: string;
}> {
  const startTime = Date.now();
  const stats = await getRevenueIntelligenceStats();
  const previousThreshold = revenueStore.similarityThreshold;
  let newThreshold = previousThreshold;
  let adjustmentReason = 'Win rate within optimal equilibrium (15%-30%); threshold maintained.';

  // If win rate < 12%, increase threshold to be more selective (up to 0.85)
  if (stats.winRate < 12) {
    newThreshold = Math.min(0.85, Math.round((previousThreshold + 0.05) * 100) / 100);
    adjustmentReason = `Win rate (${stats.winRate}%) below 12% baseline. Tightened SIMILARITY_THRESHOLD from ${previousThreshold} to ${newThreshold} for higher lead precision.`;
  }
  // If win rate > 28%, decrease threshold to expand volume (down to 0.65)
  else if (stats.winRate > 28) {
    newThreshold = Math.max(0.65, Math.round((previousThreshold - 0.05) * 100) / 100);
    adjustmentReason = `Win rate (${stats.winRate}%) exceeds 28% ceiling. Relaxed SIMILARITY_THRESHOLD from ${previousThreshold} to ${newThreshold} to capture higher lead volume.`;
  }

  revenueStore.similarityThreshold = newThreshold;
  revenueStore.lastAnalysisAt = new Date().toISOString();

  // Enforce Anti-Bankruptcy Profit Threshold (Requirement 10)
  // Calculate Revenue / Total Bids. If < 1.0, lower MAX_BID_AMOUNT by 20%
  const profitRatio = stats.guardrails.profitRatio;
  if (profitRatio < 1.0) {
    revenueStore.maxBidMultiplier = 0.8;
    console.warn(`⚠️ [Anti-Bankruptcy] Profit ratio (${profitRatio}) < 1.0. Lowered MAX_BID_AMOUNT by 20%.`);
  } else if (profitRatio >= 2.0 && revenueStore.maxBidMultiplier < 1.0) {
    revenueStore.maxBidMultiplier = 1.0;
    console.log(`✅ [Anti-Bankruptcy] Profitability recovered (${profitRatio}). Restored 100% bid capacity.`);
  }

  // Portfolio Optimization (Requirement 9)
  for (const cat of revenueStore.categories.values()) {
    if (cat.status === 'active' && (cat.winRate < 1.0 || cat.netProfitPerHour < 10.0) && cat.totalBids >= 15) {
      cat.status = 'paused_low_yield';
      cat.pausedReason = `Win rate (${cat.winRate}%) < 1% or Net Profit/hr ($${cat.netProfitPerHour}) < $10/hr after 30-day rolling window.`;
      console.warn(`🛑 [PortfolioOptimizer] Paused category "${cat.category}": ${cat.pausedReason}`);
    }
  }

  logActivityEvent({
    source: 'MLWorker',
    type: 'WIN_RATE_ANALYSIS',
    status: 'success',
    summary: `Midnight Win Rate Analysis complete: Win Rate ${stats.winRate}%. ${adjustmentReason}`,
    latencyMs: Date.now() - startTime,
    tags: ['ml', 'retraining', 'similarity_threshold', 'revenue_engine'],
  });

  return {
    previousThreshold,
    newThreshold,
    winRate: stats.winRate,
    adjustmentReason,
    timestamp: revenueStore.lastAnalysisAt,
  };
}

// =========================================================================
<<<<<<< HEAD
// 6. AUTONOMOUS REVENUE REALIZATION & RISK BANDS (Requirement 7)
=======
// 6. REVENUE REALIZATION & RECEIVABLES RECORDING
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
// =========================================================================

export async function executeAutonomousCashOut(params: {
  workOrderId: string;
  bidId?: string;
  projectTitle: string;
  clientName: string;
  amount: number;
  workerEmail: string;
  isTimeBased?: boolean;
}): Promise<{
  success: boolean;
  riskBand: 'instant_transfer' | 'standard_automated' | 'high_value_review';
  status: 'completed' | 'pending_approval' | 'failed';
  payoutBatchId: string | null;
  invoiceNumber?: string;
  message: string;
}> {
  const { workOrderId, bidId, projectTitle, clientName, amount, workerEmail, isTimeBased } = params;
  const numAmount = Number(amount);

<<<<<<< HEAD
  // Determine Risk Band:
  // - < $100: Auto-transfer immediately
  // - $100 - $500: Standard automated escrow release
  // - > $500: High-value outlier -> Flag for Telegram quick confirmation (Human-in-the-loop)
  let riskBand: 'instant_transfer' | 'standard_automated' | 'high_value_review';
  if (numAmount < 100) {
    riskBand = 'instant_transfer';
  } else if (numAmount <= 500) {
    riskBand = 'standard_automated';
  } else {
    riskBand = 'high_value_review';
  }

  const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // If time-based, auto-generate invoice record
  if (isTimeBased) {
    console.log(`📄 [CashOut] Auto-generating PDF invoice ${invoiceNumber} for time-based milestone: $${numAmount}`);
  }

  // High-value band (> $500): Dispatch Telegram quick confirmation alert
  if (riskBand === 'high_value_review') {
    const telegramAlertMsg = `🚨 *[HIGH-VALUE CASH-OUT ALERT]*
💰 *Amount:* $${numAmount.toLocaleString()} USD
💼 *Project:* ${projectTitle}
👤 *Client:* ${clientName}
📫 *Worker Payout Email:* ${workerEmail}

⚡ Milestone completed. Confirm escrow release:
Reply *YES* to immediately transfer via PayPal, or *HOLD* for review.`;

    // Attempt Telegram dispatch via Lead Notifications store
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (botToken && chatId) {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: chatId,
          text: telegramAlertMsg,
          parse_mode: 'Markdown',
        }, { timeout: 4000 }).catch(() => {});
      }
    } catch {
      // Ignored if telegram offline
    }

    const record: AutomatedPayoutRecord = {
      id: `payout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      work_order_id: workOrderId,
      bid_id: bidId,
      project_title: projectTitle,
      client_name: clientName,
      amount: numAmount,
      currency: 'USD',
      risk_band: 'high_value_review',
      status: 'pending_approval',
      payout_batch_id: null,
      invoice_number: invoiceNumber,
      executed_at: new Date().toISOString(),
      details: { humanInTheLoopReason: 'Amount exceeds $500 threshold. Telegram alert dispatched.' },
    };

    revenueStore.automatedPayouts.unshift(record);

    logActivityEvent({
      source: 'PayPal',
      type: 'CASHOUT_HELD_FOR_REVIEW',
      status: 'warning',
      summary: `High-value cash-out ($${numAmount}) held for Telegram approval for Work Order ${workOrderId}`,
      tags: ['cash_out', 'risk_band', 'high_value_review'],
    });

    return {
      success: true,
      riskBand,
      status: 'pending_approval',
      payoutBatchId: null,
      invoiceNumber,
      message: `High-value milestone ($${numAmount}) flagged for quick Telegram approval (Band: >$500).`,
    };
  }

  // Auto-transfer immediately (<$100 or $100-$500)
  try {
    const payoutResult = await createPayPalPayout({
      receiverEmail: workerEmail,
      amount: numAmount,
      currency: 'USD',
      note: `Autonomous Cash-Out for completed project: ${projectTitle} (Invoice ${invoiceNumber})`,
    });

    const record: AutomatedPayoutRecord = {
      id: `payout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      work_order_id: workOrderId,
      bid_id: bidId,
      project_title: projectTitle,
      client_name: clientName,
      amount: numAmount,
      currency: 'USD',
      risk_band: riskBand,
      status: 'completed',
      payout_batch_id: payoutResult.payoutBatchId,
      invoice_number: invoiceNumber,
      executed_at: new Date().toISOString(),
      details: { isTimeBased: Boolean(isTimeBased), autoEscrowRelease: true },
    };

    revenueStore.automatedPayouts.unshift(record);

    // Update bids_outcome final payout
    if (bidId) {
      await updateBidOutcomeStatus(bidId, 'Won', numAmount);
    }

    logActivityEvent({
      source: 'PayPal',
      type: 'AUTONOMOUS_CASHOUT',
      status: 'success',
      summary: `Autonomous PayPal transfer completed: $${numAmount} to ${workerEmail} (Batch: ${payoutResult.payoutBatchId})`,
      tags: ['cash_out', 'risk_band', riskBand, 'escrow_release'],
    });

    return {
      success: true,
      riskBand,
      status: 'completed',
      payoutBatchId: payoutResult.payoutBatchId,
      invoiceNumber,
      message: `Milestone funds ($${numAmount}) automatically released via PayPal API (Batch: ${payoutResult.payoutBatchId}).`,
    };
  } catch (err: any) {
    console.error('❌ [CashOut] Payout error:', err.message);
    return {
      success: false,
      riskBand,
      status: 'failed',
      payoutBatchId: null,
      invoiceNumber,
      message: `PayPal payout execution failed: ${err.message}`,
    };
  }
=======
  const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  if (isTimeBased) {
    console.log(`📄 [Receivables] Generated invoice ${invoiceNumber} for time-based milestone: $${numAmount}`);
  }

  const record: AutomatedPayoutRecord = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    work_order_id: workOrderId,
    bid_id: bidId,
    project_title: projectTitle,
    client_name: clientName,
    amount: numAmount,
    currency: 'USD',
    risk_band: 'standard_automated',
    status: 'completed',
    payout_batch_id: null,
    invoice_number: invoiceNumber,
    executed_at: new Date().toISOString(),
    details: { isTimeBased: Boolean(isTimeBased), autoEscrowRelease: false, receivableAccrued: true },
  };

  revenueStore.automatedPayouts.unshift(record);

  if (bidId) {
    await updateBidOutcomeStatus(bidId, 'Won', numAmount);
  }

  logActivityEvent({
    source: 'PayPal',
    type: 'WORK_ORDER_COMPLETED',
    status: 'success',
    summary: `Work order milestone recorded as receivable: $${numAmount} for ${projectTitle} (${clientName})`,
    tags: ['receivable', 'completed', 'work_order'],
  });

  return {
    success: true,
    riskBand: 'standard_automated',
    status: 'completed',
    payoutBatchId: null,
    invoiceNumber,
    message: `Milestone completed and recorded as receivable ($${numAmount}).`,
  };
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
}

export function getAutomatedPayoutsLog(): AutomatedPayoutRecord[] {
  return [...revenueStore.automatedPayouts];
}

// =========================================================================
// 7. INTELLIGENT LEAD NURTURING & FOLLOW-UP (Requirement 8)
// =========================================================================

export async function processLeadNurturingFollowups(): Promise<{
  scannedCount: number;
  followupsDispatched: number;
  records: LeadFollowupRecord[];
}> {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const dispatched: LeadFollowupRecord[] = [];

  const outcomes = Array.from(revenueStore.bidsOutcomes.values());
  const pendingLeads = outcomes.filter((o) => {
    const isPending = o.outcome === 'Pending';
    const isOlderThan24h = new Date(o.created_at).getTime() <= oneDayAgo;
    const alreadyFollowedUp = revenueStore.leadFollowups.some((f) => f.bid_id === o.bid_id);
    return isPending && isOlderThan24h && !alreadyFollowedUp;
  });

  const ai = getGeminiAI();

  for (const lead of pendingLeads.slice(0, 5)) {
    let followUpText = '';
    if (ai) {
      try {
        const prompt = `Write a polite, high-converting 2-sentence follow-up message to a client on a freelance platform:
Project: ${lead.project_title}
Context: Proposal was submitted 24 hours ago. Inquire if they need any adjustments to technical scope or want a quick prototype preview.`;
        const res = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
        });
        followUpText = res.text?.trim() || '';
      } catch {
        // Fallback
      }
    }

    if (!followUpText) {
      followUpText = `Hi! Just checking in to see if you have any questions on the proposal for "${lead.project_title}", or if you would like me to prepare a quick architectural prototype before contract start?`;
    }

    const record: LeadFollowupRecord = {
      id: `flw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      bid_id: lead.bid_id,
      project_title: lead.project_title,
      client_name: 'Hiring Client',
      message_text: followUpText,
      dispatched_at: new Date().toISOString(),
      status: 'sent',
      conversion_trigger: false,
    };

    revenueStore.leadFollowups.unshift(record);
    dispatched.push(record);

    logActivityEvent({
      source: 'LeadNurturing',
      type: 'LEAD_FOLLOWUP_DISPATCHED',
      status: 'success',
      summary: `Automated 24h follow-up message dispatched for bid #${lead.bid_id}: "${lead.project_title}"`,
      tags: ['lead_nurturing', 'gemini_followup', 'auto_conversion'],
    });
  }

  return {
    scannedCount: pendingLeads.length,
    followupsDispatched: dispatched.length,
    records: dispatched,
  };
}

export function getLeadFollowups(): LeadFollowupRecord[] {
  return [...revenueStore.leadFollowups];
}

// =========================================================================
// 8. SECURITY & ANTI-BANKRUPTCY GUARDRAILS (Requirement 10)
// =========================================================================

export function evaluateBankruptcyGuardrails(): {
  canBid: boolean;
  stopLossPaused: boolean;
  reason: string;
  connectCreditsSpent7Days: number;
  revenue7Days: number;
  maxBidMultiplier: number;
} {
  // Stop-Loss Logic: If $500 spent on bid connects with $0 revenue in rolling 7-day window
  if (revenueStore.connectCreditsSpent7Days >= 500 && revenueStore.revenue7Days === 0) {
    revenueStore.stopLossPaused = true;
    revenueStore.stopLossPauseReason = 'Revenue stall detected: $500 spent on connects with $0 revenue in 7 days. Pausing until manual review.';

    // Send Telegram alert
    try {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (botToken && chatId) {
        axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: chatId,
          text: `🛑 *[ANTI-BANKRUPTCY STOP-LOSS TRIGGERED]*\n\nRevenue stall detected: $500 spent on bid credits with $0 revenue in rolling 7-day window.\nAll auto-bidding has been safely paused until manual review.`,
          parse_mode: 'Markdown',
        }).catch(() => {});
      }
    } catch {}

    return {
      canBid: false,
      stopLossPaused: true,
      reason: revenueStore.stopLossPauseReason,
      connectCreditsSpent7Days: revenueStore.connectCreditsSpent7Days,
      revenue7Days: revenueStore.revenue7Days,
      maxBidMultiplier: revenueStore.maxBidMultiplier,
    };
  }

  return {
    canBid: !revenueStore.stopLossPaused,
    stopLossPaused: revenueStore.stopLossPaused,
    reason: revenueStore.stopLossPaused ? revenueStore.stopLossPauseReason : 'Guardrails clear',
    connectCreditsSpent7Days: revenueStore.connectCreditsSpent7Days,
    revenue7Days: revenueStore.revenue7Days,
    maxBidMultiplier: revenueStore.maxBidMultiplier,
  };
}

export function resumeBiddingAfterReview(): { success: boolean; message: string } {
  revenueStore.stopLossPaused = false;
  revenueStore.stopLossPauseReason = '';
  return {
    success: true,
    message: 'Auto-bidding resumed. Anti-bankruptcy stop-loss reset after manual review.',
  };
}

export const checkBankruptcyRisk = evaluateBankruptcyGuardrails;

// =========================================================================
// 9. PERFORMANCE & DATABASE MAINTENANCE (Requirement 13)
// =========================================================================

export async function runWeeklyDatabaseMaintenance(): Promise<{
  success: boolean;
  analyzedTables: string[];
  archivedBidsCount: number;
}> {
  const analyzedTables: string[] = [];

  // Run ANALYZE and REINDEX on postgres if online
  const analyzeRes = await safeExecutePgQuery('ANALYZE bids_outcome;');
  if (analyzeRes) analyzedTables.push('bids_outcome');

  const jobsRes = await safeExecutePgQuery('ANALYZE jobs;');
  if (jobsRes) analyzedTables.push('jobs');

  // Auto-Archive bids older than 90 days
  let archivedCount = 0;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const archiveRes = await safeExecutePgQuery(
    `INSERT INTO bids_outcome_archive
     SELECT * FROM bids_outcome WHERE created_at < $1
     ON CONFLICT (id) DO NOTHING;`,
    [ninetyDaysAgo]
  );
  if (archiveRes) {
    const deleteRes = await safeExecutePgQuery(
      `DELETE FROM bids_outcome WHERE created_at < $1;`,
      [ninetyDaysAgo]
    );
    archivedCount = deleteRes?.rowCount || 0;
  }

  console.log(`🧹 [Maintenance] Database ANALYZE completed for [${analyzedTables.join(', ')}]. Archived ${archivedCount} historical bids (>90 days).`);

  return {
    success: true,
    analyzedTables,
    archivedBidsCount: archivedCount,
  };
}
