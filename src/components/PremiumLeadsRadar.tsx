import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Zap,
  Lock,
  Crown,
  CheckCircle2,
  TrendingUp,
  ShieldCheck,
  DollarSign,
  Search,
  Filter,
  Flame,
  ArrowRight,
  Mail,
  Bell,
  RefreshCw,
  Sliders,
  ExternalLink,
  Layers,
  AlertTriangle,
  Send,
  Eye,
  Check,
  CreditCard,
  Target
} from 'lucide-react';
import { 
  fetchScoredLeadsFeed, 
  bulkAnalyzeLeads, 
  autoBidLeads, 
  fetchKeywordAlerts, 
  createKeywordAlert, 
  deleteKeywordAlert,
  testSendKeywordAlert,
  createSubscriptionCheckout,
  ScoredLeadItem,
  ScoredFeedResponse
} from '../services/api';
import { FreelanceJob, FreelancerProfile } from '../types';

interface PremiumLeadsRadarProps {
  profile: FreelancerProfile;
  onOpenProposalStudio: (job: FreelanceJob) => void;
  onAnalyzeJob: (job: FreelanceJob) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

export const PremiumLeadsRadar: React.FC<PremiumLeadsRadarProps> = ({
  profile,
  onOpenProposalStudio,
  onAnalyzeJob,
  showToast
}) => {
  const [feedData, setFeedData] = useState<ScoredFeedResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeFilter, setActiveFilter] = useState<'all' | 'high_paying' | 'easy_to_win'>('all');
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeUserTier, setActiveUserTier] = useState<'free' | 'pro' | 'enterprise'>('free');
  const [isUpgrading, setIsUpgrading] = useState<boolean>(false);
  const [isBulkAnalyzing, setIsBulkAnalyzing] = useState<boolean>(false);
  const [isAutoBidding, setIsAutoBidding] = useState<boolean>(false);
  
  // Paywall & Upgrade Modal State
  const [isPaywallOpen, setIsPaywallOpen] = useState<boolean>(false);
  const [paywallPlan, setPaywallPlan] = useState<'pro' | 'enterprise'>('pro');
  const [paywallReason, setPaywallReason] = useState<string>('');

  // Keyword Alerts State (Enterprise)
  const [isAlertsModalOpen, setIsAlertsModalOpen] = useState<boolean>(false);
  const [keywordAlerts, setKeywordAlerts] = useState<any[]>([]);
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [newMinBudget, setNewMinBudget] = useState<number>(1000);
  const [alertEmail, setAlertEmail] = useState<string>('ky8402@gmail.com');
  const [testingAlertId, setTestingAlertId] = useState<string | null>(null);

  // Load scored leads feed
  const loadLeadsFeed = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const data = await fetchScoredLeadsFeed({
        tier: activeUserTier,
        filter: activeFilter,
        category: activeCategory !== 'ALL' ? activeCategory : undefined,
        refresh: forceRefresh
      });
      setFeedData(data);
    } catch (err: any) {
      showToast(err.message || 'Failed to load scored leads', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeadsFeed();
  }, [activeUserTier, activeFilter, activeCategory]);

  // Load alerts when opening alerts modal
  const loadAlerts = async () => {
    try {
      const res = await fetchKeywordAlerts();
      if (res.success) {
        setKeywordAlerts(res.alerts || []);
      }
    } catch (err: any) {
      console.warn('Could not load alerts:', err.message);
    }
  };

  const handleOpenAlerts = () => {
    if (activeUserTier !== 'enterprise') {
      setPaywallPlan('enterprise');
      setPaywallReason('Automated Email Keyword Alerts are exclusively available on the Enterprise Tier ($49/mo).');
      setIsPaywallOpen(true);
      return;
    }
    loadAlerts();
    setIsAlertsModalOpen(true);
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;

    try {
      const res = await createKeywordAlert({
        keyword: newKeyword.trim(),
        minBudget: newMinBudget,
        category: 'High Yield',
        email: alertEmail
      });
      if (res.success) {
        showToast(`Keyword Alert created for "${newKeyword}". Live email monitoring started.`, 'success');
        setNewKeyword('');
        loadAlerts();
      }
    } catch (err: any) {
      if (err.code === 'ENTERPRISE_REQUIRED') {
        setIsAlertsModalOpen(false);
        setPaywallPlan('enterprise');
        setPaywallReason('Enterprise Tier ($49/mo) required to save automated keyword email alerts.');
        setIsPaywallOpen(true);
      } else {
        showToast(err.message, 'error');
      }
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      await deleteKeywordAlert(id);
      showToast('Keyword alert removed', 'info');
      loadAlerts();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleTestAlertSend = async (keyword: string) => {
    setTestingAlertId(keyword);
    try {
      const res = await testSendKeywordAlert(alertEmail, keyword);
      if (res.success) {
        showToast(`Dispatched test email alert to ${alertEmail} for "${keyword}"!`, 'success');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setTestingAlertId(null);
    }
  };

  // Bulk Gemini AI Analysis Handler
  const handleBulkAnalyze = async () => {
    if (activeUserTier === 'free') {
      setPaywallPlan('pro');
      setPaywallReason('Bulk Gemini Lead Scoring is locked for Free users. Upgrade to Pro ($19/mo) to score 50+ leads instantly.');
      setIsPaywallOpen(true);
      return;
    }

    setIsBulkAnalyzing(true);
    try {
      const res = await bulkAnalyzeLeads();
      if (res.success) {
        showToast(`Gemini analyzed ${res.analyzedCount} high-yield opportunities with custom win strategies!`, 'success');
        loadLeadsFeed(true);
      }
    } catch (err: any) {
      if (err.code === 'UPGRADE_REQUIRED') {
        setPaywallPlan('pro');
        setPaywallReason(err.message);
        setIsPaywallOpen(true);
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setIsBulkAnalyzing(false);
    }
  };

  // 1-Click Auto-Bid Handler
  const handleAutoBidAll = async () => {
    if (activeUserTier === 'free') {
      setPaywallPlan('pro');
      setPaywallReason('Autonomous 1-Click Auto-Bidding requires Pro Tier ($19/mo) or Enterprise Tier ($49/mo).');
      setIsPaywallOpen(true);
      return;
    }

    setIsAutoBidding(true);
    try {
      const res = await autoBidLeads();
      if (res.success) {
        showToast(`Auto-bidding dispatched ${res.submittedCount} tailored AI proposals to top leads!`, 'success');
      }
    } catch (err: any) {
      if (err.code === 'UPGRADE_REQUIRED') {
        setPaywallPlan('pro');
        setPaywallReason(err.message);
        setIsPaywallOpen(true);
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setIsAutoBidding(false);
    }
  };

  // Stripe Subscription Checkout Handler
  const handleStartSubscription = async (plan: 'pro' | 'enterprise') => {
    setIsUpgrading(true);
    try {
      const res = await createSubscriptionCheckout(plan);
      if (res.url) {
        if (res.isSimulated) {
          showToast(`Membership upgraded to ${plan.toUpperCase()} Tier! Granted bonus credits.`, 'success');
          setActiveUserTier(plan);
          setIsPaywallOpen(false);
          loadLeadsFeed(true);
        } else {
          window.location.href = res.url;
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Checkout failed', 'error');
    } finally {
      setIsUpgrading(false);
    }
  };

  // Convert ScoredLead to FreelanceJob format for standard ProposalStudio & Analysis Modals
  const toFreelanceJob = (lead: ScoredLeadItem): FreelanceJob => ({
    id: lead.id,
    title: lead.title,
    platform: lead.platform,
    platformUrl: lead.url,
    type: lead.type,
    budget: lead.budget,
    hourlyMin: lead.hourlyRate ? lead.hourlyRate - 10 : undefined,
    hourlyMax: lead.hourlyRate ? lead.hourlyRate + 15 : undefined,
    description: lead.description,
    skills: lead.tags,
    client: {
      name: lead.client.name,
      country: lead.client.country,
      rating: lead.client.rating,
      totalSpent: lead.client.totalSpent,
      paymentVerified: lead.client.paymentVerified,
      hiresCount: lead.client.hiresCount,
      hireRate: lead.client.hireRate
    },
    postedAt: lead.postedAt,
    timestamp: lead.timestamp,
    proposalsCount: lead.proposalsCount,
    connectsRequired: 0,
    matchScore: lead.leadScore,
    experienceLevel: 'Expert',
    status: 'new',
    aiRecommendation: lead.aiRecommendation
  });

  const filteredLeads = (feedData?.leads || []).filter(lead => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      lead.title.toLowerCase().includes(q) ||
      lead.company.toLowerCase().includes(q) ||
      lead.description.toLowerCase().includes(q) ||
      lead.tags.some(t => t.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      
      {/* Top Banner: Real Lead Scoring Engine & Stats */}
      <div className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-[#121626] via-[#0e1220] to-[#151930] p-6 shadow-2xl">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 -mb-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 px-3 py-1 text-xs font-semibold text-indigo-300">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                Gemini 2.5 Real Lead Scoring Engine
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300 font-mono">
                <ShieldCheck className="h-3.5 w-3.5" />
                500 Live Scraped Opportunities
              </span>
            </div>
            
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              High-Yield Lead Scoring & Automated Bidding
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Algorithmic scoring across 500 remote jobs evaluating budget yield, win probability, verified payment track record, and low proposal density.
            </p>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-3.5 backdrop-blur-sm">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Scraped Pool</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-xl font-bold text-white">{feedData?.stats.totalScraped || 500}</span>
                <span className="text-[10px] text-slate-500">jobs</span>
              </div>
            </div>

            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 backdrop-blur-sm">
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 block">High-Paying ($3k+)</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-xl font-bold text-emerald-300">{feedData?.stats.highPayingCount || 184}</span>
                <span className="text-[10px] text-emerald-500">leads</span>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3.5 backdrop-blur-sm">
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 block">Easy to Win</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-xl font-bold text-amber-300">{feedData?.stats.easyToWinCount || 142}</span>
                <span className="text-[10px] text-amber-500">&lt;4 bids</span>
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-3.5 backdrop-blur-sm">
              <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 block">Top Lead Score</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-mono text-xl font-bold text-indigo-300">{feedData?.stats.topLeadScore || 99}</span>
                <span className="text-[10px] text-indigo-500">/ 100</span>
              </div>
            </div>
          </div>
        </div>

        {/* Subscription Tier Status & Switcher Bar */}
        <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-t border-slate-800/80 pt-5">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Tier:</span>
            
            <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950/90 p-1">
              <button
                onClick={() => setActiveUserTier('free')}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                  activeUserTier === 'free'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Free (5 Leads)
              </button>

              <button
                onClick={() => setActiveUserTier('pro')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                  activeUserTier === 'pro'
                    ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="h-3 w-3 text-amber-300" />
                <span>Pro ($19/mo)</span>
              </button>

              <button
                onClick={() => setActiveUserTier('enterprise')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                  activeUserTier === 'enterprise'
                    ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Crown className="h-3 w-3 text-amber-200" />
                <span>Enterprise ($49/mo)</span>
              </button>
            </div>
          </div>

          {/* Action Buttons: Bulk Analyze, Auto-Bid, Keyword Alerts */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleOpenAlerts}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 transition-all hover:bg-amber-500/20 active:scale-95"
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Keyword Email Alerts</span>
              {activeUserTier !== 'enterprise' && <Lock className="h-3 w-3 text-amber-400 ml-1" />}
            </button>

            <button
              onClick={handleBulkAnalyze}
              disabled={isBulkAnalyzing}
              className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/20 px-3.5 py-2 text-xs font-semibold text-indigo-200 transition-all hover:bg-indigo-600/30 active:scale-95 disabled:opacity-50"
            >
              <Sparkles className={`h-3.5 w-3.5 ${isBulkAnalyzing ? 'animate-spin' : ''}`} />
              <span>{isBulkAnalyzing ? 'Scoring...' : 'Bulk Gemini Lead Scoring'}</span>
              {activeUserTier === 'free' && <Lock className="h-3 w-3 text-indigo-400 ml-1" />}
            </button>

            <button
              onClick={handleAutoBidAll}
              disabled={isAutoBidding}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 transition-all hover:from-emerald-500 hover:to-teal-500 active:scale-95 disabled:opacity-50"
            >
              <Zap className={`h-3.5 w-3.5 fill-current ${isAutoBidding ? 'animate-bounce' : ''}`} />
              <span>{isAutoBidding ? 'Submitting...' : 'Auto-Bid Top Leads'}</span>
              {activeUserTier === 'free' && <Lock className="h-3 w-3 text-white/70 ml-1" />}
            </button>
          </div>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3.5 backdrop-blur-sm">
        
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search 500 leads by title, company, tag (React, Python, Gemini, Stripe, AI)..."
            className="w-full rounded-xl border border-slate-800 bg-slate-950/90 py-2.5 pl-10 pr-4 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          
          <div className="flex rounded-xl border border-slate-800 bg-slate-950/80 p-1">
            <button
              onClick={() => setActiveFilter('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeFilter === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Scored
            </button>

            <button
              onClick={() => setActiveFilter('high_paying')}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeFilter === 'high_paying'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <DollarSign className="h-3 w-3" />
              <span>High-Paying ($3k+)</span>
            </button>

            <button
              onClick={() => setActiveFilter('easy_to_win')}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeFilter === 'easy_to_win'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="h-3 w-3" />
              <span>Easy to Win (&lt;4 Bids)</span>
            </button>
          </div>

          <button
            onClick={() => loadLeadsFeed(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-all"
            title="Refresh lead scoring index"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Free Tier Notice & Upgrade Callout */}
      {activeUserTier === 'free' && (
        <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900 p-4 backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300">
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Free Tier View Limit Active (5 of 500 Leads Visible)</h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  Upgrade to <strong className="text-indigo-300">Pro Tier ($19/mo)</strong> to unlock Top 50 analyzed high-paying leads + 50 proposal credits, or <strong className="text-amber-300">Enterprise ($49/mo)</strong> for the full 500 catalog with keyword alerts.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setPaywallPlan('pro');
                setPaywallReason('Upgrade to unlock the Top 50 High-Yield Scored Leads instantly.');
                setIsPaywallOpen(true);
              }}
              className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-950/50 hover:from-indigo-500 hover:to-blue-500 transition-all"
            >
              Upgrade to Pro ($19/mo)
            </button>
          </div>
        </div>
      )}

      {/* Leads List */}
      <div id="leads-list" className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/40 p-16 text-center">
            <RefreshCw className="h-8 w-8 animate-spin text-indigo-400 mb-3" />
            <p className="text-sm font-semibold text-slate-200">Scraping 500 remote jobs and running Gemini Lead Scoring...</p>
            <p className="text-xs text-slate-500 mt-1">Evaluating budget yield, win rates, payment trust & competition density</p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-12 text-center">
            <Target className="mx-auto h-8 w-8 text-slate-500 mb-2" />
            <p className="text-sm font-semibold text-slate-300">No leads matched your search filter</p>
            <p className="text-xs text-slate-500 mt-1">Try resetting the search query or changing the filter category</p>
          </div>
        ) : (
          filteredLeads.map((lead, idx) => (
            <div
              key={lead.id}
              className="group relative overflow-hidden rounded-2xl border border-slate-800/90 bg-slate-900/70 p-5 transition-all hover:border-slate-700 hover:bg-slate-900/90 shadow-lg hover:shadow-xl"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                
                {/* Left: Lead Overview & Tags */}
                <div className="space-y-2.5 flex-1">
                  
                  {/* Badge & Lead Score Header */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-500">#{idx + 1}</span>
                    
                    {/* Lead Score Pill */}
                    <div className="flex items-center gap-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-1 text-xs font-bold text-indigo-300 font-mono">
                      <Flame className="h-3.5 w-3.5 text-orange-400" />
                      <span>{lead.leadScore} Lead Score</span>
                    </div>

                    {/* Category / Badge */}
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold border ${
                      lead.category === 'HIGH_PAYING'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : lead.category === 'EASY_TO_WIN'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                    }`}>
                      {lead.badge}
                    </span>

                    {/* Platform */}
                    <span className="rounded-lg bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                      {lead.platform}
                    </span>

                    {/* Recommendation */}
                    <span className="rounded-lg bg-emerald-500/20 text-emerald-400 px-2 py-0.5 text-[11px] font-bold">
                      {lead.aiRecommendation}
                    </span>
                  </div>

                  {/* Title & Company */}
                  <div>
                    <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                      {lead.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span className="font-medium text-slate-300">{lead.company}</span>
                      <span>•</span>
                      <span>{lead.location}</span>
                      <span>•</span>
                      <span>Client Rating: <strong className="text-amber-400">★ {lead.client.rating}</strong> ({lead.client.hireRate}% hire rate)</span>
                      <span>•</span>
                      <span className="text-emerald-400 font-semibold">{lead.proposalsCount} proposals submitted</span>
                    </div>
                  </div>

                  {/* Description snippet */}
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                    {lead.description}
                  </p>

                  {/* Skill tags */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {lead.tags.map(tag => (
                      <span key={tag} className="rounded-md bg-slate-800/60 px-2 py-0.5 text-[11px] font-medium text-slate-300 border border-slate-750">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Gemini Bid Strategy Insight */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-xs text-slate-300 flex items-start gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
                    <span><strong className="text-indigo-300">Winning Pitch Strategy:</strong> {lead.suggestedBidStrategy}</span>
                  </div>
                </div>

                {/* Right: Financial Yield & Action CTAs */}
                <div className="flex flex-col sm:flex-row lg:flex-col items-end justify-between gap-3 shrink-0 lg:min-w-[180px] border-t lg:border-t-0 lg:border-l border-slate-800 pt-3 lg:pt-0 lg:pl-4">
                  
                  {/* Budget / Effective Rate */}
                  <div className="text-right w-full">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Est. Revenue</span>
                    <div className="font-mono text-xl font-bold text-emerald-400">
                      ${lead.budget.toLocaleString()}
                    </div>
                    <span className="text-[11px] text-slate-400 block font-mono">
                      {lead.hourlyEffectiveRate} (~{lead.estimatedHours} hrs)
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2 w-full">
                    <button
                      onClick={() => onOpenProposalStudio(toFreelanceJob(lead))}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-indigo-950/40 hover:from-indigo-500 hover:to-blue-500 transition-all active:scale-95"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Draft AI Pitch</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onAnalyzeJob(toFreelanceJob(lead))}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-slate-750 bg-slate-800/80 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 transition-all"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Analysis</span>
                      </button>

                      {lead.url && (
                        <a
                          href={lead.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center rounded-lg border border-slate-750 bg-slate-800/80 p-2 text-slate-300 hover:text-white hover:bg-slate-800 transition-all"
                          title="Open Original Job Link"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          ))
        )}

        {/* Locked Preview Cards for Free Tier */}
        {activeUserTier === 'free' && (feedData?.lockedCount || 0) > 0 && (
          <div className="relative mt-6 overflow-hidden rounded-3xl border border-dashed border-indigo-500/40 bg-gradient-to-b from-slate-900/60 to-slate-950/90 p-8 text-center backdrop-blur-md">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 mb-4 shadow-xl">
              <Lock className="h-6 w-6" />
            </div>

            <h3 className="text-lg font-bold text-white">
              +{feedData?.lockedCount || 495} High-Yield Scored Leads Locked
            </h3>
            
            <p className="mt-1 text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
              Unlock the entire catalog of high-paying and easy-to-win opportunities with real lead scoring, win probabilities, and automated 1-click bidding.
            </p>

            {/* Pricing Comparison Mini Card */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto text-left">
              <div className="rounded-2xl border border-indigo-500/40 bg-indigo-950/30 p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 block">Pro Tier</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-bold text-white">$19</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" /> Top 50 analyzed jobs</li>
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" /> 50 proposal credits</li>
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" /> 1-Click Auto-Bid unlocked</li>
                  </ul>
                </div>
                <button
                  onClick={() => handleStartSubscription('pro')}
                  disabled={isUpgrading}
                  className="mt-4 w-full rounded-xl bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition-all shadow-md"
                >
                  {isUpgrading ? 'Starting...' : 'Get Pro ($19/mo)'}
                </button>
              </div>

              <div className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-4 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 block">Enterprise Tier</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-bold text-white">$49</span>
                    <span className="text-xs text-slate-400">/ month</span>
                  </div>
                  <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-amber-400" /> Unlimited 500 analyzed leads</li>
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-amber-400" /> 200 proposal credits</li>
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-amber-400" /> Instant Keyword Email Alerts</li>
                  </ul>
                </div>
                <button
                  onClick={() => handleStartSubscription('enterprise')}
                  disabled={isUpgrading}
                  className="mt-4 w-full rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 py-2 text-xs font-bold text-white hover:from-amber-500 hover:to-orange-500 transition-all shadow-md"
                >
                  {isUpgrading ? 'Starting...' : 'Get Enterprise ($49/mo)'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Paywall Modal */}
      {isPaywallOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-lg rounded-3xl border border-indigo-500/40 bg-[#0f1322] p-6 shadow-2xl">
            <button
              onClick={() => setIsPaywallOpen(false)}
              className="absolute right-4 top-4 rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white"
            >
              ✕
            </button>

            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-950/60">
                <Crown className="h-6 w-6" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Subscription Required</span>
                <h3 className="text-xl font-bold text-white">Upgrade Your Freelance Tier</h3>
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-300 leading-relaxed">
              {paywallReason || 'This automated feature requires an active Pro or Enterprise membership.'}
            </p>

            <div className="mt-6 space-y-3">
              {/* Option 1: Pro */}
              <div
                onClick={() => setPaywallPlan('pro')}
                className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                  paywallPlan === 'pro'
                    ? 'border-indigo-500 bg-indigo-950/40 shadow-md'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold text-white">Pro Tier</span>
                    <p className="text-xs text-slate-400">Top 50 analyzed jobs + 50 credits + 1-click Auto-Bid</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-lg font-bold text-white">$19</span>
                    <span className="text-[10px] text-slate-400 block">/ mo</span>
                  </div>
                </div>
              </div>

              {/* Option 2: Enterprise */}
              <div
                onClick={() => setPaywallPlan('enterprise')}
                className={`cursor-pointer rounded-2xl border p-4 transition-all ${
                  paywallPlan === 'enterprise'
                    ? 'border-amber-500 bg-amber-950/40 shadow-md'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white">Enterprise Tier</span>
                      <span className="rounded-full bg-amber-500/20 text-amber-300 text-[9px] px-2 py-0.5 font-bold">Recommended</span>
                    </div>
                    <p className="text-xs text-slate-400">Unlimited 500 jobs + Automated Email Keyword Alerts</p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-lg font-bold text-amber-400">$49</span>
                    <span className="text-[10px] text-slate-400 block">/ mo</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setIsPaywallOpen(false)}
                className="flex-1 rounded-xl border border-slate-800 bg-slate-900 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>

              <button
                onClick={() => handleStartSubscription(paywallPlan)}
                disabled={isUpgrading}
                className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-950/50 hover:from-indigo-500 hover:to-blue-500 transition-all disabled:opacity-50"
              >
                {isUpgrading ? 'Processing...' : `Upgrade to ${paywallPlan.toUpperCase()} via Stripe`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enterprise Keyword Email Alerts Modal */}
      {isAlertsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-xl rounded-3xl border border-amber-500/40 bg-[#0f1322] p-6 shadow-2xl">
            <button
              onClick={() => setIsAlertsModalOpen(false)}
              className="absolute right-4 top-4 rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white"
            >
              ✕
            </button>

            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 shadow-lg">
                <Bell className="h-6 w-6" />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Enterprise Feature</span>
                <h3 className="text-xl font-bold text-white">Automated Keyword Email Alerts</h3>
              </div>
            </div>

            <p className="mt-2 text-xs text-slate-300">
              Get notified immediately by email when high-paying leads matching your target tech stack are scraped and scored.
            </p>

            {/* Add Alert Form */}
            <form onSubmit={handleCreateAlert} className="mt-5 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-xs font-bold text-white block">Create New Keyword Monitor</span>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Target Keyword</label>
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="e.g. React, Gemini AI, Python"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Min Budget (USD)</label>
                  <input
                    type="number"
                    value={newMinBudget}
                    onChange={(e) => setNewMinBudget(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Recipient Email</label>
                <input
                  type="email"
                  value={alertEmail}
                  onChange={(e) => setAlertEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 py-2 text-xs font-bold text-white hover:from-amber-500 hover:to-orange-500 transition-all"
              >
                + Add Active Keyword Alert
              </button>
            </form>

            {/* Active Alerts List */}
            <div className="mt-5 space-y-2 max-h-52 overflow-y-auto pr-1">
              <span className="text-xs font-bold text-slate-400 block">Active Monitors ({keywordAlerts.length})</span>
              
              {keywordAlerts.map(alert => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">"{alert.keyword}"</span>
                      <span className="text-[10px] text-emerald-400 font-mono font-semibold">&gt;=${alert.minBudget}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">{alert.email} • {alert.lastMatchedCount} matches</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestAlertSend(alert.keyword)}
                      disabled={testingAlertId === alert.keyword}
                      className="rounded-lg border border-slate-750 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-amber-300 hover:bg-slate-750 transition-all"
                      title="Send test simulation email"
                    >
                      {testingAlertId === alert.keyword ? 'Sending...' : 'Test Send'}
                    </button>

                    <button
                      onClick={() => handleDeleteAlert(alert.id)}
                      className="text-slate-500 hover:text-red-400 text-xs px-1.5 py-1"
                      title="Delete alert"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <button
                onClick={() => setIsAlertsModalOpen(false)}
                className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default PremiumLeadsRadar;
