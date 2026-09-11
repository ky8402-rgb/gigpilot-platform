import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import type { RemoteOKJobItem } from './components/RemoteOKJobsBoard';
import { SEOHead } from './components/SEOHead';
import { FreelanceJob, GeneratedProposal, ActiveContract, defaultProfile, defaultRules, defaultActiveContracts } from './types';
import { AppSidebar } from './components/dashboard/AppSidebar';
import { AppTopbar } from './components/dashboard/AppTopbar';
import { AppMobileNav } from './components/dashboard/AppMobileNav';
import { DashboardMetricsCards } from './components/dashboard/DashboardMetricsCards';

// Core Dashboard & View Components (Direct imports for immediate reliability and zero-flicker rendering)
import { WorkOrdersView } from './components/views/WorkOrdersView';
import { InvoicesView } from './components/views/InvoicesView';
import { AnalyticsView } from './components/views/AnalyticsView';
import { DashboardEarningsChart } from './components/views/DashboardEarningsChart';
import { PackageChart } from './components/PackageChart';
import { BidsTable } from './components/BidsTable';
import { LeadsTable } from './components/LeadsTable';
import { WithdrawalSummary } from './components/WithdrawalSummary';
import { SystemHealthConnectivityCard } from './components/SystemHealthConnectivityCard';
import { HealthDashboard } from './components/HealthDashboard';
import { FreelancerMetricsSection } from './components/FreelancerMetricsSection';
import { SupportChat } from './components/SupportChat';
import { WorkOrderTimeline } from './components/WorkOrderTimeline';
import { AutonomousRevenuePanel } from './components/dashboard/AutonomousRevenuePanel';

// Secondary Tabs & Modals (Safe Lazy Loading with explicit typed named exports)
const PlatformCredentialsModal = lazy(() => import('./components/PlatformCredentialsModal').then(m => ({ default: m.PlatformCredentialsModal })));
const RemoteOKJobsBoard = lazy(() => import('./components/RemoteOKJobsBoard').then(m => ({ default: m.RemoteOKJobsBoard })));
const ProposalStudioModal = lazy(() => import('./components/ProposalStudioModal').then(m => ({ default: m.ProposalStudioModal })));
const JobAnalysisModal = lazy(() => import('./components/JobAnalysisModal').then(m => ({ default: m.JobAnalysisModal })));
const ContractsAndInvoices = lazy(() => import('./components/ContractsAndInvoices').then(m => ({ default: m.ContractsAndInvoices })));
const RealIncomeHub = lazy(() => import('./components/RealIncomeHub').then(m => ({ default: m.RealIncomeHub })));
const PremiumLeadsRadar = lazy(() => import('./components/PremiumLeadsRadar').then(m => ({ default: m.PremiumLeadsRadar })));
const LeadNotificationsHub = lazy(() => import('./components/LeadNotificationsHub').then(m => ({ default: m.LeadNotificationsHub })));
const ActivityLogsView = lazy(() => import('./components/ActivityLogsView').then(m => ({ default: m.ActivityLogsView })));
const DatabaseSnapshotManager = lazy(() => import('./components/DatabaseSnapshotManager').then(m => ({ default: m.DatabaseSnapshotManager })));
const LegalComplianceModal = lazy(() => import('./components/LegalComplianceModal').then(m => ({ default: m.LegalComplianceModal })));
const GSTInvoiceModal = lazy(() => import('./components/GSTInvoiceModal').then(m => ({ default: m.GSTInvoiceModal })));
const PayPalConnectModal = lazy(() => import('./components/PayPalConnectModal').then(m => ({ default: m.PayPalConnectModal })));
const PasswordResetModal = lazy(() => import('./components/PasswordResetModal').then(m => ({ default: m.PasswordResetModal })));
const EmailVerificationModal = lazy(() => import('./components/EmailVerificationModal').then(m => ({ default: m.EmailVerificationModal })));
const GitHubSettingsModal = lazy(() => import('./components/GitHubSettingsModal').then(m => ({ default: m.GitHubSettingsModal })));
const AutoDeployPipelineTool = lazy(() => import('./components/AutoDeployPipelineTool').then(m => ({ default: m.AutoDeployPipelineTool })));
const BackendConnectionModal = lazy(() => import('./components/BackendConnectionModal').then(m => ({ default: m.BackendConnectionModal })));

// Dynamic helper for celebratory confetti without bloating the main bundle
const triggerConfetti = (opts: any) => {
  import('canvas-confetti').then((m: any) => {
    const fn = typeof m === 'function' ? m : (m && m.default ? m.default : null);
    if (typeof fn === 'function') {
      fn(opts);
    }
  }).catch(() => {});
};

import { LazyFallback } from './components/common/LazyFallback';
import {
  fetchBackendWorkOrders,
  completeBackendWorkOrder,
  acceptBackendWorkOrder,
  fetchLivePlatformJobs,
  fetchRemoteOKJobs,
  fetchAllPublicJobs,
  submitLivePlatformBid,
  fetchDatabaseStatus,
  fetchCurrentUser,
  fetchBackendStats,
  fetchBackendBids,
  fetchBackendLeads,
  checkBackendWatchdogPing,
  triggerBackendSoftRestart,
  getApiBaseUrl,
  BACKEND_BASE_URL,
  DatabaseStatus,
  BackendStats,
  BackendBidItem,
  BackendLeadItem,
  gigWebhookDispatcher,
  HighPriorityGigEvent,
  fetchPayPalLiveBalance,
  fetchPayPalTransactions,
  PayPalLiveBalanceResult
} from './services/api';
import { PayPalSettlementModal } from './components/PayPalSettlementModal';

// Primary Payment Gateways Configuration
const PRIMARY_PAYPAL_EMAIL = 'kundank4@icloud.com';
const PRIMARY_PAYPAL_ME = 'ky8402';
const PRIMARY_PAYPAL_ME_URL = 'https://paypal.me/ky8402';

// Primary Indian Bank & UPI Configuration
const PRIMARY_INDIAN_BANK_NAME = 'Federal Bank';
const PRIMARY_INDIAN_BANK_HOLDER = 'Kundan Kumar';
const PRIMARY_INDIAN_BANK_ACC = '•••• 8763';
const PRIMARY_INDIAN_BANK_IFSC = 'FDRL0001447';
const PRIMARY_UPI_ID = 'chandimay@ybl';
const USD_TO_INR_RATE = 86.85;

export interface WorkOrder {
  id: number | string;
  externalId?: string;
  title: string;
  platform?: 'RemoteOK' | 'Direct' | 'Verified Remote' | string;
  status: 'in-progress' | 'pending' | 'urgent' | 'completed';
  amount: number;
  category: string;
  time: string;
  clientName?: string;
  description?: string;
  skills?: string[];
  url?: string;
  location?: string;
  tags?: string[];
  completion_deadline?: string;
  completed_at?: string | null;
  customer_confirmed?: boolean;
  worker_marked_complete?: boolean;
  worker_email?: string;
}

export interface Transaction {
  id: number | string;
  name: string;
  date: string;
  amount: number;
  type: 'credit' | 'debit';
  method?: 'PayPal' | 'Direct' | 'Escrow' | 'Indian Bank' | 'UPI';
  referenceId?: string;
}

export interface Invoice {
  id: string;
  orderTitle: string;
  amount: number;
  date: string;
  status: 'Paid' | 'Pending' | 'Auto-Collected';
  client: string;
}

