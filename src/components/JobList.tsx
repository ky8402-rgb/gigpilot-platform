import React, { useState, useEffect } from 'react';
import {
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  Clock,
  DollarSign,
  Search,
  Activity,
  Zap,
} from 'lucide-react';
import { getApiBaseUrl } from '../services/api';

export interface JobItem {
  id: string;
  title: string;
  description?: string;
  budget: number;
  status: string;
  external_id?: string | null;
  external_project_url?: string | null;
  created_at: string;
}

export interface ExternalLinkHealthData {
  status: 'healthy' | 'degraded';
  isHealthy: boolean;
  testedUrl: string;
  httpStatus: number;
  responseTimeMs: number;
  missingExternalIdsCount: number;
  autoHealedEnqueuedCount: number;
  timestamp: string;
}

interface JobListProps {
  initialJobs?: JobItem[];
  freelancerProjectBaseUrl?: string;
  onRefresh?: () => void;
}

export const JobList: React.FC<JobListProps> = ({
  initialJobs = [],
  freelancerProjectBaseUrl = 'https://www.freelancer.com/projects',
  onRefresh,
}) => {
  const [jobs, setJobs] = useState<JobItem[]>(initialJobs);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [syncingJobId, setSyncingJobId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [healthData, setHealthData] = useState<ExternalLinkHealthData | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  // Fetch jobs from backend
  const fetchJobs = async () => {
    setLoading(true);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/jobs`);
      const data = await res.json();
      if (data.success && Array.isArray(data.jobs)) {
        setJobs(data.jobs);
      }
    } catch (err) {
      console.warn('Could not fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Run external links health check
  const runHealthCheck = async () => {
    setCheckingHealth(true);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/health/freelancer-links`);
      const data = await res.json();
      setHealthData(data);
    } catch (err) {
      console.warn('Health check request error:', err);
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    runHealthCheck();
  }, []);

  const handleCopyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleForceSync = async (jobId: string) => {
    setSyncingJobId(jobId);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/jobs/${jobId}/sync-freelancer`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        await fetchJobs();
      }
    } catch (e) {
      console.error('Manual sync failed:', e);
    } finally {
      setSyncingJobId(null);
    }
  };

  const filteredJobs = jobs.filter((job) =>
    job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (job.external_id && job.external_id.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      {/* Health & Diagnostic Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 backdrop-blur-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2.5 rounded-xl border ${
              healthData?.isHealthy
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            }`}>
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white">External Link Routing &amp; Freelancer API</h4>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase font-mono border ${
                  healthData?.isHealthy
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/40 animate-pulse'
                }`}>
                  {healthData?.isHealthy ? '● All Links Healthy' : '▲ Auto-Healing Active'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Resolving via <span className="font-mono text-slate-300">{freelancerProjectBaseUrl}/:external_id</span>
                {healthData && (
                  <span className="ml-2 font-mono text-[11px] text-slate-400">
                    ({healthData.responseTimeMs}ms response • {healthData.missingExternalIdsCount} un-synced)
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runHealthCheck}
              disabled={checkingHealth}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingHealth ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Verify Links</span>
            </button>

            <button
              onClick={() => {
                fetchJobs();
                if (onRefresh) onRefresh();
              }}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-xs font-bold text-emerald-300 border border-emerald-500/30 transition-all"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Jobs</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter jobs by title or external ID (#proj_...)"
          className="w-full rounded-xl border border-slate-800 bg-slate-950/80 py-2.5 pl-10 pr-4 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {/* Jobs Grid */}
      <div className="space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <p className="text-sm text-slate-400">No jobs found matching your search.</p>
          </div>
        ) : (
          filteredJobs.map((job) => {
            // Correct External Link URL resolution:
            // ALWAYS uses external_id in the URL format: https://freelancer-site.com/project/${job.external_id}
            const externalProjectUrl = job.external_id
              ? `${freelancerProjectBaseUrl}/${encodeURIComponent(job.external_id)}`
              : null;

            const isSyncing = syncingJobId === job.id;

            return (
              <div
                key={job.id}
                className="group rounded-2xl border border-slate-800/90 bg-slate-900/60 p-4 transition-all duration-200 hover:border-slate-700 hover:bg-slate-900/90 shadow-md"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  {/* Left Column: Details */}
                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                        {job.title}
                      </h3>

                      {/* External ID Badge */}
                      {job.external_id ? (
                        <span className="inline-flex items-center rounded-md bg-purple-500/15 px-2 py-0.5 text-[11px] font-mono font-bold text-purple-300 border border-purple-500/30">
                          ID: {job.external_id}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-mono font-bold text-amber-300 border border-amber-500/30">
                          <AlertTriangle className="h-3 w-3" />
                          Pending External Sync
                        </span>
                      )}

                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        job.status === 'completed' || job.status === 'paid'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                      }`}>
                        {job.status}
                      </span>
                    </div>

                    {job.description && (
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {job.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 pt-1">
                      <span className="flex items-center font-mono text-slate-300 font-bold">
                        <DollarSign className="h-3.5 w-3.5 text-emerald-400 mr-0.5" />
                        ${Number(job.budget).toLocaleString()} USD
                      </span>

                      <span className="flex items-center">
                        <Clock className="h-3 w-3 mr-1 text-slate-500" />
                        {new Date(job.created_at).toLocaleDateString()}
                      </span>

                      <span className="text-[11px] font-mono text-slate-500">
                        Local UUID: {job.id.slice(0, 8)}...
                      </span>
                    </div>
                  </div>

                  {/* Right Column: External Link & Actions */}
                  <div className="flex items-center gap-2 sm:self-center">
                    {externalProjectUrl ? (
                      <>
                        <a
                          href={externalProjectUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md shadow-emerald-950/40 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition-all"
                        >
                          <span>Open on Freelancer</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>

                        <button
                          onClick={() => handleCopyLink(externalProjectUrl, job.id)}
                          className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:border-slate-700 hover:text-slate-200 transition-all"
                          title="Copy project link"
                        >
                          {copiedId === job.id ? (
                            <Check className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        {/* Fallback Disabled State when external_id is missing */}
                        <button
                          disabled
                          className="flex items-center gap-1.5 rounded-xl bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-slate-500 cursor-not-allowed border border-slate-700/50"
                          title="External link not available until project ID is synchronized"
                        >
                          <span>Not Available</span>
                          <ExternalLink className="h-3.5 w-3.5 opacity-40" />
                        </button>

                        <button
                          onClick={() => handleForceSync(job.id)}
                          disabled={isSyncing}
                          className="flex items-center gap-1 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 px-2.5 py-2 text-xs font-bold text-purple-300 transition-all"
                          title="Retry syncing to freelancer site now"
                        >
                          <Zap className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                          <span>{isSyncing ? 'Syncing...' : 'Sync ID'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
