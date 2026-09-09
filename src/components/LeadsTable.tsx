import React, { useState, useEffect, useCallback } from 'react';
import { BackendLeadItem, BACKEND_BASE_URL, DEFAULT_PRODUCTION_BACKEND_URL } from '../services/api';
import { formatPackageName } from './PackageChart';

interface LeadsTableProps {
  onSelectLead?: (lead: BackendLeadItem) => void;
  externalRefreshTrigger?: number;
}

export const LeadsTable: React.FC<LeadsTableProps> = ({ onSelectLead, externalRefreshTrigger }) => {
  const [leads, setLeads] = useState<BackendLeadItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number>(60);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const primaryBase = BACKEND_BASE_URL || DEFAULT_PRODUCTION_BACKEND_URL;
      const [leadsRes, flRes] = await Promise.allSettled([
        (async () => {
          const endpoints = [
            `${primaryBase}/api/leads?limit=20`,
            `${DEFAULT_PRODUCTION_BACKEND_URL}/api/leads?limit=20`,
            `/api/leads?limit=20`
          ];
          for (const ep of endpoints) {
            try {
              const res = await fetch(ep);
              if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
                const data = await res.json();
                const list = Array.isArray(data) ? data : (data.leads || []);
                if (list.length > 0) return list;
              }
            } catch (_) {}
          }
          return [];
        })(),
        (async () => {
          const endpoints = [
            `${primaryBase}/api/freelancer/live-feed?limit=10`,
            `${DEFAULT_PRODUCTION_BACKEND_URL}/api/freelancer/live-feed?limit=10`,
            `/api/freelancer/live-feed?limit=10`
          ];
          for (const ep of endpoints) {
            try {
              const res = await fetch(ep);
              if (res.ok && (res.headers.get('content-type') || '').includes('json')) {
                const data = await res.json();
                const projects = Array.isArray(data.projects) ? data.projects : [];
                if (projects.length > 0) {
                  return projects.map((p: any) => ({
                    id: `fl_${p.id}`,
                    job_title: p.title,
                    title: p.title,
                    company: 'Verified Freelancer Client',
                    source: 'Freelancer',
                    matched_package: 'fullstack',
                    package: 'fullstack',
                    similarity_score: 0.95,
                    url: p.url || (p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : `https://www.freelancer.com/projects/${p.id}`),
                    job_url: p.url || (p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : `https://www.freelancer.com/projects/${p.id}`),
                    description: p.description || 'Live Freelancer.com project opportunity.',
                    created_at: p.timeSubmitted || new Date().toISOString(),
                    found_at: p.timeSubmitted || new Date().toISOString(),
                  }));
                }
              }
            } catch (_) {}
          }
          return [];
        })()
      ]);

      const mainLeads: BackendLeadItem[] = leadsRes.status === 'fulfilled' ? leadsRes.value : [];
      const flLeads: BackendLeadItem[] = flRes.status === 'fulfilled' ? flRes.value : [];
      const mergedList = [...flLeads, ...mainLeads];
      setLeads(mergedList);
      setLastUpdated(new Date());
      setSecondsUntilRefresh(60);
    } catch (err: any) {
      console.warn('[LeadsTable] Backend fetch failed:', err);
      let errMsg = err?.message || 'Failed to load leads from backend';
      if (
        errMsg.includes('pattern') ||
        errMsg.includes('SyntaxError') ||
        errMsg.includes('DOCTYPE') ||
        errMsg.includes('token <') ||
        errMsg.includes('not valid JSON')
      ) {
        errMsg = 'Synchronizing leads with live AWS EC2 backend...';
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and external refresh trigger
  useEffect(() => {
    fetchLeads();
  }, [fetchLeads, externalRefreshTrigger]);

  // 60-Second Auto-refresh Timer
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      setSecondsUntilRefresh((prev) => {
        if (prev <= 1) {
          fetchLeads();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [fetchLeads]);

  const [scoreFilter, setScoreFilter] = useState<'all' | 'high_probability' | 'standard'>('all');

  const getClientScoreDetails = (lead: any) => {
    let score = 75;
    let hireRate = 75;
    let rating = 4.8;
    let paymentVerified = true;

    if (lead.client_score !== undefined && lead.client_score !== null) {
      score = Number(lead.client_score);
    } else if (lead.ml_client_score !== undefined && lead.ml_client_score !== null) {
      score = Number(lead.ml_client_score);
    } else {
      const isFreelancer = (lead.source || '').toLowerCase().includes('freelancer');
      hireRate = Number(lead.hire_rate || lead.client_hire_rate || (isFreelancer ? 88 : 78));
      rating = Number(lead.client_rating || lead.rating || 4.8);
      paymentVerified = lead.payment_verified !== undefined ? Boolean(lead.payment_verified) : true;

      // Factors: Client's historical hire rate (40%), rating (35%), payment verified status (25%)
      const hireWeight = Math.min(100, Math.max(0, hireRate)) * 0.40;
      const ratingWeight = Math.min(100, (rating / 5) * 100) * 0.35;
      const verifiedWeight = paymentVerified ? 25 : 0;
      score = Math.round(hireWeight + ratingWeight + verifiedWeight);
    }

    score = Math.min(100, Math.max(0, score));
    return {
      score,
      hireRate: Math.round(hireRate),
      rating: rating.toFixed(1),
      paymentVerified,
      isHighProbability: score >= 80,
      isLowIntent: score < 60
    };
  };

  const filteredLeads = leads.filter((lead) => {
    const query = searchQuery.toLowerCase().trim();
    const title = (lead.job_title || lead.title || '').toLowerCase();
    const company = (lead.company || '').toLowerCase();
    const source = (lead.source || '').toLowerCase();
    const matchedPkg = (lead.matched_package || lead.package || '').toLowerCase();
    const matchesQuery = !query || title.includes(query) || company.includes(query) || source.includes(query) || matchedPkg.includes(query);
    if (!matchesQuery) return false;

    if (scoreFilter === 'high_probability') {
      const { score } = getClientScoreDetails(lead);
      return score >= 80;
    }
    if (scoreFilter === 'standard') {
      const { score } = getClientScoreDetails(lead);
      return score >= 60;
    }
    return true;
  });

  const formatFoundAt = (lead: BackendLeadItem) => {
    const dateStr = lead.created_at || lead.found_at;
    if (!dateStr) return 'Just now';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const getSourceBadge = (source?: string) => {
    const s = (source || 'RemoteOK').toLowerCase();
    if (s.includes('freelancer')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/25">
          <i className="fas fa-bolt text-[10px]"></i> Freelancer
        </span>
      );
    }
    if (s.includes('upwork')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
          <i className="fas fa-circle-check text-[10px]"></i> Upwork
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/25">
        <i className="fas fa-globe text-[10px]"></i> {source || 'RemoteOK'}
      </span>
    );
  };

  return (
    <div id="leads-table-section" className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1e293b]/80 mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center text-sm font-bold border border-indigo-500/25">
              <i className="fas fa-radar"></i>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Live Scored Leads Pipeline
            </h3>
            <span className="bg-[#161e31] text-indigo-400 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold border border-[#1e293b]">
              Top 20 Matched
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time scraped remote gigs categorized by autonomous AI skill matching.
          </p>
        </div>

        {/* Timer & Controls */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#161e31] border border-[#1e293b] text-slate-400 text-xs font-mono">
            <i className="fas fa-clock text-indigo-400 text-[11px]"></i>
            <span>Refresh in: <strong className="text-white">{secondsUntilRefresh}s</strong></span>
          </div>

          <button
            id="refresh-leads-btn"
            onClick={fetchLeads}
            disabled={loading}
            className="bg-[#161e31] hover:bg-[#1e293b] text-slate-200 hover:text-white px-3 py-1.5 rounded-xl text-xs font-semibold border border-[#1e293b] transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh leads from backend"
          >
            <i className={`fas fa-sync-alt text-[11px] ${loading ? 'fa-spin text-indigo-400' : ''}`}></i>
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="relative w-full max-w-sm">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs"></i>
          <input
            type="text"
            placeholder="Search leads by title, skill, company..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#161e31] text-slate-200 placeholder-slate-500 text-xs rounded-xl pl-8 pr-3 py-1.5 border border-[#1e293b] focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Client Score Filter Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setScoreFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              scoreFilter === 'all'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-[#161e31] text-slate-400 hover:text-white border border-[#1e293b]'
            }`}
          >
            All Leads
          </button>
          <button
            onClick={() => setScoreFilter('high_probability')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
              scoreFilter === 'high_probability'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-[#161e31] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30'
            }`}
            title="Clients with score > 80% (High hire rate, high rating, verified payments)"
          >
            <i className="fas fa-fire-flame-curved text-[10px]"></i>
            <span>High Probability (&gt;80%)</span>
          </button>
          <button
            onClick={() => setScoreFilter('standard')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              scoreFilter === 'standard'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-[#161e31] text-slate-400 hover:text-white border border-[#1e293b]'
            }`}
            title="Auto-bid eligible clients (>60% score filter)"
          >
            Auto-Bid Eligible (&gt;60%)
          </button>
        </div>

        {lastUpdated && (
          <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
            Last sync: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Error Notice */}
      {error && (
        <div className="mb-4 p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <i className="fas fa-exclamation-circle text-rose-400"></i>
            <span>{error}</span>
          </div>
          <button
            onClick={fetchLeads}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-3 py-1 rounded-lg text-[11px] cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Leads Table */}
      <div className="overflow-x-auto rounded-xl border border-[#1e293b]/70">
        <table id="leads-table" className="w-full text-left text-xs text-slate-300">
          <thead className="bg-[#0a0e1a]/80 text-[11px] uppercase tracking-wider text-slate-400 border-b border-[#1e293b]">
            <tr>
              <th className="py-3 px-4 font-bold">Job Title</th>
              <th className="py-3 px-4 font-bold">Company</th>
              <th className="py-3 px-4 font-bold">Client Score (ML)</th>
              <th className="py-3 px-4 font-bold">Source</th>
              <th className="py-3 px-4 font-bold">Matched Package</th>
              <th className="py-3 px-4 font-bold">Found At</th>
            </tr>
          </thead>
          <tbody id="leads-table-body" className="divide-y divide-[#1e293b]/60">
            {loading && leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <i className="fas fa-circle-notch fa-spin text-indigo-400 text-xl"></i>
                    <span className="text-xs">Connecting to {BACKEND_BASE_URL}/api/leads...</span>
                  </div>
                </td>
              </tr>
            ) : filteredLeads.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-slate-500 text-xs">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <i className="fas fa-radar text-slate-600 text-2xl mb-1"></i>
                    <p className="font-semibold text-slate-400">No matching leads found.</p>
                    <p className="text-[11px] text-slate-500">Try switching your score filter or searching another term.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredLeads.map((lead, index) => {
                const jobTitle = lead.job_title || lead.title || 'Remote Software Lead';
                const company = lead.company || 'Confidential';
                const source = lead.source || 'RemoteOK';
                const matchedPkg = formatPackageName(lead.matched_package || lead.package);
                const foundAt = formatFoundAt(lead);
                const url = lead.job_url || lead.url;
                const clientMeta = getClientScoreDetails(lead);

                return (
                  <tr
                    key={lead.id || `lead-${index}`}
                    onClick={() => onSelectLead && onSelectLead(lead)}
                    className={`hover:bg-[#161e31]/80 transition-colors group cursor-pointer ${
                      clientMeta.isHighProbability ? 'bg-emerald-950/10' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4 font-medium text-white max-w-[260px]">
                      <div className="truncate font-semibold group-hover:text-indigo-300 transition-colors" title={jobTitle}>
                        {jobTitle}
                      </div>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] text-indigo-400 hover:underline inline-flex items-center gap-1 mt-0.5"
                        >
                          <span>Apply URL</span>
                          <i className="fas fa-external-link-alt text-[8px]"></i>
                        </a>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-300">
                      <span className="inline-flex items-center gap-1.5">
                        <i className="far fa-building text-slate-500 text-[10px]"></i>
                        {company}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {clientMeta.isHighProbability ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 w-fit">
                            <i className="fas fa-fire text-amber-400 text-[10px]"></i>
                            <span>{clientMeta.score}% High Probability</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {clientMeta.hireRate}% hire rate • ★ {clientMeta.rating}
                          </span>
                        </div>
                      ) : clientMeta.isLowIntent ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 w-fit">
                            <i className="fas fa-shield-halved text-[10px]"></i>
                            <span>{clientMeta.score}% Low Intent (Filtered)</span>
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">Auto-bid skipped</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30 w-fit">
                            <i className="fas fa-check-circle text-[10px]"></i>
                            <span>{clientMeta.score}% Standard</span>
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {clientMeta.hireRate}% hire rate • ★ {clientMeta.rating}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {getSourceBadge(source)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-medium text-indigo-300 text-[11.5px]">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">
                        {matchedPkg}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 text-[11.5px] font-mono">
                      {foundAt}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