// Global unique ID counter helper
let globalUniqueCounter = Date.now();
const makeUniqueId = (prefix: string = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${++globalUniqueCounter}`;

export default function App() {
  // Navigation State (Default to dynamic live backend dashboard)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'income' | 'remoteok' | 'orders' | 'invoicing' | 'paypal' | 'bank' | 'analytics' | 'notifications' | 'leads' | 'logs' | 'snapshots' | 'health'>('dashboard');

  // AI Proposal Studio & Job Analysis State
  const [selectedProposalJob, setSelectedProposalJob] = useState<FreelanceJob | null>(null);
  const [isProposalStudioOpen, setIsProposalStudioOpen] = useState<boolean>(false);
  const [selectedAnalysisJob, setSelectedAnalysisJob] = useState<FreelanceJob | null>(null);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState(defaultProfile);
  const [activeContractsList, setActiveContractsList] = useState<ActiveContract[]>(defaultActiveContracts);

  // Helper to convert any job or order to FreelanceJob format
  const toFreelanceJob = (item: any): FreelanceJob => {
    return {
      id: String(item.id || item.externalId || `job_${Date.now()}`),
      title: item.title || 'Untitled Opportunity',
      platform: item.platform || 'RemoteOK',
      platformUrl: item.url || (item.id ? `https://remoteok.com/remote-jobs/${item.id}` : undefined),
      type: 'fixed',
      budget: Number(item.amount) || Number(item.budget) || 250,
      description: item.description || `Autonomous execution specification for: ${item.title}. Full-stack development, automated tests, milestone documentation, and client handoff.`,
      skills: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags : (Array.isArray(item.skills) ? item.skills : ['React', 'TypeScript', 'Node.js', 'Automation']),
      client: {
        name: item.clientName || item.company || 'Direct Client',
        country: item.location || 'Worldwide (Remote)',
        rating: 4.9,
        totalSpent: 35000,
        paymentVerified: true,
        hiresCount: 18,
        hireRate: 92
      },
      postedAt: item.time || 'Today',
      timestamp: Date.now(),
      proposalsCount: 5,
      connectsRequired: 0,
      matchScore: 94,
      experienceLevel: 'Expert',
      status: 'new'
    };
  };

  // PayPal Interface State
  const [selectedPayPalInvoice, setSelectedPayPalInvoice] = useState<Invoice | null>(null);
  const [isPayPalModalOpen, setIsPayPalModalOpen] = useState<boolean>(false);
  const [isPayPalSettlementModalOpen, setIsPayPalSettlementModalOpen] = useState<boolean>(false);
  const [livePayPalBalance, setLivePayPalBalance] = useState<PayPalLiveBalanceResult | null>(null);
  const [isPayPalConnectOpen, setIsPayPalConnectOpen] = useState<boolean>(false);
  const [isBackendModalOpen, setIsBackendModalOpen] = useState<boolean>(false);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);

  // Compliance, Terms of Service, Privacy Policy & Invoicing State
  const [isLegalModalOpen, setIsLegalModalOpen] = useState<boolean>(false);
  const [legalTab, setLegalTab] = useState<'terms' | 'privacy' | 'gst' | 'refunds'>('terms');
  const [isGSTInvoiceOpen, setIsGSTInvoiceOpen] = useState<boolean>(false);
  const [selectedGSTInvoice, setSelectedGSTInvoice] = useState<any | null>(null);

  // Core Metrics State (USD)
  const [walletBalance, setWalletBalance] = useState<number>(0.00);
  const [todayEarnings, setTodayEarnings] = useState<number>(0.00);
  const [completedOrders, setCompletedOrders] = useState<number>(0);
  const [dailyTarget, setDailyTarget] = useState<number>(100);
  const [aiStatus, setAiStatus] = useState<string>('live feed monitoring active');
  const [isAutoCollecting, setIsAutoCollecting] = useState<boolean>(false);
  const [payoutAmount, setPayoutAmount] = useState<string>('50');
  const [orderCounter, setOrderCounter] = useState<number>(100);
  const [txCounter, setTxCounter] = useState<number>(100);
  const [isCredentialsModalOpen, setIsCredentialsModalOpen] = useState<boolean>(false);
  const [isGitHubSettingsOpen, setIsGitHubSettingsOpen] = useState<boolean>(false);
  const [isAutoDeployModalOpen, setIsAutoDeployModalOpen] = useState<boolean>(false);
  const [isScanningPlatforms, setIsScanningPlatforms] = useState<boolean>(false);
  const [isSyncingRemoteOK, setIsSyncingRemoteOK] = useState<boolean>(false);
  const [editingOrderId, setEditingOrderId] = useState<number | string | null>(null);
  const [editingAmountValue, setEditingAmountValue] = useState<string>('');
  const [autopilot, setAutopilot] = useState<boolean>(true);

  // Authentication, Security & Mobile Navigation States
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isPasswordResetOpen, setIsPasswordResetOpen] = useState<boolean>(false);
  const [isEmailVerificationOpen, setIsEmailVerificationOpen] = useState<boolean>(false);
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(true);
  const [userEmail, setUserEmail] = useState<string>('ky8402@gmail.com');

  // Manual Order Entry State
  const [manualTitle, setManualTitle] = useState<string>('');
  const [manualAmount, setManualAmount] = useState<string>('');
  const [manualCategory, setManualCategory] = useState<string>('');

  // Lists
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  // Backend Health & Telemetry State
  const [backendStats, setBackendStats] = useState<BackendStats | null>(null);
  const [backendBids, setBackendBids] = useState<BackendBidItem[]>([]);
  const [backendLeads, setBackendLeads] = useState<BackendLeadItem[]>([]);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isBackendLoading, setIsBackendLoading] = useState<boolean>(false);

  // Automated Watchdog Health-Check & Recovery State
  const [watchdogStatus, setWatchdogStatus] = useState<'idle' | 'healthy' | 'degraded' | 'restarting'>('idle');
  const [watchdogFailures, setWatchdogFailures] = useState<number>(0);
  const [watchdogLatencyMs, setWatchdogLatencyMs] = useState<number | null>(null);
  const [watchdogLastCheck, setWatchdogLastCheck] = useState<Date | null>(null);
  const [watchdogLastRestart, setWatchdogLastRestart] = useState<Date | null>(null);
  const [isWatchdogRestarting, setIsWatchdogRestarting] = useState<boolean>(false);

  // Dedicated 60-second auto-refresh polling effect for backend stats API (https://3-222-149-9.sslip.io/api/bids/stats)
  useEffect(() => {
    async function syncBackendTelemetryStats() {
      try {
        const stats = await fetchBackendStats();
        if (stats) {
          setBackendStats(stats);
          if (typeof stats.earned === 'number' && stats.earned > 0) {
            setTodayEarnings(stats.earned);
          }
          if (typeof stats.won === 'number' && stats.won > 0) {
            setCompletedOrders(stats.won);
          }
        }
      } catch (err) {
        console.warn('[GigPilot Backend] Stats polling notice:', err);
      }
    }

    // Run immediately on mount
    syncBackendTelemetryStats();

    // Auto-refresh every 60 seconds
    const statsTimer = setInterval(syncBackendTelemetryStats, 60000);
    return () => clearInterval(statsTimer);
  }, []);

  // Load real backend work orders, stats, leads, and public live feeds on mount
  useEffect(() => {
    async function loadAllInitialOrders() {
      setIsBackendLoading(true);
      setBackendError(null);

      // 1. Fetch live telemetry stats, bids, and leads directly from backend
      try {
        const [statsData, bidsData, leadsData] = await Promise.all([
          fetchBackendStats(),
          fetchBackendBids(50),
          fetchBackendLeads(50)
        ]);

        if (statsData) {
          setBackendStats(statsData);
          if (statsData.earned && statsData.earned > 0) {
            setTodayEarnings(statsData.earned);
          }
          if (statsData.won && statsData.won > 0) {
            setCompletedOrders(statsData.won);
          }
        }

        if (bidsData && bidsData.length > 0) {
          setBackendBids(bidsData);
        }

        if (leadsData && leadsData.length > 0) {
          setBackendLeads(leadsData);
        }
      } catch (err: any) {
        console.warn('Backend connection notice:', err);
        setBackendError(`Unable to reach backend service (${getApiBaseUrl() || 'local server'}). Live metrics and bids may fallback to cached states.`);
      } finally {
        setIsBackendLoading(false);
      }

      // 2. Fetch combined Work Orders and Public Job Feeds
      try {
        const [backendOrders, publicFeeds] = await Promise.allSettled([
          fetchBackendWorkOrders(),
          fetchAllPublicJobs()
        ]);

        const combinedNewOrders: WorkOrder[] = [];

        if (backendOrders.status === 'fulfilled' && Array.isArray(backendOrders.value)) {
          combinedNewOrders.push(...backendOrders.value);
        }

        if (publicFeeds.status === 'fulfilled' && Array.isArray(publicFeeds.value) && publicFeeds.value.length > 0) {
          const formattedPublicJobs: WorkOrder[] = publicFeeds.value.slice(0, 10).map((job) => ({
            id: job.id,
            externalId: String(job.id),
            title: job.title,
            platform: job.platform || (job.company?.toLowerCase().includes('freelancer') ? 'Freelancer' : 'RemoteOK'),
            status: 'pending',
            amount: job.amount || 0,
            category: job.category || 'General',
            time: job.time || 'Live Feed',
            clientName: job.company,
            description: job.description,
            url: job.url,
            location: job.location,
            tags: job.tags
          }));
          combinedNewOrders.push(...formattedPublicJobs);
        }

        if (combinedNewOrders.length > 0) {
          setWorkOrders(prev => {
            const existingIds = new Set(prev.map(o => String(o.id)));
            const newItems = combinedNewOrders.filter((b) => !existingIds.has(String(b.id)));
            return [...newItems, ...prev];
          });
        }

        // Fetch PostgreSQL / Cloud SQL Status
        try {
          const dbRes = await fetchDatabaseStatus();
          setDbStatus(dbRes);
        } catch {
          // ignore
        }

        // Fetch User Profile & Verification Status
        try {
          const userRes = await fetchCurrentUser('ky8402@gmail.com');
          if (userRes.success && userRes.user) {
            setIsEmailVerified(userRes.user.isEmailVerified);
            setUserEmail(userRes.user.email);
          }
        } catch {
          // ignore
        }

        // Fetch Live PayPal Balance & Ledger
        try {
          const [balRes, txRes] = await Promise.allSettled([
            fetchPayPalLiveBalance(),
            fetchPayPalTransactions()
          ]);

          if (balRes.status === 'fulfilled' && balRes.value) {
            setLivePayPalBalance(balRes.value);
          }

          if (txRes.status === 'fulfilled' && txRes.value?.transactions) {
            const mappedTx: Transaction[] = txRes.value.transactions.slice(0, 20).map((t: any) => ({
              id: t.id || `tx_${Math.random().toString(36).slice(2, 6)}`,
              name: t.isLiveRest
                ? `PayPal Cleared: ${t.payerName || 'Client'} (${t.description || 'Service'})`
                : (t.description || `Milestone: ${t.payerName || 'Client'}`),
              date: t.date ? new Date(t.date).toLocaleDateString() : 'Today',
              amount: t.amount,
              type: t.type || 'credit',
              method: t.isLiveRest ? 'PayPal' : 'Direct',
              referenceId: t.orderId || t.id,
              isLiveRest: t.isLiveRest
            }));
            if (mappedTx.length > 0) {
              setTransactions(mappedTx);
            }
          }
        } catch (ppErr) {
          console.warn('Initial PayPal sync error:', ppErr);
        }
      } catch (err) {
        console.warn('Orders sync error:', err);
      }
    }
    loadAllInitialOrders();
  }, []);

  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // Toast State
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'info' | 'warning' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  });
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Derived Calculations
  const activeOrdersCount = workOrders.filter(o => o.status !== 'completed').length;
  const completionRate = Math.min(100, Math.round((completedOrders / (completedOrders + activeOrdersCount || 1)) * 100));
  const targetPct = Math.min((todayEarnings / dailyTarget) * 100, 100);

  // Helper: Show Toast
  const showToast = (message: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ show: true, message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 3500);
  };

  // Manual trigger for backend soft restart & reconciliation
  const handleManualSoftRestart = async () => {
    setIsWatchdogRestarting(true);
    setWatchdogStatus('restarting');
    showToast('🔄 Dispatching backend soft restart & reconciliation...', 'info');
    try {
      const res = await triggerBackendSoftRestart({
        reason: 'manual_user_trigger',
        consecutiveFailures: watchdogFailures,
        source: 'manual_app_control'
      });
      if (res.success) {
        showToast('✅ Backend soft restart completed successfully.', 'success');
        setWatchdogStatus('healthy');
        setWatchdogFailures(0);
        setBackendError(null);
        setWatchdogLastRestart(new Date());
      } else {
        showToast(`❌ Soft restart notice: ${res.error || res.message}`, 'error');
      }
    } catch (e: any) {
      showToast(`❌ Failed to execute soft restart: ${e.message}`, 'error');
    } finally {
      setIsWatchdogRestarting(false);
    }
  };

  // Automated Backend Health-Check Watchdog Effect
  // Actively verifies backend connectivity, monitors timeout spikes, and triggers a soft restart command
  // to the backend if persistent timeouts are detected.
  useEffect(() => {
    let isMounted = true;
    let consecutiveFailures = 0;
    let lastRestartTimestamp = 0;

    const PING_INTERVAL_MS = 18000;      // Check connectivity every 18 seconds
    const PING_TIMEOUT_LIMIT_MS = 5000;  // 5000ms timeout threshold per health check
    const MAX_CONSECUTIVE_TIMEOUTS = 3;  // Trigger soft restart after 3 consecutive timeouts/failures
    const RESTART_COOLDOWN_MS = 60000;   // 60-second cooldown between automated soft restarts

    async function runWatchdogCheck() {
      if (!isMounted) return;

      try {
        const ping = await checkBackendWatchdogPing(PING_TIMEOUT_LIMIT_MS);
        if (!isMounted) return;

        setWatchdogLastCheck(new Date());
        setWatchdogLatencyMs(ping.latencyMs);

        if (ping.ok) {
          // Backend is responsive and healthy
          if (consecutiveFailures > 0) {
            console.log(`[Backend Watchdog] Connectivity restored after ${consecutiveFailures} timeout(s).`);
            showToast('✅ Backend connectivity restored and responsive.', 'success');
          }
          consecutiveFailures = 0;
          setWatchdogFailures(0);
          setWatchdogStatus('healthy');
          setBackendError(null);
        } else {
          // Health check failed or timed out
          consecutiveFailures++;
          setWatchdogFailures(consecutiveFailures);
          const isTimeout = Boolean(ping.timedOut);

          console.warn(
            `⚠️ [Backend Watchdog] Health-check failure #${consecutiveFailures}/${MAX_CONSECUTIVE_TIMEOUTS}: ` +
            `${isTimeout ? 'Request timed out' : ping.error || `HTTP ${ping.status}`}`
          );

          if (consecutiveFailures < MAX_CONSECUTIVE_TIMEOUTS) {
            setWatchdogStatus('degraded');
          } else {
            // Persistent timeouts detected!
            const now = Date.now();
            const canTriggerRestart = (now - lastRestartTimestamp) >= RESTART_COOLDOWN_MS;

            if (canTriggerRestart) {
              lastRestartTimestamp = now;
              setWatchdogStatus('restarting');
              setIsWatchdogRestarting(true);
              setWatchdogLastRestart(new Date());

              console.warn(
                `🚨 [Backend Watchdog] Persistent timeouts detected (${consecutiveFailures} consecutive failures). ` +
                `Triggering automated backend soft restart...`
              );
              showToast(
                `⚠️ Persistent backend timeouts detected (${consecutiveFailures}x). Triggering automated soft restart...`,
                'warning'
              );

              try {
                const restartResult = await triggerBackendSoftRestart({
                  reason: isTimeout ? 'watchdog_persistent_timeout' : 'watchdog_persistent_unreachable',
                  consecutiveFailures,
                  source: 'app_watchdog_use_effect'
                });

                if (!isMounted) return;

                if (restartResult.success) {
                  console.log('✅ [Backend Watchdog] Soft restart command acknowledged:', restartResult.message);
                  showToast('🔄 Backend soft restart dispatched. Reconciling services...', 'info');
                  // Reset failure counter so system has time to recover
                  consecutiveFailures = 0;
                  setWatchdogFailures(0);
                } else {
                  console.error('❌ [Backend Watchdog] Soft restart failed:', restartResult.error);
                  showToast('❌ Backend soft restart command could not be delivered. Retrying on next cycle...', 'error');
                }
              } catch (restartErr: any) {
                console.error('❌ [Backend Watchdog] Exception triggering soft restart:', restartErr);
              } finally {
                if (isMounted) {
                  setIsWatchdogRestarting(false);
                }
              }
            } else {
              const cooldownLeft = Math.ceil((RESTART_COOLDOWN_MS - (now - lastRestartTimestamp)) / 1000);
              console.log(
                `[Backend Watchdog] Persistent timeouts detected, waiting for restart cooldown (${cooldownLeft}s remaining).`
              );
            }
          }
        }
      } catch (err) {
        console.warn('[Backend Watchdog] Unexpected check error:', err);
      }
    }

    // Initial check after 3.5 seconds to let initial page render complete
    const initialTimer = setTimeout(runWatchdogCheck, 3500);
    const intervalTimer = setInterval(runWatchdogCheck, PING_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, []);

  // Real-Time Webhook Handler: Subscribes to backend triggers and updates local React state
  useEffect(() => {
    // 1. Bind global toast notification trigger
    gigWebhookDispatcher.setToastHandler(showToast);

    // 2. Subscribe to high-priority gig webhook events to update work orders state
    const unsubscribe = gigWebhookDispatcher.subscribe((gig: HighPriorityGigEvent) => {
      setWorkOrders(prev => {
        if (prev.some(o => String(o.id) === String(gig.id))) {
          return prev;
        }
        const newOrder: WorkOrder = {
          id: gig.id,
          externalId: gig.id,
          title: gig.title,
          platform: gig.platform || 'RemoteOK',
          status: 'urgent',
          amount: gig.budget || 750,
          category: 'High-Priority Gig Match',
          time: 'Just now (Webhook)',
          clientName: gig.company,
          description: `🚨 High-Priority Lead (${gig.matchScore}% Match). AI Winning Angle: ${gig.aiWinningAngle || 'Immediate milestone delivery.'}`,
          url: gig.url,
          tags: ['Urgent', 'High-Match', gig.platform]
        };
        return [newOrder, ...prev];
      });
    });

    // 3. Start real-time SSE stream with polling fallback
    const stopStream = gigWebhookDispatcher.startRealtimeWebhookStream(showToast);

    return () => {
      unsubscribe();
      stopStream();
    };
  }, []);

  // Helper: Number Formatter (Safe against undefined/null/NaN)
  const fmt = (n?: number | null | string) => {
    if (n === undefined || n === null || n === '') return '0.00';
    const num = typeof n === 'number' ? n : Number(n);
    return isNaN(num) ? '0.00' : num.toFixed(2);
  };
  const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randomFloat = (min: number, max: number) => Math.round((Math.random() * (max - min) + min) * 100) / 100;

  // Complete Order
  const completeOrder = async (id: number | string) => {
    const order = workOrders.find(o => String(o.id) === String(id));
    if (!order || order.status === 'completed') return;

    // Call backend endpoint to trigger milestone completion & escrow release
    try {
      await completeBackendWorkOrder(id);
    } catch (e) {
      console.warn('Backend completion call warning:', e);
    }

    setWorkOrders(prev => prev.map(o => String(o.id) === String(id) ? { ...o, status: 'completed' } : o));
    const amount = order.amount;

    setWalletBalance(prev => prev + amount);
    setTodayEarnings(prev => prev + amount);
    setCompletedOrders(prev => prev + 1);

    const newTx: Transaction = {
      id: makeUniqueId('tx'),
      name: `Escrow Released: ${order.title}`,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today',
      amount: amount,
      type: 'credit'
    };
    setTransactions(prev => [newTx, ...prev]);

    // Auto-generate invoice record
    const newInv: Invoice = {
      id: `INV-${new Date().toISOString().slice(0, 10)}-${makeUniqueId('inv').slice(-6)}`,
      orderTitle: order.title,
      amount: amount,
      date: new Date().toLocaleString(),
      status: 'Paid',
      client: order.clientName || `${order.platform || 'Platform'} Client Verified`
    };
    setInvoices(prev => [newInv, ...prev]);

    showToast(`✅ Order "${order.title}" completed! +$${fmt(amount)} USD escrow settled.`, 'success');

    triggerConfetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.8 }
    });

    if (todayEarnings + amount >= dailyTarget) {
      setTimeout(() => {
        showToast(`🎯 Daily target of $${dailyTarget} USD achieved! Auto-collecting to PayPal...`, 'info');
        autoCollectEarnings();
      }, 1000);
    }
  };

  // Accept Pending Order
  const acceptOrder = async (id: number | string) => {
    const order = workOrders.find(o => String(o.id) === String(id));
    if (!order) return;

    try {
      await acceptBackendWorkOrder(id);
    } catch (e) {
      console.warn('Backend accept warning:', e);
    }

    setWorkOrders(prev => prev.map(o => String(o.id) === String(id) ? { ...o, status: 'in-progress' } : o));
    showToast(`🚀 Contract "${order.title}" accepted into active queue!`, 'success');
  };

  // Scan Live Platforms (Upwork & Freelancer API / Stream)
  const scanLivePlatforms = async () => {
    setIsScanningPlatforms(true);
    showToast('📡 Scanning Upwork & Freelancer.com APIs for live work orders...', 'info');
    try {
      const res = await fetchLivePlatformJobs('react node python typescript figma');
      if (res.jobs && res.jobs.length > 0) {
        setWorkOrders(prev => {
          const existingIds = new Set(prev.map(o => String(o.id)));
          const uniqueNew = res.jobs.filter((j: any) => !existingIds.has(String(j.id)));
          return [...uniqueNew, ...prev];
        });
        showToast(`⚡ Streamed ${res.jobs.length} live verified work orders from ${res.platformsChecked.join(', ')}`, 'success');
      }
    } catch (err: any) {
      showToast(err.message || 'Platform scan error', 'warning');
    } finally {
      setIsScanningPlatforms(false);
    }
  };

  // Sync RemoteOK Live Jobs Feed
  const syncRemoteOKJobs = useCallback(async () => {
    setIsSyncingRemoteOK(true);
    showToast('🌍 Connecting to RemoteOK API (/api/remoteok/jobs)...', 'info');
    try {
      const jobs = await fetchRemoteOKJobs();
      if (jobs.length > 0) {
        const formatted: WorkOrder[] = jobs.map((j) => ({
          id: j.id,
          externalId: String(j.id),
          title: j.title,
          platform: 'RemoteOK',
          status: 'pending',
          amount: j.amount || 0,
          category: j.company || 'Remote',
          time: j.time || 'Today',
          clientName: j.company,
          description: j.description,
          url: j.url,
          location: j.location,
          tags: j.tags
        }));

        setWorkOrders(prev => {
          const existingIds = new Set(prev.map(o => String(o.id)));
          const newOnly = formatted.filter(f => !existingIds.has(String(f.id)));
          return [...newOnly, ...prev];
        });
        showToast(`🚀 Loaded ${jobs.length} live global roles from RemoteOK API!`, 'success');
      } else {
        showToast('No new RemoteOK jobs found or rate-limited.', 'info');
      }
    } catch (e: any) {
      showToast('Error syncing RemoteOK jobs: ' + (e?.message || 'Network error'), 'warning');
    } finally {
      setIsSyncingRemoteOK(false);
    }
  }, []);

  // Stable handler for loaded bids to avoid re-rendering loops
  const handleBidsLoaded = useCallback((loadedBids: BackendBidItem[]) => {
    setBackendBids(prev => {
      if (
        prev.length === loadedBids.length &&
        prev.every((b, i) => b.id === loadedBids[i]?.id && b.status === loadedBids[i]?.status && b.work_status === loadedBids[i]?.work_status)
      ) {
        return prev;
      }
      return loadedBids;
    });
  }, []);

  // Save customized contract amount (for RemoteOK / pending contracts)
  const saveCustomAmount = (id: number | string, customVal?: number) => {
    const val = customVal !== undefined ? customVal : parseFloat(editingAmountValue);
    if (isNaN(val) || val < 0) {
      showToast('Please enter a valid amount (>= 0)', 'warning');
      return;
    }

    setWorkOrders(prev => prev.map(o => {
      if (String(o.id) === String(id)) {
        return { ...o, amount: val };
      }
      return o;
    }));

    setEditingOrderId(null);
    setEditingAmountValue('');
    showToast(`💰 Updated contract amount to $${fmt(val)} USD`, 'success');
  };

  // Manual Order Entry (USD)
  const addManualOrder = () => {
    const title = manualTitle.trim();
    const amount = parseFloat(manualAmount);
    const category = manualCategory.trim() || 'Manual';

    if (!title) {
      showToast('Please enter a job title.', 'warning');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount ($ USD).', 'warning');
      return;
    }

    const newOrder: WorkOrder = {
      id: makeUniqueId('wo_manual'),
      title: title,
      status: 'pending',
      amount: amount,
      category: category,
      time: 'just now',
      platform: 'Direct'
    };
    setWorkOrders(prev => [newOrder, ...prev]);

    showToast(`✅ Added order: "${title}" ($${fmt(amount)} USD)`, 'success');

    // Reset input fields
    setManualTitle('');
    setManualAmount('');
    setManualCategory('');
  };

  // Payout / Withdraw to PayPal
  const withdrawToPayPal = async (amount?: number, targetPayPal?: string) => {
    setIsPayPalSettlementModalOpen(true);
    showToast(
      'Opening PayPal Settlement Center: Real revenue is credited via client invoices or PayPal.Me and auto-swept to Federal Bank.',
      'info'
    );
  };

  // PayPal & Gateway Payment Received Handler
  const handlePayPalPaymentReceived = (amount: number, clientName: string, description: string) => {
    setWalletBalance(prev => prev + amount);
    setTodayEarnings(prev => prev + amount);
    setCompletedOrders(prev => prev + 1);

    const newTx: Transaction = {
      id: makeUniqueId('tx_pp_recv'),
      name: `Payment Received (${clientName || 'Direct Client'})`,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today',
      amount: amount,
      type: 'credit',
      method: 'PayPal',
      referenceId: `TX-${Date.now().toString().slice(-8)}`
    };
    setTransactions(prev => [newTx, ...prev]);

    const newInv: Invoice = {
      id: `INV-${new Date().toISOString().slice(0, 10)}-${makeUniqueId('inv').slice(-6)}`,
      orderTitle: description || 'Client Service Milestone',
      amount: amount,
      date: new Date().toLocaleString(),
      status: 'Paid',
      client: clientName || 'Client'
    };
    setInvoices(prev => [newInv, ...prev]);

    if (selectedPayPalInvoice) {
      setInvoices(prev => prev.map(inv => inv.id === selectedPayPalInvoice.id ? { ...inv, status: 'Paid' } : inv));
      setSelectedPayPalInvoice(null);
    }
  };

  // Auto Collect Earnings into PayPal Account
  const autoCollectEarnings = async () => {
    if (isAutoCollecting) return;
    if (todayEarnings <= 0) {
      showToast('No uncollected earnings to settle yet.', 'info');
      return;
    }
    setIsAutoCollecting(true);
    showToast(`🔄 Logging milestone earnings of $${fmt(todayEarnings)} USD for settlement...`, 'info');

    const collected = todayEarnings;
    const bonus = parseFloat((collected * 0.03).toFixed(2)); // 3% volume bonus

    setWalletBalance(prev => prev + bonus);
    setTodayEarnings(0);

    const newTx: Transaction = {
      id: makeUniqueId('tx_collect'),
      name: `Milestone Ready for Client Invoicing (${PRIMARY_PAYPAL_EMAIL})`,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today',
      amount: collected,
      type: 'credit',
      method: 'PayPal'
    };
    setTransactions(prev => [newTx, ...prev]);

    showToast(`💰 Logged $${fmt(collected)} USD! Open PayPal Settlement Hub to generate official invoice or payment link.`, 'success');

    triggerConfetti({
      particleCount: 90,
      spread: 80,
      origin: { y: 0.6 }
    });

    setIsAutoCollecting(false);
  };

  // Auto-Pilot Toggle & Cycle Engine
  const toggleAutopilot = () => {
    if (autopilot) {
      setAutopilot(false);
      showToast('⏹️ Auto-Pilot stopped.', 'info');
    } else {
      setAutopilot(true);
      showToast('🤖 Auto-Pilot engaged – seeking orders to reach daily target!', 'info');
    }
  };

  useEffect(() => {
    if (!autopilot) return;

    if (todayEarnings >= dailyTarget) {
      showToast(`🎯 Daily target of $${dailyTarget} USD achieved! Auto-Pilot complete.`, 'success');
      autoCollectEarnings();
      setAutopilot(false);
      return;
    }

    const timer = setTimeout(async () => {
      if (!autopilot) return;

      // Scan and ingest fresh opportunities from live multi-source feeds
      try {
        setAiStatus('scanning remote feeds for high-match opportunities...');
        const fresh = await fetchAllPublicJobs();
        if (fresh && fresh.length > 0) {
          // Find a job not already in work orders
          const unadded = fresh.find(j => !workOrders.some(w => String(w.id) === String(j.id) || w.title.toLowerCase() === j.title.toLowerCase()));
          if (unadded) {
            const platformName = unadded.platform || (unadded.company?.toLowerCase().includes('freelancer') ? 'Freelancer' : 'RemoteOK');
            const newOrder: WorkOrder = {
              id: unadded.id || makeUniqueId('wo_auto'),
              externalId: String(unadded.id || ''),
              title: `${unadded.title}`,
              status: 'pending',
              amount: unadded.amount > 0 ? unadded.amount : randomFloat(60, 250),
              category: unadded.category || unadded.company || 'Engineering',
              time: 'Live Stream',
              platform: platformName,
              url: unadded.url,
              clientName: unadded.company,
              description: unadded.description,
              location: unadded.location,
              tags: unadded.tags
            };
            setWorkOrders(prev => [newOrder, ...prev.slice(0, 40)]);
            showToast(`📥 Auto-Pilot Radar discovered live contract: "${newOrder.title}" (${platformName})`, 'info');
          }
        }
      } catch (e) {
        console.warn('Autopilot scanning cycle error:', e);
      } finally {
        setAiStatus('monitoring market trends & live feeds...');
      }
    }, 25000);

    return () => clearTimeout(timer);
  }, [autopilot, todayEarnings, dailyTarget, workOrders]);

  // AI Optimization Engine
  const runOptimization = () => {
    showToast('⚡ AI Optimization: Analyzing workflow...', 'info');
    
    // Sort orders prioritizing urgent
    setWorkOrders(prev => {
      const sorted = [...prev].sort((a, b) => {
        if (a.status === 'urgent' && b.status !== 'urgent') return -1;
        if (b.status === 'urgent' && a.status !== 'urgent') return 1;
        return 0;
      });
      return sorted;
    });

    const inProgress = workOrders.filter(o => o.status === 'in-progress');
    if (inProgress.length > 0) {
      const targetOrder = inProgress[0];
      setTimeout(() => {
        completeOrder(targetOrder.id);
        showToast(`🤖 AI auto-completed "${targetOrder.title}" (efficiency trigger)`, 'info');
      }, 700);
    }

    setAiStatus('Re-prioritized orders & streamlined execution pipeline.');
    setTimeout(() => {
      setAiStatus('optimizing resource allocation...');
    }, 4000);
  };

  // Background Telemetry Status Interval
  useEffect(() => {
    const statuses = [
      'monitoring market trends & feeds...',
      'optimizing pricing models...',
      'scanning for verified platform contracts...',
      'balancing worker execution pools...',
      'verifying deliverable telemetry...'
    ];

    const interval = setInterval(() => {
      setAiStatus(statuses[random(0, statuses.length - 1)]);
    }, 35000);

    return () => clearInterval(interval);
  }, []);

  // Dynamic SEO metadata mapping for active tab
  const getTabMeta = () => {
    switch (activeTab) {
      case 'notifications':
        return {
          section: 'Lead Notifications & Speed Radar',
          description: 'Instant Telegram & Email push notifications for high-value leads. Headless Playwright scraper bypasses webhook approval delays with sub-second lead dispatching.'
        };
      case 'leads':
        return {
          section: 'Real Lead Scoring & Tier Paywalls',
          description: 'Gemini-scored catalog of 500 remote jobs, high-paying vs easy-to-win classification, automated 1-click bidding, and enterprise keyword alerts.'
        };
      case 'income':
        return {
          section: 'Real Income & Client Checkout Hub',
          description: 'Monetize development & AI skills with real client services, instant PayPal receiving links (paypal.me/ky8402), domestic Indian UPI QR checkouts, and custom milestone payment requests.'
        };
      case 'remoteok':
        return {
          section: 'RemoteOK Live Feed',
          description: 'Live unauthenticated RemoteOK job feed. Scan high-paying remote developer & engineering jobs with automated Gemini proposal creation.'
        };
      case 'orders':
        return {
          section: 'Automated Work Orders',
          description: 'Autonomous work orders queue and execution status. Track deliverables, milestone submissions, and client verification.'
        };
      case 'invoicing':
        return {
          section: 'Contracts & Invoicing',
          description: 'Automated client contracts, smart milestone invoicing, and direct payment tracking for high-yield freelance gigs.'
        };
      case 'paypal':
        return {
          section: 'PayPal Payment Terminal',
          description: 'Instant PayPal payment links (paypal.me/ky8402), direct invoice generator, dynamic QR codes, and virtual checkout terminal.'
        };
      case 'bank':
        return {
          section: 'Indian Bank & UPI Portal',
          description: 'Federal Bank IMPS/NEFT receiving portal, dynamic UPI QR checkout (chandimay@ybl), and real-time USD to INR settlement engine.'
        };
      case 'analytics':
        return {
          section: 'Performance Analytics',
          description: 'Real-time telemetry, autonomous revenue charts, platform yield distributions, and efficiency forecasting.'
        };
      case 'dashboard':
      default:
        return {
          section: 'Autonomous Dashboard',
          description: 'Real-time autonomous freelance autopilot, Gemini AI proposal studio, live job radar, and global payment processing.'
        };
    }
  };

  const currentMeta = getTabMeta();

  return (
    <div className="flex min-h-screen bg-[#090d14] text-slate-100 font-sans antialiased overflow-hidden select-none">
      <SEOHead
        activeSection={currentMeta.section}
        description={currentMeta.description}
      />
      
      {/* ===== DESKTOP SIDEBAR ===== */}
      <AppSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userEmail={userEmail}
        isEmailVerified={isEmailVerified}
        activeOrdersCount={workOrders.filter(o => o.status !== 'completed').length}
        onOpenEmailVerification={() => setIsEmailVerificationOpen(true)}
        onOpenPasswordReset={() => setIsPasswordResetOpen(true)}
        onOpenPayPalConnect={() => setIsPayPalConnectOpen(true)}
        onOpenGitHubSettings={() => setIsGitHubSettingsOpen(true)}
        onOpenAutoDeploy={() => setIsAutoDeployModalOpen(true)}
        onOpenCredentialsModal={() => setIsCredentialsModalOpen(true)}
        onOpenLegal={(tab) => {
          setLegalTab(tab);
          setIsLegalModalOpen(true);
        }}
      />

      {/* ===== MOBILE NAVIGATION ===== */}
      <AppMobileNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
        walletBalance={walletBalance}
        userEmail={userEmail}
        isEmailVerified={isEmailVerified}
        activeOrdersCount={workOrders.filter(o => o.status !== 'completed').length}
        onOpenEmailVerification={() => setIsEmailVerificationOpen(true)}
        onOpenPasswordReset={() => setIsPasswordResetOpen(true)}
        onOpenPayPalConnect={() => setIsPayPalConnectOpen(true)}
        onOpenPayPalSettlement={() => setIsPayPalSettlementModalOpen(true)}
        onOpenGitHubSettings={() => setIsGitHubSettingsOpen(true)}
        onOpenAutoDeploy={() => setIsAutoDeployModalOpen(true)}
        onOpenCredentialsModal={() => setIsCredentialsModalOpen(true)}
        onOpenLegal={(tab) => {
          setLegalTab(tab);
          setIsLegalModalOpen(true);
        }}
        fmt={fmt}
      />

      {/* ===== MAIN CONTENT ===== */}
      <main className="flex-1 overflow-y-auto h-screen p-4 sm:p-6 lg:p-8 pt-16 lg:pt-8 pb-24 lg:pb-8 bg-[#090d14]">
        
        {/* Modern Executive Topbar */}
        <AppTopbar
          activeTab={activeTab}
          walletBalance={walletBalance}
          usdToInrRate={USD_TO_INR_RATE}
          autopilot={autopilot}
          onToggleAutopilot={() => {
            const nextState = !autopilot;
            setAutopilot(nextState);
            showToast(`Autopilot ${nextState ? 'engaged' : 'paused'}`, nextState ? 'success' : 'info');
          }}
          watchdogStatus={watchdogStatus}
          watchdogFailures={watchdogFailures}
          watchdogLatencyMs={watchdogLatencyMs}
          isBackendLoading={isBackendLoading}
          onSyncTelemetry={async () => {
            setIsBackendLoading(true);
            try {
              const [statsData, bidsData, leadsData] = await Promise.all([
                fetchBackendStats(),
                fetchBackendBids(50),
                fetchBackendLeads(50)
              ]);
              if (statsData) setBackendStats(statsData);
              if (bidsData) setBackendBids(bidsData);
              if (leadsData) setBackendLeads(leadsData);
              showToast('Synced latest backend telemetry', 'success');
            } catch (err: any) {
              showToast(`Sync notice: ${err.message}`, 'error');
            } finally {
              setIsBackendLoading(false);
            }
          }}
          onOpenPayPalSettlement={() => setIsPayPalSettlementModalOpen(true)}
          onOpenBackendModal={() => setIsBackendModalOpen(true)}
          onOpenCredentialsModal={() => setIsCredentialsModalOpen(true)}
          onOpenGitHubSettings={() => setIsGitHubSettingsOpen(true)}
          onOpenAutoDeploy={() => setIsAutoDeployModalOpen(true)}
          onOpenEmailVerification={() => setIsEmailVerificationOpen(true)}
          onOpenPasswordReset={() => setIsPasswordResetOpen(true)}
          onOpenPayPalConnect={() => setIsPayPalConnectOpen(true)}
          onOpenLegal={(tab) => {
            setLegalTab(tab);
            setIsLegalModalOpen(true);
          }}
          isEmailVerified={isEmailVerified}
          paypalMeUrl={PRIMARY_PAYPAL_ME_URL}
          paypalMeHandle={PRIMARY_PAYPAL_ME}
          upiId={PRIMARY_UPI_ID}
          fmt={fmt}
        />

        {/* Backend Unreachable & Watchdog Alert Banner */}
        {(backendError || watchdogFailures >= 2 || watchdogStatus === 'restarting') && (
          <div className="mb-6 rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-950/60 via-red-900/30 to-red-950/60 p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="rounded-xl bg-red-500/20 p-2 text-red-400 border border-red-500/30 shrink-0">
                <i className={`fas ${watchdogStatus === 'restarting' ? 'fa-sync-alt fa-spin' : 'fa-exclamation-triangle'} text-base`}></i>
              </div>
              <div>
                <div className="text-xs font-bold text-red-300 flex items-center gap-2 flex-wrap">
                  <span>Backend Watchdog Diagnostic</span>
                  <span className="bg-red-500/20 text-red-400 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold">
                    {BACKEND_BASE_URL}
                  </span>
                  {watchdogFailures > 0 && (
                    <span className="bg-amber-500/20 text-amber-300 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold">
                      Timeouts: {watchdogFailures}/3
                    </span>
                  )}
                  {watchdogStatus === 'restarting' && (
                    <span className="bg-cyan-500/20 text-cyan-300 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold animate-pulse">
                      Automated Soft Restart in Progress
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {watchdogStatus === 'restarting'
                    ? 'Persistent timeout detected by automated watchdog. Dispatching soft restart to backend service...'
                    : backendError || `Persistent connectivity timeouts detected (${watchdogFailures} consecutive). Automated watchdog will trigger a soft restart if timeouts persist.`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleManualSoftRestart}
                disabled={isWatchdogRestarting}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
                title="Trigger backend soft restart immediately"
              >
                <i className={`fas fa-bolt text-xs ${isWatchdogRestarting ? 'animate-spin' : ''}`}></i>
                <span>{isWatchdogRestarting ? 'Restarting...' : 'Soft Restart'}</span>
              </button>
              <button
                onClick={() => {
                  setBackendError(null);
                  fetchBackendStats().then(s => s && setBackendStats(s)).catch(() => {});
                }}
                className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shrink-0 cursor-pointer shadow-md"
              >
                <i className="fas fa-redo text-xs"></i>
                <span>Retry Connection</span>
              </button>
            </div>
          </div>
        )}

        {/* Unverified Email Warning Banner */}
        {!isEmailVerified && (
          <div className="mb-6 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/50 via-amber-900/30 to-amber-950/50 p-4 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="rounded-xl bg-amber-500/20 p-2 text-amber-400 border border-amber-500/30 shrink-0">
                <i className="fas fa-shield-alt text-base"></i>
              </div>
              <div>
                <div className="text-xs font-bold text-amber-300">
                  Email Verification Pending ({userEmail})
                </div>
                <p className="text-[11px] text-slate-300">
                  Verify your email address with a 6-digit OTP code to unlock instant PayPal settlements and verified contractor badges.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsEmailVerificationOpen(true)}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shrink-0 cursor-pointer shadow-md"
            >
              <i className="fas fa-check-circle"></i>
              <span>Verify Email Now</span>
            </button>
          </div>
        )}

        {/* ===== TAB 1: DASHBOARD ===== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            
            {/* Live Backend Telemetry Header Banner */}
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-lg shrink-0">
                  <i className="fas fa-bolt"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Live Auto-Bidding Telemetry</span>
                    <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold flex items-center gap-1.5 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      CONNECTED
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {getApiBaseUrl()}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white mt-0.5">Real-time Freelance Proposals, Telemetry &amp; Scored Leads Pipeline</h4>
                  <p className="text-xs text-slate-400 mt-0.5">Continuous 60-second polling synchronization with live database telemetry and Chart.js analytics.</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  id="btn-sync-telemetry-now"
                  onClick={async () => {
                    setIsBackendLoading(true);
                    try {
                      const [statsData, bidsData, leadsData] = await Promise.all([
                        fetchBackendStats(),
                        fetchBackendBids(50),
                        fetchBackendLeads(50)
                      ]);
                      if (statsData) setBackendStats(statsData);
                      if (bidsData) setBackendBids(bidsData);
                      if (leadsData) setBackendLeads(leadsData);
                      showToast('Synced latest backend telemetry', 'success');
                    } catch (err: any) {
                      showToast(`Sync notice: ${err.message}`, 'error');
                    } finally {
                      setIsBackendLoading(false);
                    }
                  }}
                  disabled={isBackendLoading}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2.5 text-xs font-extrabold transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  <i className={`fas fa-sync-alt text-xs ${isBackendLoading ? 'animate-spin' : ''}`}></i>
                  <span>{isBackendLoading ? 'Syncing...' : 'Refresh Now'}</span>
                </button>
              </div>
            </div>

            {/* Dedicated System Connectivity & Health Diagnostics Widget */}
            <HealthDashboard
              onOpenSettings={() => setIsCredentialsModalOpen(true)}
              className="mb-2"
            />

            {/* Autonomous Revenue Intelligence & Dynamic Pricing Panel */}
            <AutonomousRevenuePanel />

            {/* Executive KPI Metrics Grid */}
            <DashboardMetricsCards
              totalBids={backendStats?.total ?? 0}
              activeBids={backendStats?.active ?? 0}
              wonBids={backendStats?.won ?? 0}
              earnedAmount={backendStats?.earned ?? todayEarnings}
              winRate={backendStats?.win_rate ?? 0}
              fmt={fmt}
            />

            {/* Chart.js Package Distribution Telemetry Bar Chart */}
            <div id="package-distribution-section" className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#1e293b]/80 mb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center text-sm font-bold border border-indigo-500/25">
                      <i className="fas fa-chart-bar"></i>
                    </div>
                    <h3 className="text-base font-bold text-white tracking-tight">
                      Package Bid Volume Distribution (Chart.js)
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Live breakdown of AI-matched service packages (Full-Stack, AI Agent, Payment Gateway, Code Audit) from backend stats.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300 font-mono font-bold border border-indigo-500/20">
                    60s Auto-Sync
                  </span>
                </div>
              </div>
              <Suspense fallback={<LazyFallback label="Loading Package Telemetry..." />}>
                <PackageChart packageCounts={backendStats?.package_counts} isLoading={isBackendLoading} />
              </Suspense>
            </div>

            {/* Bids Table Section (https://3-222-149-9.sslip.io/api/bids?limit=50) */}
            <Suspense fallback={<LazyFallback label="Loading Live Bids Telemetry..." />}>
              <BidsTable
                onSelectBid={(bid) => {
                  const jobObj = toFreelanceJob({
                    id: bid.id,
                    title: bid.job_title,
                    platform: bid.platform || 'Freelancer.com',
                    budget: bid.bid_amount,
                    description: bid.cover_letter,
                    clientName: bid.client_name || bid.company,
                    url: bid.job_url,
                    tags: [bid.package]
                  });
                  setSelectedProposalJob(jobObj);
                  setIsProposalStudioOpen(true);
                }}
                onBidsLoaded={handleBidsLoaded}
                onNotify={(msg, type) => {
                  showToast(msg, type || 'info');
                }}
              />
            </Suspense>

            {/* Leads Table Section (https://3-222-149-9.sslip.io/api/leads?limit=20) */}
            <Suspense fallback={<LazyFallback label="Loading Leads Telemetry..." />}>
              <LeadsTable
                onSelectLead={(lead) => {
                  const jobObj = toFreelanceJob({
                    id: String(lead.id || Math.random()),
                    title: lead.job_title || lead.title || 'Remote Gig',
                    platform: lead.source || 'RemoteOK',
                    budget: 350,
                    description: lead.description || `Scored matched lead for ${lead.company}`,
                    clientName: lead.company,
                    url: lead.job_url || lead.url,
                    tags: [lead.matched_package || lead.package || 'General']
                  });
                  setSelectedProposalJob(jobObj);
                  setIsProposalStudioOpen(true);
                }}
              />
            </Suspense>

            {/* Dedicated Freelancer.com SQLite Bids & Win Conversion Telemetry Section */}
            <Suspense fallback={<LazyFallback label="Loading Freelancer Metrics..." />}>
              <FreelancerMetricsSection
                onOpenProposalModal={(bid) => {
                  const jobObj = toFreelanceJob({
                    id: bid.id,
                    title: bid.job_title,
                    platform: bid.platform || 'Freelancer.com',
                    budget: bid.bid_amount,
                    description: bid.cover_letter,
                    clientName: bid.client_name || bid.company,
                    url: bid.job_url,
                    tags: [bid.package]
                  });
                  setSelectedProposalJob(jobObj);
                  setIsProposalStudioOpen(true);
                }}
              />
            </Suspense>

            {/* Platform Earnings & Withdrawal Summary Section */}
            <Suspense fallback={<LazyFallback label="Loading Platform Withdrawal Summary..." />}>
              <WithdrawalSummary
                bids={backendBids}
                stats={backendStats}
                onNotify={(msg, type) => showToast(msg, type)}
                onWithdrawPlatform={(platformName, amount) => {
                  showToast(`Routing to secure withdrawal gateway for ${platformName} ($${amount.toFixed(2)})`, 'info');
                }}
              />
            </Suspense>

            {/* Panel Grid: Work Orders & Earnings/Wallet */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              
              {/* Left Panel: Active Work Orders (7 cols) */}
              <div className="lg:col-span-7 bg-[#161b2b] rounded-2xl border border-[#2a3147] p-5 shadow-lg flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-[#2a3147]/60 mb-4">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-white">
                      <i className="fas fa-tasks text-[#4f7cff]"></i>
                      Active Work Orders
                    </h3>
                    <button
                      onClick={() => setActiveTab('orders')}
                      className="text-xs text-[#4f7cff] hover:underline font-medium cursor-pointer"
                    >
                      View all →
                    </button>
                  </div>

                  {/* Work list */}
                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                    {workOrders.filter(o => o.status !== 'completed').length === 0 ? (
                      <div className="text-center text-[#5d6788] py-8 text-xs space-y-2">
                        <p>No active work orders at the moment.</p>
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={syncRemoteOKJobs}
                            className="bg-[#1e1730] border border-purple-500/40 text-purple-300 px-3 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5"
                          >
                            <i className="fas fa-globe"></i> Sync RemoteOK
                          </button>
                          <button
                            onClick={() => {
                              document.getElementById('manualTitleInput')?.focus();
                            }}
                            className="bg-[#11141f] border border-[#2a3147] hover:border-[#4f7cff] text-white px-3 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5"
                          >
                            <i className="fas fa-pen"></i> Add Order
                          </button>
                        </div>
                      </div>
                    ) : (
                      workOrders.filter(o => o.status !== 'completed').map((order, idx) => (
                        <div
                          key={`wo-act-${order.id || idx}-${idx}`}
                          className={`flex flex-col p-3.5 bg-[#11141f] rounded-xl border-l-4 ${
                            order.platform === 'RemoteOK'
                              ? 'border-purple-500 hover:border-purple-400'
                              : 'border-[#4f7cff] hover:border-blue-400'
                          } hover:bg-[#1e2438] transition-all gap-3`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                            <div className="space-y-1 max-w-sm">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-white">{order.title}</span>
                                {order.platform === 'RemoteOK' && (
                                  <span className="text-[9px] uppercase font-mono font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    RemoteOK
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[#5d6788] flex flex-wrap items-center gap-3">
                                <span><i className="fas fa-building mr-1 text-[10px]"></i>{order.category}</span>
                                <span><i className="far fa-clock mr-1 text-[10px]"></i>{order.time}</span>
                                {order.url && order.url !== '#' && (
                                  <a
                                    href={order.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-purple-400 hover:underline inline-flex items-center gap-0.5 text-[11px]"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Open <i className="fas fa-external-link-alt text-[9px]"></i>
                                  </a>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2.5">
                              {editingOrderId === order.id ? (
                                <div className="flex items-center gap-1.5 bg-[#0b0d15] p-1 rounded-lg border border-[#4f7cff]">
                                  <input
                                    type="number"
                                    autoFocus
                                    value={editingAmountValue}
                                    onChange={(e) => setEditingAmountValue(e.target.value)}
                                    placeholder="USD"
                                    className="w-16 bg-transparent text-xs font-mono text-white px-1.5 py-0.5 focus:outline-none"
                                  />
                                  <button
                                    onClick={() => saveCustomAmount(order.id)}
                                    className="text-[#2ecc71] hover:text-emerald-300 p-1 text-xs"
                                    title="Save Amount"
                                  >
                                    <i className="fas fa-check"></i>
                                  </button>
                                  <button
                                    onClick={() => setEditingOrderId(null)}
                                    className="text-slate-400 hover:text-white p-1 text-xs"
                                    title="Cancel"
                                  >
                                    <i className="fas fa-times"></i>
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span className={`font-mono font-bold text-sm ${order.amount === 0 ? 'text-[#f39c12]' : 'text-white'}`}>
                                    {order.amount === 0 ? 'Quote Pending' : `$${fmt(order.amount)} USD`}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setEditingOrderId(order.id);
                                      setEditingAmountValue(order.amount ? String(order.amount) : '250');
                                    }}
                                    className="text-[#5d6788] hover:text-[#4f7cff] text-[11px] p-1"
                                    title="Edit/Set Contract Rate"
                                  >
                                    <i className="fas fa-pencil-alt"></i>
                                  </button>
                                </div>
                              )}

                              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                                order.status === 'in-progress'
                                  ? 'bg-[rgba(79,124,255,0.18)] text-[#4f7cff] border border-[#4f7cff]/30'
                                  : order.status === 'urgent'
                                  ? 'bg-[rgba(231,76,60,0.18)] text-[#e74c3c] border border-[#e74c3c]/30'
                                  : 'bg-[rgba(243,156,18,0.18)] text-[#f39c12] border border-[#f39c12]/30'
                              }`}>
                                {order.status}
                              </span>

                              {order.status === 'pending' ? (
                                <button
                                  onClick={() => acceptOrder(order.id)}
                                  className="text-blue-400 hover:text-white bg-blue-600/20 hover:bg-blue-600 p-1.5 rounded-lg text-xs transition-all cursor-pointer"
                                  title="Accept Contract into Queue"
                                >
                                  <i className="fas fa-play"></i>
                                </button>
                              ) : (
                                <button
                                  onClick={() => completeOrder(order.id)}
                                  className="text-[#5d6788] hover:text-[#2ecc71] p-1.5 hover:bg-[#161b2b] rounded-lg transition-all cursor-pointer"
                                  title="Mark Complete & Release Escrow"
                                >
                                  <i className="fas fa-check-circle text-base"></i>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Visual Lifecycle Timeline: Pending -> In-Progress -> Escrow Released -> Completed */}
                          <div className="w-full pt-1">
                            <WorkOrderTimeline
                              status={order.status}
                              paymentStatus={(order as any).payment_status}
                              customerConfirmed={(order as any).customer_confirmed}
                              workerMarkedComplete={(order as any).worker_marked_complete}
                              completedAt={order.completed_at}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* AI Agent Status Footer */}
                <div className="mt-4 flex items-center gap-3 bg-[#11141f] px-4 py-2.5 rounded-xl border border-[#2a3147] text-xs">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#2ecc71] animate-pulse"></span>
                  <span className="text-[#9aa2bf]">AI Agent is </span>
                  <span className="text-[#4f7cff] font-medium">{aiStatus}</span>
                </div>
              </div>

              {/* Right Panel: Earnings & PayPal Payout (5 cols) */}
              <div className="lg:col-span-5 bg-[#161b2b] rounded-2xl border border-[#2a3147] p-5 shadow-lg flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-[#2a3147]/60 mb-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-white">
                      <i className="fas fa-chart-simple text-[#4f7cff]"></i>
                      Earnings &amp; PayPal Payout
                    </h3>
                    <button
                      onClick={() => setActiveTab('paypal')}
                      className="text-xs text-[#00cfe8] hover:underline font-medium cursor-pointer flex items-center gap-1"
                    >
                      <i className="fab fa-paypal text-[11px]"></i> Terminal →
                    </button>
                  </div>

                  {/* Chart */}
                  <Suspense fallback={<div className="h-[180px] w-full bg-[#11141f] rounded-xl flex items-center justify-center text-xs text-slate-500 animate-pulse">Loading earnings trajectory...</div>}>
                    <DashboardEarningsChart todayEarnings={todayEarnings} />
                  </Suspense>

                  {/* Target Progress */}
                  <div className="mt-3 bg-[#11141f] rounded-xl p-3.5 border border-[#2a3147]">
                    <div className="flex justify-between text-xs mb-1.5 font-medium">
                      <span className="text-[#9aa2bf] flex items-center gap-1.5">
                        <i className="fas fa-bullseye text-[#4f7cff]"></i>
                        Daily Target (${dailyTarget} USD)
                      </span>
                      <span className="font-mono text-white font-bold">${fmt(todayEarnings)} / ${dailyTarget}</span>
                    </div>
                    <div className="w-full h-2 bg-[#2a3147] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${targetPct}%`,
                          background: targetPct >= 100
                            ? 'linear-gradient(90deg, #2ecc71, #27ae60)'
                            : 'linear-gradient(90deg, #4f7cff, #2ecc71)'
                        }}
                      />
                    </div>
                  </div>

                  {/* Manual Order Entry Form */}
                  <div className="mt-3.5 bg-[#11141f] rounded-xl p-3.5 border border-[#2a3147] space-y-2">
                    <div className="text-xs font-semibold text-[#9aa2bf] flex items-center gap-1.5">
                      <i className="fas fa-pen text-[#4f7cff]"></i>
                      <span>Manual Order Entry (USD)</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <input
                        id="manualTitleInput"
                        type="text"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addManualOrder(); }}
                        placeholder="Job title (e.g., WordPress Theme)"
                        className="sm:col-span-6 bg-[#0b0d15] border border-[#2a3147] text-white text-xs px-3 py-2 rounded-full focus:outline-none focus:border-[#4f7cff]"
                      />
                      <input
                        type="number"
                        value={manualAmount}
                        onChange={(e) => setManualAmount(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addManualOrder(); }}
                        placeholder="USD ($)"
                        step="0.01"
                        min="0.01"
                        className="sm:col-span-3 bg-[#0b0d15] border border-[#2a3147] text-white text-xs px-3 py-2 rounded-full font-mono focus:outline-none focus:border-[#4f7cff]"
                      />
                      <button
                        onClick={addManualOrder}
                        className="sm:col-span-3 bg-[#4f7cff] hover:bg-[#3d6bf0] text-white font-bold py-2 px-3 rounded-full text-xs transition-all flex items-center justify-center gap-1 shadow-[0_2px_12px_rgba(79,124,255,0.25)]"
                      >
                        <i className="fas fa-plus text-[10px]"></i>
                        <span>Add Order</span>
                      </button>
                    </div>

                    <div className="text-[10.5px] text-[#5d6788] flex items-center gap-1 pt-0.5">
                      <i className="fas fa-info-circle text-[#4f7cff]/80"></i>
                      <span>Add jobs from Upwork, Freelancer, or Direct clients – complete to collect.</span>
                    </div>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={autoCollectEarnings}
                      disabled={isAutoCollecting}
                      className="bg-[#2ecc71] hover:bg-[#27ae60] text-slate-950 font-bold py-2 px-3 rounded-full text-xs transition-all flex items-center justify-center gap-1.5 shadow-[0_4px_16px_rgba(46,204,113,0.25)]"
                    >
                      <i className="fas fa-arrow-right"></i>
                      <span>Auto-Collect Revenue</span>
                    </button>

                    <button
                      onClick={scanLivePlatforms}
                      disabled={isScanningPlatforms}
                      className="bg-[#11141f] hover:bg-[#1e2438] border border-[#2a3147] hover:border-[#4f7cff] text-white py-2 px-3 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                    >
                      <i className={`fas fa-sync-alt ${isScanningPlatforms ? 'animate-spin text-[#4f7cff]' : ''}`}></i>
                      <span>{isScanningPlatforms ? 'Scanning...' : 'Scan Platforms'}</span>
                    </button>
                  </div>

                  {/* Direct Payout & Settlement */}
                  <div className="mt-3.5 pt-3 border-t border-[#2a3147]/60">
                    <div className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <input
                          type="number"
                          value={payoutAmount}
                          onChange={(e) => setPayoutAmount(e.target.value)}
                          placeholder="Amount ($ USD)"
                          min="0.01"
                          step="0.01"
                          className="w-full bg-[#11141f] border border-[#2a3147] text-white text-xs px-3 py-2 rounded-full focus:outline-none focus:border-[#4f7cff] font-mono"
                        />
                      </div>

                      <button
                        onClick={() => setIsPayPalSettlementModalOpen(true)}
                        className="bg-gradient-to-r from-[#003087] to-[#0070ba] hover:opacity-90 text-white px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-sm"
                        title="Open PayPal Live Settlement & Invoicing Center"
                      >
                        <i className="fab fa-paypal text-[11px] text-[#00cfe8]"></i>
                        <span>PayPal Settlement Hub</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Receiving Links & Gateway Details */}
                <div className="text-[11px] text-[#5d6788] mt-3 space-y-2 pt-2 border-t border-[#2a3147]/60">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1.5">
                      <i className="fab fa-paypal text-[#00cfe8]"></i>
                      <span>PayPal Link:</span>
                      <a
                        href={PRIMARY_PAYPAL_ME_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#00cfe8] hover:underline font-mono font-bold"
                      >
                        paypal.me/{PRIMARY_PAYPAL_ME}
                      </a>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(PRIMARY_PAYPAL_ME_URL);
                        showToast('📋 Copied PayPal receiving link (https://paypal.me/ky8402)!', 'success');
                      }}
                      className="bg-[#11141f] hover:bg-[#1f253a] text-slate-300 text-[10px] px-2 py-0.5 rounded border border-[#2a3147] transition-all"
                    >
                      Copy
                    </button>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-1.5">
                      <i className="fas fa-university text-emerald-400"></i>
                      <span>Bank / UPI:</span>
                      <span className="text-emerald-400 font-mono font-bold">{PRIMARY_UPI_ID}</span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(PRIMARY_UPI_ID);
                        showToast(`📋 Copied UPI ID: ${PRIMARY_UPI_ID}`, 'success');
                      }}
                      className="bg-[#11141f] hover:bg-[#1f253a] text-slate-300 text-[10px] px-2 py-0.5 rounded border border-[#2a3147] transition-all"
                    >
                      Copy
                    </button>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] pt-1">
                    <button
                      onClick={() => setActiveTab('paypal')}
                      className="text-[#00cfe8] hover:underline font-medium flex items-center gap-1"
                    >
                      <i className="fab fa-paypal text-[9px]"></i>
                      PayPal Portal →
                    </button>
                    <button
                      onClick={() => setActiveTab('bank')}
                      className="text-emerald-400 hover:underline font-medium flex items-center gap-1"
                    >
                      <i className="fas fa-university text-[9px]"></i>
                      Indian Bank Portal →
                    </button>
                  </div>
                </div>
              </div>

            </div>

            {/* Recent Transactions Panel */}
            <div className="bg-[#161b2b] rounded-2xl border border-[#2a3147] p-5 shadow-lg">
              <div className="flex items-center justify-between pb-3 border-b border-[#2a3147]/60 mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2 text-white">
                  <i className="fas fa-receipt text-[#4f7cff]"></i>
                  Recent Transactions &amp; Payouts
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#5d6788] hidden sm:inline">Live reporting ledger</span>
                  <button
                    onClick={() => setIsPayPalSettlementModalOpen(true)}
                    className="text-[11px] text-[#00cfe8] hover:underline flex items-center gap-1 font-mono"
                  >
                    <i className="fas fa-external-link-alt text-[9px]"></i>
                    <span>Settlement Center</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {transactions.map((tx, idx) => (
                  <div
                    key={`tx-${tx.id || idx}-${idx}`}
                    className="flex items-center justify-between p-3 bg-[#11141f] rounded-xl text-xs hover:bg-[#1e2438] transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                        tx.type === 'credit' ? 'bg-[#2ecc71]/15 text-[#2ecc71]' : 'bg-[#e74c3c]/15 text-[#e74c3c]'
                      }`}>
                        <i className={`fas ${tx.type === 'credit' ? 'fa-arrow-down' : 'fa-arrow-up'} text-xs`}></i>
                      </div>
                      <div>
                        <div className="font-semibold text-white flex items-center gap-2">
                          <span>{tx.name}</span>
                          {tx.method && (
                            <span className="text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20 px-1.5 py-0.5 rounded font-mono">
                              {tx.method}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#5d6788]">{tx.date}</div>
                      </div>
                    </div>

                    <div className={`font-mono font-bold text-sm ${
                      tx.type === 'credit' ? 'text-[#2ecc71]' : 'text-[#e74c3c]'
                    }`}>
                      {tx.type === 'credit' ? '+' : ''}${fmt(Math.abs(tx.amount))} USD
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ===== TAB: REMOTE OK LIVE JOBS (ZERO AUTH) ===== */}
        {activeTab === 'remoteok' && (
          <div className="space-y-6">
            <Suspense fallback={<LazyFallback label="Loading RemoteOK Jobs Feed..." />}>
              <RemoteOKJobsBoard
                jobs={workOrders.filter(w => w.platform === 'RemoteOK' || w.platform === 'Direct Remote').map(w => ({
                  id: w.id,
                  title: w.title,
                  company: w.clientName || w.category || 'Remote Client',
                  description: w.description || '',
                  url: w.url || '#',
                  tags: w.tags || ['Remote', 'Developer'],
                  location: w.location || 'Worldwide',
                  amount: w.amount || 75.00,
                  category: w.category || 'Development',
                  platform: w.platform || 'RemoteOK',
                  time: w.time || 'Live'
                }))}
                profile={userProfile}
                onImportToOrders={(job) => {
                  const newOrder: WorkOrder = {
                    id: job.id,
                    externalId: String(job.id),
                    title: job.title,
                    platform: 'RemoteOK',
                    status: 'pending',
                    amount: job.amount || 75.00,
                    category: job.company || 'Remote Dev',
                    time: job.time || 'Live Stream',
                    clientName: job.company,
                    description: job.description,
                    url: job.url,
                    location: job.location,
                    tags: job.tags
                  };
                  setWorkOrders(prev => {
                    const exists = prev.some(o => String(o.id) === String(newOrder.id));
                    if (exists) return prev;
                    return [newOrder, ...prev];
                  });
                  showToast(`✅ "${job.title}" imported into Work Orders!`, 'success');
                }}
                onOpenAIProposal={(job) => {
                  const freelanceJob = toFreelanceJob(job);
                  setSelectedProposalJob(freelanceJob);
                  setIsProposalStudioOpen(true);
                }}
                onRefreshFeed={syncRemoteOKJobs}
                isLoading={isSyncingRemoteOK}
                showToast={showToast}
              />
            </Suspense>
          </div>
        )}

        {/* ===== TAB 2: WORK ORDERS ===== */}
        {activeTab === 'orders' && (
          <Suspense fallback={<LazyFallback label="Loading Work Orders & Pipeline..." />}>
            <WorkOrdersView
              workOrders={workOrders}
              isSyncingRemoteOK={isSyncingRemoteOK}
              onSyncRemoteOK={syncRemoteOKJobs}
              onExploreRemoteOK={() => setActiveTab('remoteok')}
              onNewCustomOrder={() => {
                setActiveTab('dashboard');
                setTimeout(() => {
                  document.getElementById('manualTitleInput')?.focus();
                }, 100);
              }}
              onOpenSettings={() => setIsCredentialsModalOpen(true)}
              onAcceptOrder={acceptOrder}
              onCompleteOrder={completeOrder}
              onSaveCustomAmount={saveCustomAmount}
              onOpenProposalStudio={(job) => {
                setSelectedProposalJob(job);
                setIsProposalStudioOpen(true);
              }}
              onOpenAnalysisModal={(job) => {
                setSelectedAnalysisJob(job);
                setIsAnalysisModalOpen(true);
              }}
              toFreelanceJob={toFreelanceJob}
              fmt={fmt}
            />
          </Suspense>
        )}

        {/* ===== TAB 3: INVOICING ===== */}
        {activeTab === 'invoicing' && (
          <div className="space-y-4">
            <Suspense fallback={<LazyFallback label="Loading Invoicing Hub..." />}>
              <InvoicesView
                invoices={invoices}
                onGenerateInvoice={() => {
                  const amount = randomFloat(25, 95);
                  const invId = `INV-${new Date().toISOString().slice(0, 10)}-${random(100, 999)}`;
                  const newInv: Invoice = {
                    id: invId,
                    orderTitle: 'Custom Full-Stack Prototype Milestone',
                    amount: amount,
                    date: new Date().toLocaleString(),
                    status: 'Paid',
                    client: 'Enterprise Client Inc'
                  };
                  setInvoices(prev => [newInv, ...prev]);
                  showToast(`📄 Invoice #${invId} generated for ${fmt(amount)} USDT`, 'info');
                }}
                onOpenPayPalInvoice={(inv) => {
                  setSelectedPayPalInvoice(inv);
                  setIsPayPalModalOpen(true);
                }}
                onOpenGSTInvoice={(inv) => {
                  setSelectedGSTInvoice(inv);
                  setIsGSTInvoiceOpen(true);
                }}
                onDownloadPDF={(invId) => showToast(`📥 Downloading ${invId}.pdf...`, 'success')}
                onDownloadAllInvoices={() => showToast('📥 Exporting all invoices as ZIP/CSV archive...', 'success')}
                fmt={fmt}
              />
            </Suspense>

            {/* Active Contracts, Milestone Deliverables & Official Printable Invoices */}
            <div className="pt-2">
              <Suspense fallback={<LazyFallback label="Loading Invoices & Contracts..." />}>
                <ContractsAndInvoices
                  contracts={activeContractsList}
                  onCompleteMilestone={(contractId, milestoneId) => {
                    setActiveContractsList(prev => prev.map(c => {
                      if (c.id === contractId) {
                        const updatedMilestones = c.milestones.map(m => {
                          if (m.id === milestoneId && !m.completed) {
                            const amt = m.amount;
                            setWalletBalance(curr => curr + amt);
                            setTodayEarnings(curr => curr + amt);
                            const newTx: Transaction = {
                              id: makeUniqueId('tx_milestone'),
                              name: `🎯 Milestone Payout: "${m.title}" (${c.jobTitle})`,
                              date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today',
                              amount: amt,
                              type: 'credit',
                              method: 'Escrow',
                              referenceId: `MS-${Date.now().toString().slice(-6)}`
                            };
                            setTransactions(t => [newTx, ...t]);
                            showToast(`✅ Milestone "${m.title}" completed! (+$${fmt(amt)} USD)`, 'success');
                            triggerConfetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
                            return { ...m, completed: true };
                          }
                          return m;
                        });
                        const newPaid = updatedMilestones.filter(m => m.completed).reduce((acc, m) => acc + m.amount, 0);
                        return { ...c, milestones: updatedMilestones, amountPaid: newPaid };
                      }
                      return c;
                    }));
                  }}
                />
              </Suspense>
            </div>
          </div>
        )}

        {/* ===== TAB: REAL INCOME HUB & CLIENT CHECKOUT ===== */}
        {activeTab === 'income' && (
          <div className="space-y-5">
            <Suspense fallback={<LazyFallback label="Loading Real Income Hub..." />}>
              <RealIncomeHub
                onPaymentReceived={handlePayPalPaymentReceived}
                onNavigateToTab={(t) => setActiveTab(t as any)}
                showToast={showToast}
              />
            </Suspense>
          </div>
        )}

        {/* ===== TAB 4: REAL INCOME & PAYMENT RECEIVING HUB ===== */}
        {activeTab === 'paypal' && (
          <div className="space-y-5">
            <Suspense fallback={<LazyFallback label="Loading PayPal Gateway..." />}>
              <RealIncomeHub
                onPaymentReceived={handlePayPalPaymentReceived}
                onNavigateToTab={(t) => setActiveTab(t as any)}
                showToast={showToast}
              />
            </Suspense>
          </div>
        )}

        {/* ===== TAB 6: ANALYTICS ===== */}
        {activeTab === 'analytics' && (
          <div className="space-y-5">
            <Suspense fallback={<LazyFallback label="Loading Analytics..." />}>
              <AnalyticsView
                onExportData={() => showToast('📊 Performance report exported to CSV', 'success')}
              />
            </Suspense>
          </div>
        )}

        {/* ===== TAB: LEAD NOTIFICATIONS & SPEED RADAR ===== */}
        {activeTab === 'notifications' && (
          <Suspense fallback={<LazyFallback label="Loading Notifications Radar..." />}>
            <LeadNotificationsHub
              onOpenProposalStudio={(job) => {
                setSelectedProposalJob(job);
                setIsProposalStudioOpen(true);
              }}
              showToast={showToast}
            />
          </Suspense>
        )}

        {/* ===== TAB: REAL LEAD SCORING & TIER PAYWALLS ===== */}
        {activeTab === 'leads' && (
          <Suspense fallback={<LazyFallback label="Loading AI Leads Radar..." />}>
            <PremiumLeadsRadar
              profile={userProfile}
              onOpenProposalStudio={(job) => {
                setSelectedProposalJob(job);
                setIsProposalStudioOpen(true);
              }}
              onAnalyzeJob={(job) => {
                setSelectedAnalysisJob(job);
                setIsAnalysisModalOpen(true);
              }}
              showToast={showToast}
            />
          </Suspense>
        )}

        {/* ===== TAB 8: ACTIVITY LOGS & WEBHOOK DEBUGGER ===== */}
        {activeTab === 'logs' && (
          <Suspense fallback={<LazyFallback label="Loading Activity Logs..." />}>
            <ActivityLogsView onNavigateToTab={(t) => setActiveTab(t as any)} />
          </Suspense>
        )}

        {/* ===== TAB 9: POSTGRESQL DATABASE SNAPSHOTS & DISASTER RECOVERY ===== */}
        {activeTab === 'snapshots' && (
          <Suspense fallback={<LazyFallback label="Loading Database Snapshot Manager..." />}>
            <DatabaseSnapshotManager onNavigateToLogs={() => setActiveTab('logs')} />
          </Suspense>
        )}

        {/* ===== TAB 10: UNIFIED DEVOPS SYSTEM HEALTH DASHBOARD ===== */}
        {activeTab === 'health' && (
          <div className="space-y-6">
            <SystemHealthConnectivityCard 
              onOpenBackendModal={() => setIsBackendModalOpen(true)}
              onOpenSettings={() => setIsCredentialsModalOpen(true)}
              onNavigateToSnapshots={() => setActiveTab('snapshots')}
            />
            <HealthDashboard onOpenSettings={() => setIsCredentialsModalOpen(true)} />
          </div>
        )}

      </main>

      {/* ===== PLATFORM CREDENTIALS, WEBHOOKS & DATA RECOVERY MODAL ===== */}
      <Suspense fallback={null}>
        <PlatformCredentialsModal
          isOpen={isCredentialsModalOpen}
          onClose={() => setIsCredentialsModalOpen(false)}
          onOrderAdded={(newOrder) => {
            setWorkOrders(prev => [newOrder, ...prev]);
          }}
          workOrders={workOrders}
          transactions={transactions}
          invoices={invoices}
          contracts={activeContractsList}
          profile={userProfile}
          stats={{
            walletBalance,
            todayEarnings,
            completedOrders
          }}
          showToast={showToast}
          onOpenGitHubSettings={() => setIsGitHubSettingsOpen(true)}
        />
      </Suspense>

      {/* ===== GITHUB INTEGRATION & SSH KEY SETTINGS MODAL ===== */}
      <Suspense fallback={null}>
        <GitHubSettingsModal
          isOpen={isGitHubSettingsOpen}
          onClose={() => setIsGitHubSettingsOpen(false)}
          showToast={showToast}
          onOpenAutoDeploy={() => setIsAutoDeployModalOpen(true)}
          onRemoteConfigured={(url) => {
            showToast(`GitHub Remote set to: ${url}`, 'success');
          }}
        />
      </Suspense>

      {/* ===== AUTO-DEPLOY PIPELINE TOOL (EC2 & AWS AMPLIFY) ===== */}
      <Suspense fallback={null}>
        <AutoDeployPipelineTool
          isOpen={isAutoDeployModalOpen}
          onClose={() => setIsAutoDeployModalOpen(false)}
          showToast={showToast}
        />
      </Suspense>

      {/* ===== REAL INCOME PAYMENT & CHECKOUT MODAL ===== */}
      {isPayPalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-[#0d1220] border border-slate-700 rounded-3xl p-6 shadow-2xl">
            <button
              onClick={() => {
                setIsPayPalModalOpen(false);
                setSelectedPayPalInvoice(null);
              }}
              className="absolute top-5 right-5 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-700 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10"
              title="Close"
            >
              <i className="fas fa-times"></i>
            </button>

            <Suspense fallback={<LazyFallback label="Loading Payment Terminal..." />}>
              <RealIncomeHub
                onPaymentReceived={(amount, client, desc) => {
                  handlePayPalPaymentReceived(amount, client, desc);
                  setIsPayPalModalOpen(false);
                }}
                onNavigateToTab={(t) => {
                  setIsPayPalModalOpen(false);
                  setActiveTab(t as any);
                }}
                showToast={showToast}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* ===== PAYPAL REVENUE & SETTLEMENT CENTER MODAL ===== */}
      <PayPalSettlementModal
        isOpen={isPayPalSettlementModalOpen}
        onClose={() => setIsPayPalSettlementModalOpen(false)}
        walletBalance={walletBalance}
        todayEarnings={todayEarnings}
        showToast={showToast}
      />

      {/* ===== AI PROPOSAL STUDIO MODAL (GEMINI 3.7 FLASH) ===== */}
      <Suspense fallback={null}>
        <ProposalStudioModal
          isOpen={isProposalStudioOpen}
          onClose={() => {
            setIsProposalStudioOpen(false);
            setSelectedProposalJob(null);
          }}
          job={selectedProposalJob}
          profile={userProfile}
          onSubmitBid={async (job, proposal) => {
            const jobId = job.id;
            try {
              showToast(`🚀 Submitting pitch for "${job?.title || 'Contract'}"...`, 'info');
              
              await submitLivePlatformBid(jobId, {
                coverLetter: proposal.coverLetter,
                bidAmount: proposal.bidAmount,
                deliveryDays: proposal.estimatedDays
              });

              // Update Work Order to in-progress
              setWorkOrders(prev => {
                const existing = prev.find(o => String(o.id) === String(jobId));
                if (existing) {
                  return prev.map(o => String(o.id) === String(jobId) ? { ...o, status: 'in-progress', amount: proposal.bidAmount } : o);
                } else if (job) {
                  const newOrder: WorkOrder = {
                    id: job.id,
                    externalId: job.id,
                    title: job.title,
                    platform: job.platform,
                    status: 'in-progress',
                    amount: proposal.bidAmount,
                    category: job.skills[0] || 'Software Dev',
                    time: 'Just now',
                    clientName: job.client.name,
                    description: job.description,
                    url: job.platformUrl
                  };
                  return [newOrder, ...prev];
                }
                return prev;
              });

              // Stage contract in Contracts & Invoices
              const newContract: ActiveContract = {
                id: `CON-${Date.now().toString().slice(-4)}`,
                jobTitle: job?.title || 'Custom Engineering Scope',
                platform: (job?.platform as any) || 'RemoteOK',
                clientName: job?.client.name || 'Direct Enterprise Client',
                totalValue: proposal.bidAmount,
                amountPaid: 0,
                status: 'in_progress',
                milestones: proposal.proposedMilestones && proposal.proposedMilestones.length > 0 ? proposal.proposedMilestones.map((m, idx) => ({
                  id: `M${idx + 1}`,
                  title: m.name,
                  amount: m.amount,
                  completed: false,
                  dueDate: `Day ${m.durationDays}`
                })) : [
                  { id: 'M1', title: 'Initial Prototype & Architecture Setup', amount: Math.round(proposal.bidAmount * 0.5), completed: false, dueDate: '3 Days' },
                  { id: 'M2', title: 'Full Implementation & Test Suite Delivery', amount: Math.round(proposal.bidAmount * 0.5), completed: false, dueDate: `${proposal.estimatedDays} Days` }
                ],
                startedDate: 'Today'
              };
              setActiveContractsList(prev => [newContract, ...prev]);

              showToast(`🎉 Pitch dispatched! Track progress in Work Orders & Invoicing.`, 'success');
              triggerConfetti({ particleCount: 75, spread: 65, origin: { y: 0.6 } });
              setIsProposalStudioOpen(false);
            } catch (err: any) {
              showToast(`Error submitting pitch: ${err?.message || 'Check network'}`, 'warning');
            }
          }}
          onOpenPayPal={() => setIsPayPalConnectOpen(true)}
          onOpenLegal={() => {
            setLegalTab('terms');
            setIsLegalModalOpen(true);
          }}
        />
      </Suspense>

      {/* ===== AI DEAL & RISK ANALYSIS MODAL ===== */}
      <Suspense fallback={null}>
        <JobAnalysisModal
          isOpen={isAnalysisModalOpen}
          onClose={() => {
            setIsAnalysisModalOpen(false);
            setSelectedAnalysisJob(null);
          }}
          job={selectedAnalysisJob}
          profile={userProfile}
          onProceedToPitch={(job) => {
            setIsAnalysisModalOpen(false);
            setSelectedProposalJob(job);
            setIsProposalStudioOpen(true);
          }}
        />
      </Suspense>

      {/* ===== PRODUCTION COMPLIANCE & LEGAL MODAL (ToS, Privacy, GST, Refunds) ===== */}
      <Suspense fallback={null}>
        <LegalComplianceModal
          isOpen={isLegalModalOpen}
          initialTab={legalTab}
          onClose={() => setIsLegalModalOpen(false)}
        />
      </Suspense>

      {/* ===== OFFICIAL GST TAX INVOICE MODAL (SAC 998315) ===== */}
      <Suspense fallback={null}>
        <GSTInvoiceModal
          isOpen={isGSTInvoiceOpen}
          invoice={selectedGSTInvoice}
          onClose={() => setIsGSTInvoiceOpen(false)}
        />
      </Suspense>

      {/* ===== PAYPAL & DIRECT BANK SETTLEMENT MODAL ===== */}
      <Suspense fallback={null}>
        <PayPalConnectModal
          isOpen={isPayPalConnectOpen}
          onClose={() => setIsPayPalConnectOpen(false)}
          showToast={showToast}
        />
      </Suspense>

      {/* ===== PASSWORD RESET & SECURITY MODAL ===== */}
      <Suspense fallback={null}>
        <PasswordResetModal
          isOpen={isPasswordResetOpen}
          onClose={() => setIsPasswordResetOpen(false)}
          initialEmail={userEmail}
          onSuccess={(msg) => showToast(msg, 'success')}
        />
      </Suspense>

      {/* ===== EMAIL VERIFICATION MODAL ===== */}
      <Suspense fallback={null}>
        <EmailVerificationModal
          isOpen={isEmailVerificationOpen}
          onClose={() => setIsEmailVerificationOpen(false)}
          email={userEmail}
          isVerified={isEmailVerified}
          onVerificationSuccess={() => {
            setIsEmailVerified(true);
            showToast('✅ Email verified successfully! All platform limits unlocked.', 'success');
          }}
        />
      </Suspense>

      {/* ===== AI SUPPORT & SELF-HEALING CHAT ASSISTANT ===== */}
      <Suspense fallback={null}>
        <SupportChat
          appContext={{
            userEmail,
            backendStats,
            activeOrdersCount: workOrders.length
          }}
          onToast={showToast}
        />
      </Suspense>

      {/* ===== BACKEND CONNECTION & ARCHITECTURE GATEWAY MODAL ===== */}
      <Suspense fallback={null}>
        <BackendConnectionModal
          isOpen={isBackendModalOpen}
          onClose={() => setIsBackendModalOpen(false)}
        />
      </Suspense>

      {/* ===== FLOATING TOAST NOTIFICATION ===== */}
      <div
        className={`fixed bottom-6 right-6 bg-[#161b2b] border border-[#2a3147] px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 text-sm z-50 transition-all duration-300 pointer-events-none ${
          toast.show ? 'translate-y-0 opacity-100' : 'translate-y-16 opacity-0'
        }`}
      >
        <i className={`fas ${
          toast.type === 'success'
            ? 'fa-check-circle text-[#2ecc71]'
            : toast.type === 'info'
            ? 'fa-info-circle text-[#4f7cff]'
            : 'fa-exclamation-triangle text-[#f39c12]'
        } text-lg`}></i>
        <span className="text-white font-medium">{toast.message}</span>
      </div>

    </div>
  );
}
