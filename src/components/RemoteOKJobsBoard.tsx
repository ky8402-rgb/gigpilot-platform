import React, { useState, useMemo } from 'react';
import {
  Search,
  Globe,
  DollarSign,
  Clock,
  Sparkles,
  ExternalLink,
  Zap,
  CheckCircle2,
  SlidersHorizontal,
  RefreshCw,
  Layers,
  MapPin,
  Flame,
  ShieldCheck,
  Bookmark,
  Send,
  Building2,
  TrendingUp,
  Tag
} from 'lucide-react';
import { FreelanceJob, FreelancerProfile } from '../types';

export interface RemoteOKJobItem {
  id: string | number;
  title: string;
  company: string;
  description: string;
  url: string;
  pubDate?: string;
  tags: string[];
  location: string;
  amount: number;
  salaryMin?: number;
  salaryMax?: number;
  salaryDisplay?: string;
  status?: string;
  category: string;
  platform?: string;
  time?: string;
  logoUrl?: string;
  companyColor?: string;
  type?: 'Contract' | 'Full-Time' | 'Part-Time' | 'Freelance';
  matchScore?: number;
  featured?: boolean;
}

interface RemoteOKJobsBoardProps {
  jobs: RemoteOKJobItem[];
  onImportToOrders: (job: RemoteOKJobItem) => void;
  onOpenAIProposal: (job: RemoteOKJobItem) => void;
  onRefreshFeed: () => void;
  isLoading: boolean;
  profile?: FreelancerProfile;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

const POPULAR_TAGS = [
  'All',
  'React',
  'TypeScript',
  'Python',
  'AI / LLM',
  'Full-Stack',
  'Node.js',
  'Tailwind',
  'Backend',
  'Frontend',
  'DevOps',
  'UI/UX',
  'Worldwide',
  '$80k+'
];

const CATEGORIES = [
  'All Categories',
  'Software Development',
  'AI & Machine Learning',
  'Frontend / React',
  'Backend & APIs',
  'DevOps & Cloud',
  'UI/UX & Design',
  'Automation & Data'
];

const LOCATIONS = [
  'All Locations',
  'Worldwide / Anywhere',
  'USA (Remote)',
  'Europe (Remote)',
  'Americas',
  'Asia / Pacific'
];

// Helper to generate consistent pleasant avatar colors
const AVATAR_COLORS = [
  'from-blue-600 to-cyan-500',
  'from-emerald-600 to-teal-500',
  'from-purple-600 to-indigo-500',
  'from-rose-600 to-pink-500',
  'from-amber-600 to-orange-500',
  'from-indigo-600 to-blue-500',
  'from-teal-600 to-emerald-500'
];

function getCompanyGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export const RemoteOKJobsBoard: React.FC<RemoteOKJobsBoardProps> = ({
  jobs,
  onImportToOrders,
  onOpenAIProposal,
  onRefreshFeed,
  isLoading,
  profile,
  showToast
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [selectedLocation, setSelectedLocation] = useState('All Locations');
  const [selectedType, setSelectedType] = useState<'ALL' | 'Contract' | 'Full-Time'>('ALL');
  const [minPayout, setMinPayout] = useState<number>(0);
  const [savedJobIds, setSavedJobIds] = useState<Set<string | number>>(new Set());

  const toggleSaveJob = (id: string | number, title: string) => {
    setSavedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        showToast(`Removed "${title}" from saved list`, 'info');
      } else {
        next.add(id);
        showToast(`📌 Saved "${title}" for later review!`, 'success');
      }
      return next;
    });
  };

  // Filter logic
  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      const q = searchQuery.toLowerCase().trim();
      
      // Keyword search
      const matchesSearch = !q || 
        job.title.toLowerCase().includes(q) ||
        job.company.toLowerCase().includes(q) ||
        job.description.toLowerCase().includes(q) ||
        job.tags.some(t => t.toLowerCase().includes(q));

      // Tag filter
      let matchesTag = true;
      if (activeTag !== 'All') {
        if (activeTag === '$80k+') {
          matchesTag = (job.amount >= 65 || (job.salaryMin && job.salaryMin >= 80000));
        } else if (activeTag === 'AI / LLM') {
          matchesTag = job.tags.some(t => t.toLowerCase().includes('ai') || t.toLowerCase().includes('llm') || t.toLowerCase().includes('machine')) ||
            job.title.toLowerCase().includes('ai') || job.title.toLowerCase().includes('gemini');
        } else if (activeTag === 'Worldwide') {
          matchesTag = job.location.toLowerCase().includes('world') || job.location.toLowerCase().includes('anywhere');
        } else {
          matchesTag = job.tags.some(t => t.toLowerCase().includes(activeTag.toLowerCase())) ||
            job.title.toLowerCase().includes(activeTag.toLowerCase());
        }
      }

      // Category filter
      let matchesCategory = true;
      if (selectedCategory !== 'All Categories') {
        const catKey = selectedCategory.toLowerCase();
        if (catKey.includes('react') || catKey.includes('frontend')) {
          matchesCategory = job.tags.some(t => ['react', 'frontend', 'vue', 'ui', 'css'].includes(t.toLowerCase())) || job.title.toLowerCase().includes('frontend') || job.title.toLowerCase().includes('react');
        } else if (catKey.includes('backend')) {
          matchesCategory = job.tags.some(t => ['node', 'python', 'backend', 'api', 'django', 'fastapi'].includes(t.toLowerCase())) || job.title.toLowerCase().includes('backend');
        } else if (catKey.includes('ai') || catKey.includes('machine')) {
          matchesCategory = job.tags.some(t => ['ai', 'ml', 'python', 'llm'].includes(t.toLowerCase())) || job.title.toLowerCase().includes('ai');
        } else if (catKey.includes('devops')) {
          matchesCategory = job.tags.some(t => ['devops', 'aws', 'docker', 'cloud'].includes(t.toLowerCase())) || job.title.toLowerCase().includes('devops');
        } else if (catKey.includes('design')) {
          matchesCategory = job.tags.some(t => ['design', 'ui/ux', 'figma'].includes(t.toLowerCase())) || job.title.toLowerCase().includes('design');
        }
      }

      // Location filter
      let matchesLocation = true;
      if (selectedLocation !== 'All Locations') {
        const loc = selectedLocation.toLowerCase();
        if (loc.includes('world')) {
          matchesLocation = job.location.toLowerCase().includes('world') || job.location.toLowerCase().includes('any');
        } else if (loc.includes('usa')) {
          matchesLocation = job.location.toLowerCase().includes('us') || job.location.toLowerCase().includes('united states');
        } else if (loc.includes('europe')) {
          matchesLocation = job.location.toLowerCase().includes('eu') || job.location.toLowerCase().includes('europe') || job.location.toLowerCase().includes('uk');
        }
      }

      // Type filter
      let matchesType = true;
      if (selectedType !== 'ALL') {
        matchesType = job.type === selectedType || (!job.type && selectedType === 'Contract');
      }

      // Min payout filter
      const matchesPayout = job.amount >= minPayout;

      return matchesSearch && matchesTag && matchesCategory && matchesLocation && matchesType && matchesPayout;
    });
  }, [jobs, searchQuery, activeTag, selectedCategory, selectedLocation, selectedType, minPayout]);

  return (
    <div className="space-y-6">
      
      {/* Remote OK Hero & Zero-Auth Notice Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-[#2a3147] bg-gradient-to-br from-[#121624] via-[#161c2d] to-[#0d101a] p-6 sm:p-8 shadow-2xl">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-[#00cfe8]/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-[#4f7cff]/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ff4742]/15 text-[#ff4742] border border-[#ff4742]/30 text-xs font-bold tracking-wide uppercase">
                <span className="w-2 h-2 rounded-full bg-[#ff4742] animate-ping"></span>
                <span className="w-2 h-2 rounded-full bg-[#ff4742]"></span>
                Remote OK Live Stream
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                100% Zero API Keys &amp; No Authentication Required
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Open Public Remote Jobs &amp; Contracts Radar
            </h2>
            <p className="text-sm text-[#9aa2bf] max-w-2xl leading-relaxed">
              Browse real-time verified remote engineering, automation, and full-stack contracts directly from open public feeds.
              Instantly 1-click import any gig into your <strong>Work Orders</strong> to auto-solve with AI and collect <strong>PayPal payouts</strong>.
            </p>
          </div>

          {/* Quick Metrics Badge */}
          <div className="flex flex-row md:flex-col items-center md:items-end justify-between gap-3 border-t md:border-t-0 md:border-l border-[#2a3147] pt-4 md:pt-0 md:pl-6 shrink-0">
            <div className="text-left md:text-right">
              <div className="text-xs uppercase font-bold text-[#5d6788]">Live Jobs Scanned</div>
              <div className="text-2xl font-black font-mono text-white flex items-center md:justify-end gap-1.5 mt-0.5">
                <span className="text-[#00cfe8]">{jobs.length}</span>
                <span className="text-xs font-normal text-[#9aa2bf]">active listings</span>
              </div>
            </div>

            <button
              onClick={onRefreshFeed}
              disabled={isLoading}
              className="bg-[#1e2438] hover:bg-[#283250] border border-[#3b476b] text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#00cfe8] ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Syncing Live Feed...' : 'Refresh Remote Stream'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Remote OK Search, Tag Filter Chips & Controls */}
      <div className="rounded-2xl border border-[#2a3147] bg-[#161b2b] p-5 shadow-xl space-y-4">
        
        {/* Search Input and Primary Dropdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          
          {/* Main Keyword Search */}
          <div className="sm:col-span-6 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9aa2bf]" />
            <input
              type="text"
              id="remoteok-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by job title, skill (React, Python, Node, AI), company or keyword..."
              className="w-full bg-[#11141f] border border-[#2a3147] rounded-xl py-2.5 pl-10 pr-4 text-xs sm:text-sm text-white placeholder-[#5d6788] focus:outline-none focus:border-[#00cfe8] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#9aa2bf] hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Dropdown */}
          <div className="sm:col-span-3">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full bg-[#11141f] border border-[#2a3147] rounded-xl py-2.5 px-3 text-xs text-slate-200 focus:outline-none focus:border-[#00cfe8] transition-colors cursor-pointer"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat} className="bg-[#161b2b] text-white">{cat}</option>
              ))}
            </select>
          </div>

          {/* Location Dropdown */}
          <div className="sm:col-span-3">
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="w-full bg-[#11141f] border border-[#2a3147] rounded-xl py-2.5 px-3 text-xs text-slate-200 focus:outline-none focus:border-[#00cfe8] transition-colors cursor-pointer"
            >
              {LOCATIONS.map(loc => (
                <option key={loc} value={loc} className="bg-[#161b2b] text-white">{loc}</option>
              ))}
            </select>
          </div>

        </div>

        {/* Hot Tag Chips Row (Remote OK style) */}
        <div className="pt-2 border-t border-[#2a3147]/60">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-none">
            <span className="text-[11px] font-bold uppercase text-[#5d6788] mr-1 shrink-0 flex items-center gap-1">
              <Tag className="w-3 h-3 text-[#4f7cff]" /> Popular:
            </span>
            {POPULAR_TAGS.map(tag => {
              const isActive = activeTag === tag;
              return (
                <button
                  key={tag}
                  onClick={() => setActiveTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-[#003087] to-[#0070ba] text-white shadow-md shadow-blue-500/20 border border-[#00cfe8]/40'
                      : 'bg-[#11141f] hover:bg-[#1f2638] text-[#9aa2bf] hover:text-white border border-[#2a3147]'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filter Summary & Count */}
        <div className="flex flex-wrap items-center justify-between text-xs text-[#9aa2bf] pt-1">
          <div className="flex items-center gap-2">
            <span>Showing <strong className="text-white font-mono">{filteredJobs.length}</strong> matching remote gigs</span>
            {activeTag !== 'All' && (
              <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono text-[11px]">
                tag: {activeTag}
              </span>
            )}
            {searchQuery && (
              <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono text-[11px]">
                query: "{searchQuery}"
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#5d6788]">Zero authentication • Instant Direct Apply or Auto-Import</span>
          </div>
        </div>

      </div>

      {/* Remote OK Jobs List Stream */}
      <div className="space-y-3">
        {filteredJobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#2a3147] bg-[#161b2b]/50 p-12 text-center">
            <Globe className="mx-auto h-10 w-10 text-[#5d6788] animate-pulse" />
            <h3 className="mt-3 text-base font-bold text-white">No matching remote gigs found</h3>
            <p className="mt-1 text-xs text-[#9aa2bf] max-w-md mx-auto">
              Try adjusting your search keywords, clicking "All" in popular tags, or click the refresh button above to pull fresh public listings.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setActiveTag('All');
                setSelectedCategory('All Categories');
                setSelectedLocation('All Locations');
              }}
              className="mt-4 px-4 py-2 rounded-full bg-[#1e2438] hover:bg-[#283250] text-white text-xs font-semibold transition-all border border-[#2a3147]"
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          filteredJobs.map((job, idx) => {
            const isSaved = savedJobIds.has(job.id);
            const gradient = getCompanyGradient(job.company);
            const companyInitial = job.company.charAt(0).toUpperCase() || 'R';
            const payoutUsd = job.amount || 50;

            return (
              <div
                key={`rok-job-${job.id || idx}-${idx}`}
                className="group relative overflow-hidden rounded-2xl border border-[#2a3147] bg-[#161b2b] hover:border-[#4f7cff]/60 p-4 sm:p-5 transition-all hover:shadow-xl hover:shadow-[#000000]/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                
                {/* Left Side: Avatar, Company, Title, Location & Tags */}
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  
                  {/* Company Initial / Brand Circle */}
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-black text-lg shadow-lg shrink-0`}>
                    {companyInitial}
                  </div>

                  {/* Job Details */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    
                    {/* Top Meta: Company, Verified & Location */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-white group-hover:text-[#00cfe8] transition-colors">
                        {job.company}
                      </span>
                      
                      <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-md font-semibold">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Verified Public Post
                      </span>

                      <span className="inline-flex items-center gap-1 text-xs text-[#9aa2bf] bg-[#11141f] border border-[#2a3147] px-2 py-0.5 rounded-full">
                        <MapPin className="w-3 h-3 text-[#ff4742]" />
                        {job.location || 'Worldwide'}
                      </span>

                      <span className="text-xs text-[#5d6788] flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {job.time || 'Today'}
                      </span>
                    </div>

                    {/* Job Title */}
                    <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-snug break-words">
                      {job.title}
                    </h3>

                    {/* Description preview */}
                    {job.description && (
                      <p className="text-xs text-[#9aa2bf] line-clamp-1 max-w-3xl">
                        {job.description.replace(/<[^>]*>?/gm, '')}
                      </p>
                    )}

                    {/* Skill Tags Row (Clickable) */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {(job.tags || ['Remote', 'Developer']).slice(0, 6).map((t, tIdx) => (
                        <button
                          key={tIdx}
                          onClick={() => {
                            setActiveTag(t);
                            showToast(`Filtered by tag: "${t}"`, 'info');
                          }}
                          className="text-[11px] bg-[#11141f] hover:bg-[#1f2638] text-[#9aa2bf] hover:text-[#00cfe8] border border-[#2a3147] px-2 py-0.5 rounded-md font-medium transition-colors"
                        >
                          #{t}
                        </button>
                      ))}
                    </div>

                  </div>
                </div>

                {/* Right Side: Compensation & 1-Click Action Buttons */}
                <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between lg:justify-center gap-3 border-t lg:border-t-0 border-[#2a3147] pt-3 lg:pt-0 shrink-0">
                  
                  {/* Compensation Badge */}
                  <div className="text-left lg:text-right">
                    <div className="font-mono text-base sm:text-lg font-extrabold text-[#2ecc71] flex items-center lg:justify-end gap-1">
                      <DollarSign className="w-4 h-4 text-[#2ecc71]" />
                      <span>{payoutUsd >= 1000 ? `$${(payoutUsd / 1000).toFixed(1)}k/mo` : `$${payoutUsd.toFixed(2)} USD`}</span>
                    </div>
                    <span className="text-[10px] text-[#5d6788] font-semibold block">
                      Guaranteed Milestone / Escrow
                    </span>
                  </div>

                  {/* Actions Group */}
                  <div className="flex items-center gap-2">
                    
                    {/* 1-Click Import to Work Orders */}
                    <button
                      onClick={() => onImportToOrders(job)}
                      className="bg-gradient-to-r from-[#2ecc71] to-[#27ae60] hover:opacity-90 text-slate-950 px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                      title="Import this contract into KundanVision Work Orders to auto-execute & settle to PayPal"
                    >
                      <Zap className="w-3.5 h-3.5 fill-slate-950" />
                      <span>Accept &amp; Import</span>
                    </button>

                    {/* AI Proposal Generator Modal */}
                    <button
                      onClick={() => onOpenAIProposal(job)}
                      className="bg-[#1e2438] hover:bg-[#2b3552] border border-[#3b476b] text-[#00cfe8] hover:text-white px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                      title="Generate high-converting proposal with Gemini AI"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#00cfe8]" />
                      <span className="hidden sm:inline">AI Proposal</span>
                    </button>

                    {/* Direct External Link */}
                    {job.url && job.url !== '#' && (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-[#11141f] hover:bg-[#1a2133] border border-[#2a3147] hover:border-[#4f7cff] text-[#9aa2bf] hover:text-white p-2 rounded-xl text-xs transition-all flex items-center justify-center"
                        title="View original public job posting (No login required)"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {/* Bookmark Toggle */}
                    <button
                      onClick={() => toggleSaveJob(job.id, job.title)}
                      className={`p-2 rounded-xl border text-xs transition-all cursor-pointer ${
                        isSaved
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-[#11141f] hover:bg-[#1a2133] border-[#2a3147] text-[#5d6788] hover:text-slate-300'
                      }`}
                      title={isSaved ? 'Saved' : 'Save for later'}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-amber-300' : ''}`} />
                    </button>

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

export default RemoteOKJobsBoard;
