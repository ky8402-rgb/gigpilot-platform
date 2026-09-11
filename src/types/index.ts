export type PlatformType = 'RemoteOK' | 'WeWorkRemotely' | 'FlexJobs' | 'Direct Remote' | 'Public Gig';

export type JobType = 'fixed' | 'hourly';

export interface ClientInfo {
  name?: string;
  country: string;
  rating: number;
  totalSpent: number;
  paymentVerified: boolean;
  hiresCount: number;
  hireRate: number; // e.g., 85%
}

export interface FreelanceJob {
  id: string;
  externalId?: string;
  externalUrl?: string;
  title: string;
  platform: PlatformType | string;
  platformUrl?: string;
  type: JobType;
  budget: number;
  hourlyMin?: number;
  hourlyMax?: number;
  description: string;
  skills: string[];
  client: ClientInfo;
  postedAt: string; // ISO or relative
  timestamp: number;
  proposalsCount: number;
  connectsRequired: number;
  matchScore: number;
  experienceLevel: 'Entry' | 'Intermediate' | 'Expert';
  status: 'new' | 'analyzed' | 'bid_submitted' | 'queued' | 'interviewing' | 'won' | 'rejected';
  aiRecommendation?: 'STRONG_BID' | 'CONSIDER' | 'SKIP' | 'HIGH_RISK';
}

export interface ProposedMilestone {
  name: string;
  amount: number;
  durationDays: number;
}

export interface GeneratedProposal {
  coverLetter: string;
  hookSummary: string;
  estimatedDays: number;
  proposedMilestones: ProposedMilestone[];
  clientQuestions: string[];
  matchConfidenceScore: number;
  bidAmount: number;
}

export interface AutopilotLog {
  id: string;
  timestamp: string;
  jobId?: string;
  jobTitle?: string;
  platform?: PlatformType | string;
  action: 'SCAN' | 'MATCH' | 'AI_PROPOSAL' | 'AUTO_BID' | 'QUEUED' | 'CLIENT_REPLY' | 'EARNING_PAYOUT';
  message: string;
  level: 'info' | 'success' | 'warning' | 'alert';
  connectsUsed?: number;
  amount?: number;
}

export interface ActiveContract {
  id: string;
  jobTitle: string;
  platform: PlatformType | string;
  clientName: string;
  totalValue: number;
  amountPaid: number;
  status: 'in_progress' | 'review' | 'completed' | 'disputed';
  milestones: {
    id: string;
    title: string;
    amount: number;
    completed: boolean;
    dueDate: string;
  }[];
  startedDate: string;
  lastMessage?: string;
}

export interface PassiveYieldNode {
  id: string;
  name: string;
  category: 'Bandwidth Sharing' | 'AI Inference' | 'Staking Validator' | 'Micro-Task Daemon';
  status: 'active' | 'paused' | 'syncing';
  dailyRate: number; // in USD
  hourlyRate: number;
  totalEarned: number;
  efficiency: number; // %
  uptime: string;
  metrics: {
    networkSpeed?: string;
    dataTransferred?: string;
    tokensYielded?: string;
    tasksProcessed?: number;
  };
}

export interface FreelancerProfile {
  name: string;
  title: string;
  bio: string;
  hourlyRate: number;
  skills: string[];
  experienceLevel: string;
  portfolioLinks: { title: string; url: string }[];
  preferredCategories?: string[];
  targetMonthlyIncome?: number;
}

export interface AutopilotRules {
  mode: 'autonomous' | 'review_queue' | 'standby';
  minMatchScore: number;
  minFixedBudget: number;
  minHourlyRate: number;
  requireVerifiedPayment: boolean;
  minClientRating: number;
  maxDailyBids: number;
  bidsToday: number;
  proposalTone: 'confident' | 'consultative' | 'technical' | 'friendly';
  blacklistKeywords: string[];
  autoBoostBids: boolean;
}

