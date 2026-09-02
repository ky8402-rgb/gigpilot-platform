import React, { useState } from 'react';
import { 
  Search, 
  Filter, 
  Sparkles, 
  ExternalLink, 
  DollarSign, 
  Clock, 
  MapPin, 
  Star, 
  ShieldCheck, 
  AlertTriangle, 
  Zap, 
  CheckCircle, 
  Layers, 
  Send,
  SlidersHorizontal,
  Flame,
  ArrowRight
} from 'lucide-react';
import { FreelanceJob, PlatformType, FreelancerProfile } from '../types';

interface JobsRadarProps {
  jobs: FreelanceJob[];
  profile: FreelancerProfile;
  onOpenProposalStudio: (job: FreelanceJob) => void;
  onQuickAutoBid: (job: FreelanceJob) => void;
  onAnalyzeJob: (job: FreelanceJob) => void;
  onToggleQueue: (job: FreelanceJob) => void;
}

export const JobsRadar: React.FC<JobsRadarProps> = ({
  jobs,
  profile,
  onOpenProposalStudio,
  onQuickAutoBid,
  onAnalyzeJob,
  onToggleQueue
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'ALL' | PlatformType>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'fixed' | 'hourly'>('ALL');
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [minMatchScore, setMinMatchScore] = useState<number>(75);

  const filteredJobs = jobs.filter(job => {
    // Search query match
    const matchesSearch = 
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.skills.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()));

    // Platform filter
    const matchesPlatform = platformFilter === 'ALL' || job.platform === platformFilter;

    // Type filter
    const matchesType = typeFilter === 'ALL' || job.type === typeFilter;

    // Verified filter
    const matchesVerified = !onlyVerified || job.client.paymentVerified;

    // Match score
    const matchesScore = job.matchScore >= minMatchScore;

    return matchesSearch && matchesPlatform && matchesType && matchesVerified && matchesScore;
  });

  return (
    <div className="space-y-4">
      
      {/* Top Filter and Search Bar */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              id="input-jobs-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search live jobs by skill (React, Python, Gemini, Automation), keyword, or title..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950/80 py-2.5 pl-10 pr-4 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Platform pills */}
            <div className="flex rounded-xl border border-slate-800 bg-slate-950/80 p-1">
              {(['ALL', 'RemoteOK', 'Direct Remote', 'WeWorkRemotely', 'Public Gig'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatformFilter(p)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    platformFilter === p 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Type selector */}
            <div className="flex rounded-xl border border-slate-800 bg-slate-950/80 p-1">
              <button
                onClick={() => setTypeFilter('ALL')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  typeFilter === 'ALL' ? 'bg-slate-800 text-slate-200' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All Types
              </button>
              <button
                onClick={() => setTypeFilter('fixed')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  typeFilter === 'fixed' ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Fixed Price
              </button>
              <button
                onClick={() => setTypeFilter('hourly')}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  typeFilter === 'hourly' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Hourly
              </button>
            </div>

            {/* Verified toggle */}
            <button
              onClick={() => setOnlyVerified(!onlyVerified)}
              className={`flex items-center space-x-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                onlyVerified 
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' 
                  : 'border-slate-800 bg-slate-950/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Verified Only</span>
            </button>

          </div>
        </div>

        {/* Sub-bar: Match score threshold and results count */}
        <div className="mt-3 flex flex-wrap items-center justify-between border-t border-slate-800/60 pt-3 text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-300">Live Scanned Jobs:</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 font-mono text-emerald-400">
              {filteredJobs.length} matches
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <span className="text-slate-400">Min Match Score:</span>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="50"
                max="95"
                step="5"
                value={minMatchScore}
                onChange={(e) => setMinMatchScore(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer accent-emerald-500"
              />
              <span className="font-mono font-bold text-emerald-400">{minMatchScore}%+</span>
            </div>
          </div>
        </div>

      </div>

      {/* Jobs Grid / List */}
      <div className="space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-12 text-center">
            <SlidersHorizontal className="mx-auto h-8 w-8 text-slate-600" />
            <h3 className="mt-3 text-sm font-semibold text-slate-300">No matching jobs found</h3>
            <p className="mt-1 text-xs text-slate-500">
              Try adjusting your search query, lowering the match score threshold, or clicking "Scan Jobs" in the navbar.
            </p>
          </div>
        ) : (
          filteredJobs.map((job) => {
            const isSubmitted = job.status === 'bid_submitted';
            const isQueued = job.status === 'queued';

            return (
              <div
                key={job.id}
                className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-5 backdrop-blur-sm transition-all hover:border-slate-700 hover:shadow-xl hover:shadow-slate-950/50"
              >
                {/* Status bar top indicator */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  
                  {/* Left: Platform & Match Badge */}
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ${
                      job.platform === 'RemoteOK' 
                        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30' 
                        : job.platform === 'Direct Remote' 
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                        : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                    }`}>
                      {job.platform}
                    </span>

                    <span className="text-xs text-slate-400 flex items-center">
                      <Clock className="mr-1 h-3 w-3" />
                      {job.postedAt}
                    </span>

                    {job.aiRecommendation === 'STRONG_BID' && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                        <Flame className="mr-1 h-3 w-3 text-emerald-400 fill-emerald-400" />
                        AI Strong Pick
                      </span>
                    )}

                    {job.aiRecommendation === 'HIGH_RISK' && (
                      <span className="inline-flex items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-400 border border-rose-500/20">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Flagged Risk
                      </span>
                    )}
                  </div>

                  {/* Right: Match Score Gauge & Budget */}
                  <div className="flex items-center space-x-3">
                    
                    {/* Budget Callout */}
                    <div className="text-right">
                      <div className="font-mono text-base font-extrabold text-slate-100 sm:text-lg">
                        {job.type === 'hourly' ? (
                          <span>${job.hourlyMin || job.budget}-${job.hourlyMax || (job.budget + 20)}<span className="text-xs font-normal text-slate-400">/hr</span></span>
                        ) : (
                          <span>${job.budget.toLocaleString()} <span className="text-xs font-normal text-slate-400">USD</span></span>
                        )}
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono flex items-center justify-end gap-1">
                        <ShieldCheck className="w-3 h-3" /> Guaranteed Escrow
                      </span>
                    </div>

                    {/* Match Score Badge */}
                    <div className="flex flex-col items-center justify-center rounded-xl border border-slate-700/80 bg-slate-950 px-2.5 py-1">
                      <span className="text-[9px] uppercase font-bold text-slate-400">AI Match</span>
                      <span className={`font-mono text-sm font-extrabold ${
                        job.matchScore >= 90 ? 'text-emerald-400' : job.matchScore >= 80 ? 'text-cyan-400' : 'text-amber-400'
                      }`}>
                        {job.matchScore}%
                      </span>
                    </div>

                  </div>

                </div>

                {/* Job Title */}
                <h3 className="mt-2 text-base font-bold text-white transition-colors group-hover:text-emerald-300">
                  {job.title}
                </h3>

                {/* Job Description */}
                <p className="mt-2 line-clamp-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
                  {job.description}
                </p>

                {/* Skill Badges */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {job.skills.map((skill, idx) => {
                    const isUserSkill = profile.skills.some(s => s.toLowerCase() === skill.toLowerCase());
                    return (
                      <span
                        key={idx}
                        className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                          isUserSkill
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800/80 text-slate-400 border border-slate-700/50'
                        }`}
                      >
                        {skill}
                      </span>
                    );
                  })}
                </div>

                {/* Client Metadata and Action Bar */}
                <div className="mt-4 flex flex-col gap-3 border-t border-slate-800/80 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  
                  {/* Client Info snippet */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                    <span className="flex items-center text-slate-300 font-medium">
                      <MapPin className="mr-1 h-3 w-3 text-slate-500" />
                      {job.client.country}
                    </span>
                    
                    <span className="flex items-center text-amber-400 font-semibold">
                      <Star className="mr-1 h-3 w-3 fill-amber-400" />
                      {job.client.rating.toFixed(2)}
                    </span>

                    <span>
                      ${job.client.totalSpent.toLocaleString()} spent
                    </span>

                    {job.client.paymentVerified ? (
                      <span className="flex items-center text-emerald-400 font-medium">
                        <ShieldCheck className="mr-1 h-3 w-3" />
                        Verified
                      </span>
                    ) : (
                      <span className="text-slate-500">Unverified</span>
                    )}

                    <span className="text-slate-500 font-mono">
                      {job.proposalsCount} existing proposals
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center space-x-2">
                    
                    {/* AI Risk Audit Button */}
                    <button
                      onClick={() => onAnalyzeJob(job)}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white transition-all"
                      title="Run AI Deep Analysis on Client & Profitability"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-cyan-400 inline mr-1" />
                      Audit
                    </button>

                    {/* Proposal Studio (Manual / Review) */}
                    <button
                      onClick={() => onOpenProposalStudio(job)}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-all"
                    >
                      Draft Pitch
                    </button>

                    {/* Quick Auto-Bid Submission */}
                    {isSubmitted ? (
                      <span className="flex items-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs font-bold text-emerald-400">
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                        Bid Active
                      </span>
                    ) : (
                      <button
                        onClick={() => onQuickAutoBid(job)}
                        className="flex items-center space-x-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-md shadow-emerald-950/40 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition-all"
                      >
                        <Zap className="h-3.5 w-3.5 fill-slate-950" />
                        <span>Auto-Bid</span>
                      </button>
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
