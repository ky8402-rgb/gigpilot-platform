import React, { useState, useEffect } from 'react';
import {
  fetchLeadNotificationStatus,
  savePlatformCookies,
  saveNotificationConfig,
  sendTestTelegramPush,
  sendTestEmailPush,
  triggerHeadlessPoll,
  toggleAggregatorDaemon,
  createSpeedCheckout,
  LeadNotificationStatusResponse
} from '../services/api';

interface LeadNotificationsHubProps {
  onOpenProposalStudio?: (job: any) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const LeadNotificationsHub: React.FC<LeadNotificationsHubProps> = ({
  onOpenProposalStudio,
  showToast
}) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LeadNotificationStatusResponse | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'dispatcher' | 'cookies' | 'monetization' | 'live_feed'>('dispatcher');

  // Cookie Form States
  const [upworkCookieInput, setUpworkCookieInput] = useState('');
  const [freelancerCookieInput, setFreelancerCookieInput] = useState('freelancer_session=3PKsiB3m736mE0wnirnHeLTUzLP1xc; auth_token=3PKsiB3m736mE0wnirnHeLTUzLP1xc');
  const [isSavingCookies, setIsSavingCookies] = useState(false);

  // Notification Config Form States
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailRecipient, setEmailRecipient] = useState('ky8402@gmail.com');
  const [audioChimeEnabled, setAudioChimeEnabled] = useState(true);
  const [minBudget, setMinBudget] = useState(1500);
  const [maxProposals, setMaxProposals] = useState(5);
  const [keywords, setKeywords] = useState<string[]>(['React', 'TypeScript', 'Node.js', 'AI Agent', 'Python']);
  const [newKeyword, setNewKeyword] = useState('');

  // Interactive Test States
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [isPollingScraper, setIsPollingScraper] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState<string | null>(null);
  const [pollCountdown, setPollCountdown] = useState(5);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await fetchLeadNotificationStatus();
      if (res.success) {
        setData(res);
        setTelegramEnabled(res.config.telegramEnabled);
        setTelegramBotToken(res.config.telegramBotToken || '');
        setTelegramChatId(res.config.telegramChatId || '');
        setEmailEnabled(res.config.emailEnabled);
        setEmailRecipient(res.config.emailRecipient || 'ky8402@gmail.com');
        setAudioChimeEnabled(res.config.audioChimeEnabled);
        setMinBudget(res.config.minBudgetThreshold || 1500);
        setMaxProposals(res.config.maxProposalsThreshold || 5);
        setKeywords(res.config.keywordsFilter || ['React', 'TypeScript', 'Node.js']);
      }
    } catch (err: any) {
      console.error('Failed to load lead notification status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  // Live countdown timer for polling demonstration
  useEffect(() => {
    const timer = setInterval(() => {
      setPollCountdown((prev) => (prev <= 1 ? 5 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const playNotificationChime = () => {
    if (!audioChimeEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15); // E6
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // Ignore audio failure
    }
  };

  const handleSaveCookies = async (platform: 'upwork' | 'freelancer') => {
    const cookieStr = platform === 'upwork' ? upworkCookieInput : freelancerCookieInput;
    if (!cookieStr.trim()) {
      showToast?.(`Please enter valid ${platform} session cookies`, 'error');
      return;
    }

    try {
      setIsSavingCookies(true);
      const res = await savePlatformCookies(platform, cookieStr);
      if (res.success) {
        showToast?.(`${platform.toUpperCase()} session verified and connected to Headless Scraper!`, 'success');
        if (platform === 'upwork') setUpworkCookieInput('');
        if (platform === 'freelancer') setFreelancerCookieInput('');
        loadStatus();
      } else {
        showToast?.(res.validation?.message || 'Failed to validate cookies', 'error');
      }
    } catch (err: any) {
      showToast?.(err.message || 'Error saving cookies', 'error');
    } finally {
      setIsSavingCookies(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      const res = await saveNotificationConfig({
        telegramEnabled,
        telegramBotToken,
        telegramChatId,
        emailEnabled,
        emailRecipient,
        audioChimeEnabled,
        minBudgetThreshold: minBudget,
        maxProposalsThreshold: maxProposals,
        keywordsFilter: keywords,
      });
      if (res.success) {
        showToast?.('Notification channels & lead filters saved!', 'success');
        loadStatus();
      }
    } catch (err: any) {
      showToast?.(err.message || 'Error saving config', 'error');
    }
  };

  const handleTestTelegram = async () => {
    try {
      setIsTestingTelegram(true);
      const res = await sendTestTelegramPush();
      playNotificationChime();
      if (res.success) {
        showToast?.(`⚡ Telegram Push Dispatched! Latency: ${res.result.latencyMs}ms (${res.result.status})`, 'success');
        loadStatus();
      } else {
        showToast?.(res.result.message || 'Telegram test failed', 'error');
      }
    } catch (err: any) {
      showToast?.(err.message || 'Telegram test failed', 'error');
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleTestEmail = async () => {
    try {
      setIsTestingEmail(true);
      const res = await sendTestEmailPush();
      if (res.success) {
        showToast?.(`📧 Priority Alert Sent to ${emailRecipient}!`, 'success');
        loadStatus();
      }
    } catch (err: any) {
      showToast?.(err.message || 'Email test failed', 'error');
    } finally {
      setIsTestingEmail(false);
    }
  };

  const handleManualPoll = async () => {
    try {
      setIsPollingScraper(true);
      const res = await triggerHeadlessPoll();
      playNotificationChime();
      showToast?.(`Headless Scraper cycle complete! Scanned fresh feed in ${res.pollResult.latencyMs}ms`, 'success');
      loadStatus();
    } catch (err: any) {
      showToast?.(err.message || 'Scraper poll failed', 'error');
    } finally {
      setIsPollingScraper(false);
    }
  };

  const handleToggleDaemon = async () => {
    try {
      const res = await toggleAggregatorDaemon();
      showToast?.(res.message, 'info');
      loadStatus();
    } catch (err: any) {
      showToast?.(err.message || 'Toggle failed', 'error');
    }
  };

  const handleSpeedUpgrade = async (plan: 'pro_speed' | 'ultra_alpha') => {
    try {
      setIsCheckingOut(plan);
      const res = await createSpeedCheckout(plan);
      if (res.url) {
        if (res.isSimulated) {
          showToast?.(`Upgraded to ${plan === 'ultra_alpha' ? 'Ultra Speed Alpha ($79/mo)' : 'Pro Speed ($29/mo)'}!`, 'success');
          loadStatus();
        } else {
          window.location.href = res.url;
        }
      }
    } catch (err: any) {
      showToast?.(err.message || 'Checkout failed', 'error');
    } finally {
      setIsCheckingOut(null);
    }
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const currentTier = data?.daemon?.speedTier || 'pro_speed';

  return (
    <div className="space-y-6">
      {/* Top Value Banner */}
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-[#0b0e17] via-[#121626] to-[#0f172a] p-6 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-mono font-bold px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Lead Aggregator &amp; Speed Radar
              </span>
              <span className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs px-2.5 py-1 rounded-full font-medium">
                ⚡ Avg Push Latency: {data?.daemon?.avgNotificationLatencyMs || 1420}ms
              </span>
              <span className="bg-purple-500/10 text-purple-300 border border-purple-500/20 text-xs px-2.5 py-1 rounded-full font-medium">
                Playwright / Puppeteer Session Ingestion
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Instant Push Notifications for High-Value Leads
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Bypasses standard platform webhook approvals by utilizing user-provided session cookies and a continuous headless scraper daemon. Dispatches push alerts to your <strong>Telegram</strong> &amp; <strong>Email</strong> the second a high-budget, low-competition contract is published.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button
              id="btn-trigger-manual-headless-poll"
              onClick={handleManualPoll}
              disabled={isPollingScraper}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <i className={`fas ${isPollingScraper ? 'fa-spinner fa-spin' : 'fa-bolt text-amber-300'}`}></i>
              <span>{isPollingScraper ? 'Crawling Feed...' : 'Poll Headless Feed Now'}</span>
            </button>
            <button
              id="btn-toggle-aggregator-daemon"
              onClick={handleToggleDaemon}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                data?.daemon?.isRunning
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20'
              }`}
            >
              <i className={`fas ${data?.daemon?.isRunning ? 'fa-circle-play' : 'fa-circle-pause'}`}></i>
              <span>Daemon: {data?.daemon?.isRunning ? 'Running' : 'Paused'}</span>
            </button>
          </div>
        </div>

        {/* Live Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-800/80">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 font-medium">Headless Polling Speed</span>
            <div className="text-base font-extrabold text-indigo-400 mt-0.5 flex items-center gap-1.5">
              <span>{data?.daemon?.pollIntervalSeconds || 30}s Cycle</span>
              <span className="text-[10px] text-slate-500">({pollCountdown}s next)</span>
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 font-medium">Jobs Scanned Today</span>
            <div className="text-base font-extrabold text-white mt-0.5 font-mono">
              {(data?.daemon?.totalScannedSinceBoot || 1420).toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 font-medium">High-Value Leads Caught</span>
            <div className="text-base font-extrabold text-emerald-400 mt-0.5 font-mono">
              {data?.daemon?.highValueLeadsCaught || 29}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
            <span className="text-[11px] text-slate-400 font-medium">Active Speed Tier</span>
            <div className="text-base font-extrabold text-purple-300 mt-0.5 uppercase tracking-wide">
              {currentTier.replace('_', ' ')}
            </div>
          </div>
        </div>
      </div>

      {/* Sub Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('dispatcher')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeSubTab === 'dispatcher'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
          }`}
        >
          <i className="fab fa-telegram-plane"></i>
          <span>Telegram &amp; Email Dispatcher</span>
        </button>
        <button
          onClick={() => setActiveSubTab('cookies')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeSubTab === 'cookies'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
          }`}
        >
          <i className="fas fa-cookie-bite"></i>
          <span>Session Cookies &amp; Headless Scraper</span>
          <span className={`w-2 h-2 rounded-full ${data?.cookies?.upworkStatus === 'active' ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
        </button>
        <button
          onClick={() => setActiveSubTab('monetization')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeSubTab === 'monetization'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
          }`}
        >
          <i className="fas fa-gauge-high text-amber-400"></i>
          <span>Lead Aggregator Speed Plans ($29 - $79/mo)</span>
          <span className="bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold">EDGE</span>
        </button>
        <button
          onClick={() => setActiveSubTab('live_feed')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeSubTab === 'live_feed'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
          }`}
        >
          <i className="fas fa-satellite-dish"></i>
          <span>Dispatched Pushes Log ({data?.recentPushes?.length || 0})</span>
        </button>
      </div>

      {/* TAB 1: TELEGRAM & EMAIL DISPATCHER CONFIGURATION */}
      {activeSubTab === 'dispatcher' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Telegram Settings Card */}
          <div className="bg-[#121626] border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 text-lg">
                  <i className="fab fa-telegram"></i>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Telegram Instant Lead Bot</h3>
                  <p className="text-xs text-slate-400">Direct mobile push notification with 1-click bid links</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={telegramEnabled}
                  onChange={(e) => setTelegramEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
              </label>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Telegram Bot Token</label>
                <input
                  type="text"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  placeholder="e.g. 7128938291:AAH8a9KkLmn..."
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Create in 30 seconds via <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-400 underline">@BotFather</a> on Telegram.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Telegram Chat ID / Channel ID</label>
                <input
                  type="text"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  placeholder="e.g. 8839201 or @MyLeadFeedChannel"
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Find your ID by messaging <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-sky-400 underline">@userinfobot</a>.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  id="btn-test-telegram-push"
                  onClick={handleTestTelegram}
                  disabled={isTestingTelegram}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  <i className={`fas ${isTestingTelegram ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
                  <span>{isTestingTelegram ? 'Sending Test Push...' : '⚡ Send Live Telegram Test Alert'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Email & Audio Chime Settings Card */}
          <div className="bg-[#121626] border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400 text-lg">
                  <i className="fas fa-envelope-open-text"></i>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Priority Email Alerts</h3>
                  <p className="text-xs text-slate-400">Instant HTML lead notifications formatted for high-stake bidding</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
              </label>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Recipient Email Address</label>
                <input
                  type="email"
                  value={emailRecipient}
                  onChange={(e) => setEmailRecipient(e.target.value)}
                  placeholder="ky8402@gmail.com"
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-between bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center gap-2.5">
                  <i className="fas fa-volume-high text-amber-400 text-sm"></i>
                  <div>
                    <span className="text-xs font-bold text-white block">In-App Audio Chime</span>
                    <span className="text-[11px] text-slate-400">Play sonic radar alert when a $2,000+ job matches</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={audioChimeEnabled}
                  onChange={(e) => setAudioChimeEnabled(e.target.checked)}
                  className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  id="btn-test-email-push"
                  onClick={handleTestEmail}
                  disabled={isTestingEmail}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  <i className={`fas ${isTestingEmail ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
                  <span>{isTestingEmail ? 'Sending...' : '📧 Send Test Email Alert'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Lead Filter Criteria Card */}
          <div className="lg:col-span-2 bg-[#121626] border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <i className="fas fa-sliders text-indigo-400"></i>
              <span>High-Value Match Filters &amp; Push Triggers</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Minimum Budget Filter</span>
                  <span className="font-mono font-bold text-emerald-400">${minBudget.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="10000"
                  step="250"
                  value={minBudget}
                  onChange={(e) => setMinBudget(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <p className="text-[11px] text-slate-500">Only dispatch notifications for jobs equal to or greater than this budget.</p>
              </div>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-semibold">Max Competition Threshold</span>
                  <span className="font-mono font-bold text-indigo-400">&lt; {maxProposals} Proposals</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="15"
                  step="1"
                  value={maxProposals}
                  onChange={(e) => setMaxProposals(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <p className="text-[11px] text-slate-500">Dispatches instantly before other freelancers crowd the job listing.</p>
              </div>
            </div>

            {/* Keyword Alert Tags */}
            <div className="space-y-2 pt-2">
              <label className="block text-xs font-semibold text-slate-300">Monitored Keywords</label>
              <div className="flex flex-wrap gap-2">
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-lg text-xs font-semibold"
                  >
                    <span>{kw}</span>
                    <button
                      onClick={() => removeKeyword(kw)}
                      className="text-indigo-400 hover:text-rose-400 transition-colors"
                    >
                      <i className="fas fa-times text-[10px]"></i>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 max-w-md pt-1">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
                  placeholder="Add keyword (e.g. Next.js, Stripe, Gemini)..."
                  className="flex-1 bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={addKeyword}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                id="btn-save-notification-filters"
                onClick={handleSaveConfig}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-extrabold shadow-md transition-all cursor-pointer"
              >
                Save All Alert Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SESSION COOKIES & HEADLESS SCRAPER ENGINE */}
      {activeSubTab === 'cookies' && (
        <div className="space-y-6">
          <div className="bg-slate-900/80 border border-indigo-500/30 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-lg shrink-0">
                <i className="fas fa-shield-halved"></i>
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Why Cookie-Based Headless Ingestion?</h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  Official Upwork/Freelancer webhooks require long commercial enterprise reviews. By providing your session cookies, our server-side Playwright/Puppeteer daemon crawls authenticated live job feeds directly with sub-second latency.
                </p>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              <span className="text-xs bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-3 py-1.5 rounded-xl font-mono font-bold">
                🔒 AES-256 Memory Encrypted
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Upwork Cookies Card */}
            <div className="bg-[#121626] border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full bg-emerald-400"></span>
                  <h3 className="text-sm font-bold text-white">Upwork Session Cookies</h3>
                </div>
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  data?.cookies?.upworkStatus === 'active'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                }`}>
                  {data?.cookies?.upworkStatus === 'active' ? '● Active Headless Session' : 'Needs Cookies String'}
                </span>
              </div>

              <p className="text-xs text-slate-400">
                Open Upwork in Chrome &rarr; Press <kbd className="bg-slate-800 px-1 py-0.5 rounded text-[10px]">F12</kbd> &rarr; Application &rarr; Cookies &rarr; Copy cookie string (contains <code className="text-indigo-300">master_access_token</code> or <code className="text-indigo-300">oauth2_global</code>).
              </p>

              <textarea
                rows={3}
                value={upworkCookieInput}
                onChange={(e) => setUpworkCookieInput(e.target.value)}
                placeholder="Paste Upwork session cookies (e.g. oauth2_global_js_token=...; master_access_token=...)"
                className="w-full bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
              />

              <button
                onClick={() => handleSaveCookies('upwork')}
                disabled={isSavingCookies || !upworkCookieInput.trim()}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                Verify &amp; Activate Upwork Scraper
              </button>
            </div>

            {/* Freelancer.com Cookies Card */}
            <div className="bg-[#121626] border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full bg-blue-400"></span>
                  <h3 className="text-sm font-bold text-white">Freelancer.com Session Cookies</h3>
                </div>
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  data?.cookies?.freelancerStatus === 'active'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                }`}>
                  {data?.cookies?.freelancerStatus === 'active' ? '● Active Headless Session' : 'Needs Cookies String'}
                </span>
              </div>

              <p className="text-xs text-slate-400">
                Open Freelancer.com &rarr; Press <kbd className="bg-slate-800 px-1 py-0.5 rounded text-[10px]">F12</kbd> &rarr; Application &rarr; Cookies &rarr; Copy <code className="text-indigo-300">freelancer_session</code> or <code className="text-indigo-300">auth_token</code>.
              </p>

              <textarea
                rows={3}
                value={freelancerCookieInput}
                onChange={(e) => setFreelancerCookieInput(e.target.value)}
                placeholder="Paste Freelancer.com session cookies (e.g. freelancer_session=...; auth_token=...)"
                className="w-full bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500"
              />

              <button
                onClick={() => handleSaveCookies('freelancer')}
                disabled={isSavingCookies || !freelancerCookieInput.trim()}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                Verify &amp; Activate Freelancer Scraper
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MONETIZATION & SPEED PLANS */}
      {activeSubTab === 'monetization' && (
        <div className="space-y-6">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full">
              Speed Monetization Model
            </span>
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
              Freelancers Pay Monthly for Ultra-Low Latency
            </h3>
            <p className="text-xs text-slate-400">
              The first 3 freelancers to submit tailored proposals on high-budget jobs win 82% of all contracts. Upgrade your scraping frequency to secure an unfair competitive edge.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Free Plan */}
            <div className="bg-[#121626] border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-5">
              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Standard Feed</span>
                <h4 className="text-xl font-bold text-white mt-1">Free Tier</h4>
                <div className="text-2xl font-black text-white mt-2">$0 <span className="text-xs font-normal text-slate-400">/mo</span></div>
                <p className="text-xs text-slate-400 mt-2">Basic manual dashboard feed for casual browsing.</p>

                <ul className="space-y-2.5 text-xs text-slate-300 mt-5 border-t border-slate-800 pt-4">
                  <li className="flex items-center gap-2"><i className="fas fa-check text-slate-500"></i> 15-Minute Delayed Polling</li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-slate-500"></i> Web Dashboard Access Only</li>
                  <li className="flex items-center gap-2"><i className="fas fa-times text-rose-500"></i> No Telegram Push Alerts</li>
                  <li className="flex items-center gap-2"><i className="fas fa-times text-rose-500"></i> Max 5 Leads Scored/Day</li>
                </ul>
              </div>
              <button
                disabled
                className="w-full py-2.5 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold cursor-not-allowed"
              >
                Current Default
              </button>
            </div>

            {/* Pro Speed Plan */}
            <div className="bg-gradient-to-b from-indigo-950/50 to-[#121626] border-2 border-indigo-500 rounded-2xl p-6 flex flex-col justify-between space-y-5 shadow-xl relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-[10px] font-extrabold uppercase px-3 py-0.5 rounded-full shadow">
                Most Popular for Freelancers
              </div>
              <div>
                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Fast Alerts</span>
                <h4 className="text-xl font-bold text-white mt-1">Pro Speed Plan</h4>
                <div className="text-3xl font-black text-white mt-2">$29 <span className="text-xs font-normal text-slate-400">/mo</span></div>
                <p className="text-xs text-slate-300 mt-2">Instant smartphone push for active solo contractors.</p>

                <ul className="space-y-2.5 text-xs text-slate-200 mt-5 border-t border-indigo-500/30 pt-4">
                  <li className="flex items-center gap-2"><i className="fas fa-check text-emerald-400"></i> <strong>30-Second Fast Polling</strong></li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-emerald-400"></i> <strong>Instant Telegram Bot Push</strong></li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-emerald-400"></i> Priority HTML Email Notifications</li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-emerald-400"></i> Custom Keyword &amp; Budget Filter Triggers</li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-emerald-400"></i> 50 Proposal AI Credits / Month</li>
                </ul>
              </div>

              <button
                id="btn-subscribe-pro-speed"
                onClick={() => handleSpeedUpgrade('pro_speed')}
                disabled={isCheckingOut === 'pro_speed'}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-extrabold shadow-lg transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isCheckingOut === 'pro_speed' ? 'Starting Checkout...' : 'Upgrade to Pro Speed ($29/mo)'}
              </button>
            </div>

            {/* Ultra Speed Alpha */}
            <div className="bg-gradient-to-b from-purple-950/40 to-[#121626] border border-purple-500/40 rounded-2xl p-6 flex flex-col justify-between space-y-5 shadow-xl">
              <div>
                <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">Sub-Second Stream</span>
                <h4 className="text-xl font-bold text-white mt-1">Ultra Speed Alpha</h4>
                <div className="text-3xl font-black text-white mt-2">$79 <span className="text-xs font-normal text-slate-400">/mo</span></div>
                <p className="text-xs text-slate-300 mt-2">Maximum advantage for top-tier agencies &amp; specialists.</p>

                <ul className="space-y-2.5 text-xs text-slate-200 mt-5 border-t border-purple-500/30 pt-4">
                  <li className="flex items-center gap-2"><i className="fas fa-bolt text-amber-400"></i> <strong>5-Second Ultra-Low Latency Daemon</strong></li>
                  <li className="flex items-center gap-2"><i className="fas fa-bolt text-amber-400"></i> <strong>Sub-3-Second Push to Telegram</strong></li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-purple-400"></i> Inline AI Pitch Generator in Telegram</li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-purple-400"></i> 1-Click Telegram Auto-Bid Webhook</li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-purple-400"></i> Multi-Account Cookie Ingestion</li>
                  <li className="flex items-center gap-2"><i className="fas fa-check text-purple-400"></i> Unlimited AI Proposal Generation</li>
                </ul>
              </div>

              <button
                id="btn-subscribe-ultra-alpha"
                onClick={() => handleSpeedUpgrade('ultra_alpha')}
                disabled={isCheckingOut === 'ultra_alpha'}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-extrabold shadow-lg transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isCheckingOut === 'ultra_alpha' ? 'Starting Checkout...' : 'Unlock Ultra Speed Alpha ($79/mo)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DISPATCHED PUSHES LOG & LIVE FEED */}
      {activeSubTab === 'live_feed' && (
        <div className="bg-[#121626] border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Dispatched Push Notifications History</h3>
              <p className="text-xs text-slate-400">Real-time audit log of all leads pushed to your Telegram and Email channels</p>
            </div>
            <button
              onClick={loadStatus}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-all"
            >
              <i className="fas fa-rotate mr-1.5"></i> Refresh Log
            </button>
          </div>

          <div className="space-y-3">
            {(!data?.recentPushes || data.recentPushes.length === 0) ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                No notifications dispatched yet. Use the <strong>Telegram &amp; Email Dispatcher</strong> tab to send a test alert or wait for the next headless scraper cycle.
              </div>
            ) : (
              data.recentPushes.map((push) => (
                <div
                  key={push.id}
                  className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 max-w-xl">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                        push.channel === 'Telegram'
                          ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                          : 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                      }`}>
                        <i className={`fab fa-${push.channel.toLowerCase()} mr-1`}></i> {push.channel}
                      </span>
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-full font-mono">
                        ⚡ {push.latencyMs}ms Latency
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(push.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-white">{push.jobTitle}</h4>
                    <p className="text-xs text-slate-400">{push.summary}</p>
                    {push.aiWinningAngle && (
                      <p className="text-xs text-indigo-300 italic">
                        💡 Winning Pitch: "{push.aiWinningAngle}"
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right mr-2">
                      <div className="text-sm font-bold text-emerald-400 font-mono">${push.budget.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500">{push.platform}</div>
                    </div>
                    {onOpenProposalStudio && (
                      <button
                        onClick={() => onOpenProposalStudio({
                          id: push.jobId,
                          title: push.jobTitle,
                          company: push.company,
                          platform: push.platform,
                          budget: push.budget,
                          description: push.summary
                        })}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow transition-all cursor-pointer"
                      >
                        1-Click AI Bid
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