export const defaultProfile: FreelancerProfile = {
  name: "Kundan Kumar",
  title: "Senior Full-Stack Developer & Autonomous Automation Architect",
  bio: "Experienced developer specializing in full-stack web applications, custom automated scrapers, SaaS backends, and AI pipelines (React, TypeScript, Node.js, Python, PostgreSQL, Gemini AI). Top-rated track record delivering enterprise-grade solutions with seamless payout settlements.",
  hourlyRate: 85,
  skills: [
    "React",
    "TypeScript",
    "Node.js",
    "Python",
    "Tailwind CSS",
    "Gemini AI / LLMs",
    "Express",
    "Web Automation",
    "PostgreSQL",
    "API Integrations"
  ],
  experienceLevel: "Expert",
  portfolioLinks: [
    { title: "Autonomous Job Scanner SaaS", url: "https://github.com/example/freelance-autopilot" },
    { title: "AI-Powered CRM & Invoicing Platform", url: "https://example.com/crm-suite" }
  ]
};

export const defaultRules: AutopilotRules = {
  mode: 'autonomous',
  minMatchScore: 82,
  minFixedBudget: 300,
  minHourlyRate: 45,
  requireVerifiedPayment: true,
  minClientRating: 4.6,
  maxDailyBids: 15,
  bidsToday: 6,
  proposalTone: 'confident',
  blacklistKeywords: ['unpaid', 'equity only', 'revshare', 'test assignment without pay', 'crypto pump', 'telegram dm'],
  autoBoostBids: true
};

<<<<<<< HEAD
export const defaultActiveContracts: ActiveContract[] = [];
=======
export const defaultActiveContracts: ActiveContract[] = [
  {
    id: 'CON-2026-8821',
    jobTitle: 'Full-Stack Autonomous Web Scraper & Gemini LLM Enrichment Pipeline',
    platform: 'RemoteOK',
    clientName: 'AeroTech Systems Inc.',
    totalValue: 2400,
    amountPaid: 1200,
    status: 'in_progress',
    milestones: [
      { 
        id: 'M1', 
        title: 'Phase 1: Architecture Blueprint & High-Performance Headless Scraper Daemon', 
        amount: 1200, 
        completed: true, 
        dueDate: 'Completed Sep 04, 2026' 
      },
      { 
        id: 'M2', 
        title: 'Phase 2: Gemini 2.5/Flash AI Data Enrichment & PostgreSQL Neon Schema Sync', 
        amount: 800, 
        completed: false, 
        dueDate: 'Due Sep 18, 2026' 
      },
      { 
        id: 'M3', 
        title: 'Phase 3: Production Hardening, CI/CD Actions & Automated Handover', 
        amount: 400, 
        completed: false, 
        dueDate: 'Due Sep 26, 2026' 
      }
    ],
    startedDate: 'Sep 01, 2026',
    lastMessage: 'Scraper daemon benchmarks look great! Please proceed with Phase 2 Gemini pipeline integration.'
  },
  {
    id: 'CON-2026-7940',
    jobTitle: 'Enterprise Next.js SaaS Portal with Stripe & PayPal SDK v6 Integration',
    platform: 'Upwork',
    clientName: 'CloudScale Global LLC',
    totalValue: 3800,
    amountPaid: 1900,
    status: 'in_progress',
    milestones: [
      { 
        id: 'M1', 
        title: 'Milestone 1: Multi-Tenant Authentication & Core SaaS Dashboard Infrastructure', 
        amount: 1900, 
        completed: true, 
        dueDate: 'Completed Aug 28, 2026' 
      },
      { 
        id: 'M2', 
        title: 'Milestone 2: Payment Gateways Integration & Automated Invoicing Engine', 
        amount: 1200, 
        completed: false, 
        dueDate: 'Due Sep 15, 2026' 
      },
      { 
        id: 'M3', 
        title: 'Milestone 3: Security Audit, Load Testing & Cloud Run Domain Deployment', 
        amount: 700, 
        completed: false, 
        dueDate: 'Due Sep 30, 2026' 
      }
    ],
    startedDate: 'Aug 20, 2026',
    lastMessage: 'Escrow funded for Milestone 2. Looking forward to the payment gateway rollout.'
  }
];
>>>>>>> 8fab0ab (Deploy to AWS EC2 and AWS Amplify)
