import React, { useState, useEffect, useCallback } from 'react';
import { BackendLeadItem, BACKEND_BASE_URL } from '../services/api';
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
      let response = await fetch(`${BACKEND_BASE_URL}/api/leads?limit=20`);
      if (!response.ok && response.status === 404) {
        response = await fetch(`/api/leads?limit=20`);
      }
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: Failed to fetch leads`);
      }
      const data = await response.json();
      const rawList = Array.isArray(data) ? data : (data.leads || []);
      setLeads(rawList);
      setLastUpdated(new Date());
      setSecondsUntilRefresh(60);
    } catch (err: any) {
      console.warn('[LeadsTable] Backend fetch failed:', err);
      try {
        const localRes = await fetch(`/api/leads?limit=20`);
        if (localRes.ok) {
          const localData = await localRes.json();
          const list = Array.isArray(localData) ? localData : (localData.leads || []);
          if (list.length > 0) {
            setLeads(list);
            setLastUpdated(new Date());
            setSecondsUntilRefresh(60);
            setLoading(false);
            return;
          }
        }
      } catch {}
      setError(err?.message || 'Failed to load leads from backend. Service may be starting up.');
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

  const filteredLeads = leads.filter((lead) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    const title = (lead.job_title || lead.title || '').toLowerCase();
    const company = (lead.company || '').toLowerCase();
    const source = (lead.source || '').toLowerCase();
    const matchedPkg = (lead.matched_package || lead.package || '').toLowerCase();
    return title.includes(query) || company.includes(query) || source.includes(query) || matchedPkg.includes(query);
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
      <div className="flex items-center justify-between gap-3 mb-4">
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
              <th className="py-3 px-4 font-bold">Source</th>
              <th className="py-3 px-4 font-bold">Matched Package</th>
              <th className="py-3 px-4 font-bold">Found At</th>
            </tr>
          </thead>
          <tbody id="leads-table-body" className="divide-y divide-[#1e293b]/60">
            {loading && leads.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <i className="fas fa-circle-notch fa-spin text-indigo-400 text-xl"></i>
                    <span className="text-xs">Connecting to {BACKEND_BASE_URL}/api/leads...</span>
                  </div>
                </td>
              </tr>
            ) : filteredLeads.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-slate-500 text-xs">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <i className="fas fa-radar text-slate-600 text-2xl mb-1"></i>
                    <p className="font-semibold text-slate-400">No leads found.</p>
                    <p className="text-[11px] text-slate-500">The remote feed scraper is gathering fresh opportunities.</p>
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

                return (
                  <tr
                    key={lead.id || `lead-${index}`}
                    onClick={() => onSelectLead && onSelectLead(lead)}
                    className="hover:bg-[#161e31]/80 transition-colors group cursor-pointer"
                  >
                    <td className="py-3.5 px-4 font-medium text-white max-w-[280px]">
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
