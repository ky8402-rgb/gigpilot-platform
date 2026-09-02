import React, { useState, useEffect } from 'react';
import { 
  X, 
  ShieldCheck, 
  AlertTriangle, 
  Sparkles, 
  TrendingUp, 
  DollarSign, 
  Clock, 
  CheckCircle2, 
  Layers, 
  RefreshCw,
  Send
} from 'lucide-react';
import { FreelanceJob, FreelancerProfile } from '../types';
import { analyzeJobWithAI, JobAnalysisResult } from '../services/api';

interface JobAnalysisModalProps {
  job: FreelanceJob | null;
  profile: FreelancerProfile;
  isOpen: boolean;
  onClose: () => void;
  onProceedToPitch: (job: FreelanceJob) => void;
}

export const JobAnalysisModal: React.FC<JobAnalysisModalProps> = ({
  job,
  profile,
  isOpen,
  onClose,
  onProceedToPitch
}) => {
  const [analysis, setAnalysis] = useState<JobAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && job) {
      handleAnalyze();
    }
  }, [isOpen, job?.id]);

  if (!isOpen || !job) return null;

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const res = await analyzeJobWithAI(job, profile);
      setAnalysis(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-cyan-500/10 p-2 text-cyan-400 border border-cyan-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">AI Deal & Client Risk Audit</h2>
              <p className="text-xs text-slate-400">{job.title}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {loading ? (
            <div className="py-16 text-center text-slate-400 space-y-3">
              <RefreshCw className="mx-auto h-8 w-8 animate-spin text-cyan-400" />
              <p className="text-xs">Gemini 3.7 Flash is auditing client history, budget feasibility, and win margin...</p>
            </div>
          ) : analysis ? (
            <>
              {/* Score meters */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Client Trust Score</span>
                  <div className="mt-1 font-mono text-xl font-extrabold text-emerald-400">
                    {analysis.clientTrustScore}/100
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Profitability Rating</span>
                  <div className="mt-1 font-mono text-xl font-extrabold text-cyan-400">
                    {analysis.profitabilityScore}/100
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-center">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Est. Effective Rate</span>
                  <div className="mt-1 font-mono text-xl font-extrabold text-indigo-300">
                    {analysis.hourlyEffectiveRate}
                  </div>
                </div>
              </div>

              {/* Recommendation Callout */}
              <div className={`rounded-xl border p-4 text-xs ${
                analysis.recommendation === 'STRONG_BID'
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                  : analysis.recommendation === 'CONSIDER'
                  ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300'
                  : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
              }`}>
                <div className="flex items-center space-x-2 font-bold text-sm">
                  <ShieldCheck className="h-4 w-4" />
                  <span>AI Verdict: {analysis.recommendation.replace('_', ' ')}</span>
                </div>
                <p className="mt-1 leading-relaxed text-slate-200">
                  {analysis.suggestedBidStrategy}
                </p>
              </div>

              {/* Strengths and Risks */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
                  <span className="font-bold text-emerald-400 uppercase tracking-wider text-[11px] flex items-center">
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                    Deal Strengths
                  </span>
                  <ul className="space-y-1.5 text-slate-300">
                    {analysis.strengths.map((s, i) => (
                      <li key={i} className="flex items-start space-x-1.5">
                        <span className="text-emerald-400 font-bold">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
                  <span className="font-bold text-amber-400 uppercase tracking-wider text-[11px] flex items-center">
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" />
                    Risk Factors
                  </span>
                  <ul className="space-y-1.5 text-slate-300">
                    {analysis.risks.map((r, i) => (
                      <li key={i} className="flex items-start space-x-1.5">
                        <span className="text-amber-400 font-bold">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/90 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>

          <button
            onClick={() => {
              onClose();
              onProceedToPitch(job);
            }}
            className="flex items-center space-x-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2 text-xs font-bold text-slate-950 hover:from-emerald-400 hover:to-teal-400 shadow-md shadow-emerald-950/40"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Proceed to Draft Pitch</span>
          </button>
        </div>

      </div>
    </div>
  );
};
