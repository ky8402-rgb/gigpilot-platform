import React, { useState, useEffect } from 'react';
import { 
  X, 
  Sparkles, 
  Send, 
  Copy, 
  Check, 
  DollarSign, 
  Calendar, 
  HelpCircle, 
  Zap, 
  FileText, 
  RefreshCw, 
  Sliders, 
  Layers, 
  CheckCircle2
} from 'lucide-react';
import { FreelanceJob, FreelancerProfile, GeneratedProposal } from '../types';
import { generateAIProposal } from '../services/api';

interface ProposalStudioModalProps {
  job: FreelanceJob | null;
  profile: FreelancerProfile;
  isOpen: boolean;
  onClose: () => void;
  onSubmitBid: (job: FreelanceJob, proposal: GeneratedProposal) => void;
  onOpenPayPal?: () => void;
  onOpenLegal?: () => void;
}

export const ProposalStudioModal: React.FC<ProposalStudioModalProps> = ({
  job,
  profile,
  isOpen,
  onClose,
  onSubmitBid,
  onOpenPayPal,
  onOpenLegal
}) => {
  const [tone, setTone] = useState<'confident' | 'consultative' | 'technical' | 'friendly'>('confident');
  const [customInstructions, setCustomInstructions] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [proposal, setProposal] = useState<GeneratedProposal | null>(null);

  // Generate proposal when opened
  useEffect(() => {
    if (isOpen && job) {
      handleGenerate();
    }
  }, [isOpen, job?.id]);

  if (!isOpen || !job) return null;

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const generated = await generateAIProposal(job, profile, tone, customInstructions);
      setProposal(generated);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!proposal) return;
    navigator.clipboard.writeText(proposal.coverLetter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFinalSubmit = () => {
    if (!proposal) return;
    onSubmitBid(job, proposal);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white sm:text-lg">AI Proposal & Bidding Studio</h2>
              <p className="text-xs text-slate-400">
                Targeting <span className="font-semibold text-emerald-400">{job.platform}</span> • Match Confidence: {proposal?.matchConfidenceScore || 94}%
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          
          {/* Left Column: Job Info & AI Controls (5 cols) */}
          <div className="space-y-4 lg:col-span-5">
            
            {/* Job Summary Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">
                  {job.platform}
                </span>
                <span className="font-mono font-bold text-slate-200 text-sm">
                  {job.type === 'hourly' ? `$${job.hourlyMin || job.budget}-$${job.hourlyMax || (job.budget + 20)}/hr` : `$${job.budget.toLocaleString()} Fixed`}
                </span>
              </div>

              <h4 className="font-bold text-slate-100 text-sm leading-snug">{job.title}</h4>
              
              <div className="max-h-32 overflow-y-auto rounded-lg bg-slate-900/80 p-2.5 text-slate-300 text-[11px] leading-relaxed border border-slate-800">
                {job.description}
              </div>

              <div className="flex flex-wrap gap-1">
                {job.skills.map((s, i) => (
                  <span key={i} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {s}
                  </span>
                ))}
              </div>
            </div>

            {/* AI Customization Controls */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3 text-xs">
              <div className="font-bold text-slate-200 uppercase tracking-wider flex items-center justify-between">
                <span>Tone & Positioning</span>
                <Sliders className="h-3.5 w-3.5 text-emerald-400" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(['confident', 'consultative', 'technical', 'friendly'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={`rounded-lg py-1.5 px-2 text-center capitalize font-semibold transition-all ${
                      tone === t 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                        : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div>
                <label className="font-semibold text-slate-300">Custom Pitch Angle / Instructions:</label>
                <textarea
                  rows={2}
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g. Highlight previous scraper projects, offer free 14-day warranty..."
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-200 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={isLoading}
                className="w-full flex items-center justify-center space-x-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 py-2 font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Drafting with Gemini AI...' : 'Regenerate Pitch'}</span>
              </button>
            </div>

            {/* Proposed Milestones */}
            {proposal?.proposedMilestones && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2 text-xs">
                <div className="font-bold text-slate-200 flex items-center justify-between">
                  <span className="flex items-center">
                    <Layers className="mr-1.5 h-3.5 w-3.5 text-cyan-400" />
                    Structured Milestone Breakdown
                  </span>
                </div>

                <div className="space-y-1.5">
                  {proposal.proposedMilestones.map((m, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-lg bg-slate-900/80 p-2 border border-slate-800/60">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-cyan-400 font-bold">M{idx + 1}</span>
                        <span className="text-slate-200">{m.name}</span>
                      </div>
                      <span className="font-mono font-bold text-emerald-400">${m.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Right Column: Proposal Output & Editor (7 cols) */}
          <div className="space-y-4 lg:col-span-7 flex flex-col">
            
            {/* Hook summary */}
            {proposal?.hookSummary && (
              <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/30 p-3 text-xs text-emerald-300 flex items-center space-x-2">
                <Zap className="h-4 w-4 shrink-0 text-emerald-400" />
                <span><strong>Conversion Hook:</strong> {proposal.hookSummary}</span>
              </div>
            )}

            {/* Proposal Textarea */}
            <div className="flex-1 flex flex-col rounded-xl border border-slate-800 bg-slate-950/90 p-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center">
                  <FileText className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                  Proposal Cover Letter
                </span>
                
                <button
                  onClick={handleCopy}
                  className="flex items-center space-x-1 rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700 transition-all"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy Text</span>
                    </>
                  )}
                </button>
              </div>

              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
                  <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
                  <p className="text-xs">Gemini 3.7 Flash is analyzing client history & drafting winning pitch...</p>
                </div>
              ) : (
                <textarea
                  rows={14}
                  value={proposal?.coverLetter || ''}
                  onChange={(e) => {
                    if (proposal) {
                      setProposal({ ...proposal, coverLetter: e.target.value });
                    }
                  }}
                  className="mt-3 flex-1 w-full bg-transparent text-slate-200 text-xs sm:text-sm font-mono leading-relaxed focus:outline-none resize-none"
                  placeholder="Generated proposal will appear here..."
                />
              )}
            </div>

            {/* Client Interview Questions */}
            {proposal?.clientQuestions && proposal.clientQuestions.length > 0 && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2 text-xs">
                <div className="font-bold text-slate-300 flex items-center text-[11px] uppercase tracking-wider">
                  <HelpCircle className="mr-1.5 h-3.5 w-3.5 text-amber-400" />
                  Strategic Client Questions to Include
                </div>
                <div className="space-y-1">
                  {proposal.clientQuestions.map((q, idx) => (
                    <div key={idx} className="text-slate-300 text-[11px] flex items-start space-x-1.5">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

        </div>

        {/* Modal Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between border-t border-slate-800 bg-slate-950/90 px-6 py-4 gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-xs text-slate-400">
            <div>
              Bid Quote: <strong className="font-mono text-emerald-400">${proposal?.bidAmount || job.budget}</strong> • Delivery: <strong className="text-slate-200">{proposal?.estimatedDays || 5} days</strong>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-slate-700">|</span>
              <span className="bg-emerald-500/10 text-emerald-300 text-[10px] px-2 py-0.5 rounded font-mono font-bold border border-emerald-500/20">
                Gemini Cost: ~$0.02 vs Charge: $1.00 (5,000% Margin)
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            {onOpenPayPal && (
              <button
                type="button"
                onClick={onOpenPayPal}
                className="flex items-center space-x-1.5 rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-3 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-900/50 transition-all cursor-pointer"
                title="Top-up AI Proposal Credits via PayPal REST Gateway"
              >
                <span>💳 PayPal Gateway ($10)</span>
              </button>
            )}

            {onOpenLegal && (
              <button
                type="button"
                onClick={onOpenLegal}
                className="text-[11px] text-slate-400 hover:text-slate-200 underline transition-all hidden md:inline"
              >
                Terms &amp; GST
              </button>
            )}

            <button
              onClick={onClose}
              className="rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-all cursor-pointer"
            >
              Cancel
            </button>

            <button
              id="btn-submit-proposal"
              onClick={handleFinalSubmit}
              disabled={!proposal || isLoading}
              className="flex items-center space-x-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-950/50 hover:from-emerald-400 hover:to-teal-400 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              <span>Submit &amp; Track Bid</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
