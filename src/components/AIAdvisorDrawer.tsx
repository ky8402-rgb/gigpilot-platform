import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  TrendingUp, 
  Target, 
  Zap, 
  ArrowUpRight, 
  Lightbulb, 
  Award, 
  RefreshCw, 
  CheckCircle2,
  DollarSign,
  Copy,
  Check
} from 'lucide-react';
import { FreelancerProfile } from '../types';
import { optimizeProfileWithAI } from '../services/api';

interface AIAdvisorDrawerProps {
  profile: FreelancerProfile;
  winRate: number;
  totalBidsCount: number;
}

export const AIAdvisorDrawer: React.FC<AIAdvisorDrawerProps> = ({
  profile,
  winRate,
  totalBidsCount
}) => {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchOptimizations();
  }, []);

  const fetchOptimizations = async () => {
    setLoading(true);
    try {
      const res = await optimizeProfileWithAI(profile, totalBidsCount, `${winRate}%`);
      setSuggestions(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const topNiches = [
    {
      title: "AI Pipeline & Webhook Integration",
      demand: "Very High",
      avgRate: "$85 - $120/hr",
      description: "Connecting OpenAI / Gemini endpoints with PayPal, CRMs, PostgreSQL, and custom React frontends."
    },
    {
      title: "Autonomous Python Scrapers & Daemons",
      demand: "High",
      avgRate: "$70 - $95/hr",
      description: "Price scrapers, automated alert bots, and competitor intelligence feeds."
    },
    {
      title: "Full-Stack MVP in 7 Days (React + Node)",
      demand: "Extremely High",
      avgRate: "$1,500 - $3,500 / fixed MVP",
      description: "Rapid turnaround for startups needing vetted prototypes with authentication and billing."
    }
  ];

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 p-6 backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center space-x-2">
              <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-bold text-emerald-300">
                Gemini 3.7 Flash Intelligence
              </span>
            </div>
            <h2 className="mt-2 text-xl font-extrabold text-white sm:text-2xl">
              AI Freelance Strategy & Profile Optimizer
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-300">
              Personalized data-driven recommendations to boost proposal conversion rates and maximize hourly billing efficiency.
            </p>
          </div>

          <button
            onClick={fetchOptimizations}
            disabled={loading}
            className="flex items-center space-x-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Re-analyze Profile</span>
          </button>
        </div>
      </div>

      {/* Profile Optimization Cards */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center">
          <Sparkles className="mr-2 h-4 w-4 text-emerald-400" />
          High-Impact Profile & Pitch Optimizations
        </h3>

        {loading ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <RefreshCw className="mx-auto h-6 w-6 animate-spin text-emerald-400" />
            <p className="text-xs">Analyzing conversion metrics...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {suggestions.map((s, idx) => (
              <div
                key={idx}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400">{s.area}</span>
                    <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      {s.impact}
                    </span>
                  </div>

                  <div className="mt-3 text-xs">
                    <span className="text-slate-500 text-[10px] uppercase font-bold">Current:</span>
                    <div className="rounded bg-slate-900 p-2 text-slate-400 mt-1 line-clamp-2">
                      {s.current}
                    </div>
                  </div>

                  <div className="mt-2 text-xs">
                    <span className="text-emerald-400 text-[10px] uppercase font-bold">Recommended:</span>
                    <div className="rounded bg-emerald-950/30 border border-emerald-500/30 p-2 text-slate-200 mt-1 font-semibold">
                      {s.improved}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(s.improved);
                    setCopiedIndex(idx);
                    setTimeout(() => setCopiedIndex(null), 2000);
                  }}
                  className="w-full rounded-lg bg-slate-800 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-all flex items-center justify-center space-x-1.5"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied to Clipboard!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-slate-400" />
                      <span>Adopt Suggestion (Copy)</span>
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Highest Margin High-Demand Freelance Niches */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 backdrop-blur-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-white flex items-center">
          <TrendingUp className="mr-2 h-4 w-4 text-cyan-400" />
          Top Auto-Earning High-Yield Freelance Niches
        </h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {topNiches.map((niche, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-100">{niche.title}</h4>
                <span className="rounded bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                  {niche.demand}
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                {niche.description}
              </p>

              <div className="border-t border-slate-800/80 pt-2 flex items-center justify-between text-xs">
                <span className="text-slate-500">Benchmark Rate:</span>
                <span className="font-mono font-bold text-emerald-400">{niche.avgRate}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
