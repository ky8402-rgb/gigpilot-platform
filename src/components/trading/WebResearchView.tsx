import React, { useState } from 'react';
import { ResearchCategory, ResearchItem } from '../../types/trading';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Filter,
  Layers,
  Send
} from 'lucide-react';
import { analyzeResearchIntelligence } from '../../services/tradingService';

interface WebResearchViewProps {
  items: ResearchItem[];
  onRefreshItems: () => void;
}

export const WebResearchView: React.FC<WebResearchViewProps> = ({
  items,
  onRefreshItems
}) => {
  const [activeFilter, setActiveFilter] = useState<ResearchCategory | 'ALL'>('ALL');
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newSource, setNewSource] = useState('CoinDesk / Regulatory Wire');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const filteredItems = activeFilter === 'ALL'
    ? items
    : items.filter(i => i.category === activeFilter);

  const getCategoryBadge = (cat: ResearchCategory) => {
    switch (cat) {
      case 'FACT':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
      case 'ANALYSIS':
        return 'bg-blue-950/80 text-blue-300 border-blue-800';
      case 'UNVERIFIED_CLAIM':
        return 'bg-amber-950/80 text-amber-300 border-amber-800';
      case 'SPECULATION':
        return 'bg-purple-950/80 text-purple-300 border-purple-800';
    }
  };

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAnalyzing(true);
    try {
      await analyzeResearchIntelligence(newTitle, newContent, newSource);
      setShowIngestModal(false);
      setNewTitle('');
      setNewContent('');
      onRefreshItems();
    } catch (err: any) {
      alert(`AI Analysis error: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-mono text-xs">
      {/* Header */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-950 border border-blue-800 flex items-center justify-center text-blue-400">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Autonomous Market Intelligence & Research Feed
            </h2>
            <p className="text-[11px] text-slate-400">
              Scans news, fee revisions, on-chain flows & arXiv papers. Strictly categorizes FACT vs SPECULATION.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowIngestModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold transition-all shadow font-mono"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Analyze Intelligence with Gemini</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {(['ALL', 'FACT', 'ANALYSIS', 'UNVERIFIED_CLAIM', 'SPECULATION'] as const).map(f => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              activeFilter === f
                ? 'bg-slate-800 text-white border border-slate-600 shadow'
                : 'text-slate-400 hover:text-slate-200 bg-slate-900/40 border border-slate-800'
            }`}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Items Feed */}
      <div className="space-y-4">
        {filteredItems.map(item => (
          <div
            key={item.id}
            className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-all shadow"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getCategoryBadge(item.category)}`}>
                  {item.category.replace('_', ' ')}
                </span>
                <span className={`text-[10px] font-bold flex items-center gap-1 ${
                  item.sentiment === 'BULLISH' ? 'text-emerald-400' : item.sentiment === 'BEARISH' ? 'text-rose-400' : 'text-slate-400'
                }`}>
                  {item.sentiment === 'BULLISH' && <TrendingUp className="w-3 h-3" />}
                  {item.sentiment === 'BEARISH' && <TrendingDown className="w-3 h-3" />}
                  {item.sentiment}
                </span>
                <span className="text-slate-500 text-[10px]">· {item.source}</span>
              </div>

              <div className="text-[11px] text-slate-400">
                Impact: <strong className="text-white">{item.impactScore}/10</strong>
              </div>
            </div>

            <h3 className="text-sm font-bold text-white mb-1.5 leading-snug">
              {item.title}
            </h3>

            <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
              {item.summary}
            </p>

            {/* Quantitative Action Box */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">QUANT ACTION:</span>
                <span className="text-cyan-300 font-semibold">{item.quantitativeAdjustment.notes}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Grid Width Mod:</span>
                <span className="font-bold text-amber-300">
                  {item.quantitativeAdjustment.recommendedGridWidthModifier}x
                </span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">Risk:</span>
                <span className={`font-bold ${
                  item.quantitativeAdjustment.riskLevel === 'HIGH' || item.quantitativeAdjustment.riskLevel === 'CRITICAL'
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}>
                  {item.quantitativeAdjustment.riskLevel}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Ingest Modal */}
      {showIngestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl text-slate-100">
            <h3 className="font-extrabold text-base text-white mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>Ingest & Quant-Analyze Intelligence</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Gemini filters out noise, classifies claims into taxonomy, and computes grid parameter modifications.
            </p>

            <form onSubmit={handleIngestSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Headline / Report Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., CME Bitcoin Volatility Index Spikes 18% Ahead of CPI"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white font-bold"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Source / Publication</label>
                <input
                  type="text"
                  value={newSource}
                  onChange={e => setNewSource(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Full Article / Context Body</label>
                <textarea
                  rows={5}
                  required
                  placeholder="Paste article, research findings or market notice..."
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowIngestModal(false)}
                  className="px-4 py-2 rounded text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAnalyzing}
                  className="px-5 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold uppercase tracking-wider font-mono shadow"
                >
                  {isAnalyzing ? 'Analyzing with Gemini...' : 'Synthesize Quantitative Impact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
