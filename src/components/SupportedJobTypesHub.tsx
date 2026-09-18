import React, { useState } from 'react';
import {
  SUPPORTED_JOB_CATEGORIES,
  SUPPORTED_JOB_CATEGORIES_LIST,
  JobCategoryKey,
  JobCategorySpec,
  SampleJobPreset
} from '../types/jobCategories';
import {
  Database,
  FileSpreadsheet,
  FileText,
  Languages,
  Headphones,
  Code,
  Image as ImageIcon,
  Search,
  FileCheck,
  Share2,
  Sparkles,
  Play,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Layers,
  ArrowRight,
  ShieldCheck,
  DollarSign,
  Cpu,
  Clock
} from 'lucide-react';

export interface WorkOrderPayload {
  id?: string | number;
  title: string;
  category: string;
  amount: number;
  status: string;
  client?: {
    name: string;
    country: string;
    rating: number;
    totalSpent: number;
    paymentVerified: boolean;
  };
  time?: string;
  description?: string;
  skills?: string[];
}

interface SupportedJobTypesHubProps {
  onSelectCategoryFilter?: (category: string) => void;
  onAddWorkOrder?: (order: WorkOrderPayload) => void;
  onNavigateToTab?: (tab: string) => void;
}

interface GeneratedFile {
  filename: string;
  language: string;
  content: string;
  description: string;
}

interface ExecutionResult {
  orderId: string;
  jobTitle: string;
  status: string;
  executionTimeMs: number;
  files: GeneratedFile[];
  summary: string;
  architectureNotes: string;
  verificationChecklist: string[];
  clientHandoverNote: string;
  linesOfCode: number;
  modelUsed: string;
  checksum: string;
}

export const SupportedJobTypesHub: React.FC<SupportedJobTypesHubProps> = ({
  onSelectCategoryFilter,
  onAddWorkOrder,
  onNavigateToTab
}) => {
  const [selectedCategory, setSelectedCategory] = useState<JobCategorySpec>(SUPPORTED_JOB_CATEGORIES.data_scraping);
  const [customTitle, setCustomTitle] = useState<string>(selectedCategory.sampleJobs[0]?.title || '');
  const [customDescription, setCustomDescription] = useState<string>(selectedCategory.sampleJobs[0]?.description || '');
  const [customBudget, setCustomBudget] = useState<number>(selectedCategory.sampleJobs[0]?.budget || 350);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState<number>(0);
  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  const [addedToOrders, setAddedToOrders] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const handleSelectCategory = (cat: JobCategorySpec) => {
    setSelectedCategory(cat);
    const defaultJob = cat.sampleJobs[0];
    if (defaultJob) {
      setCustomTitle(defaultJob.title);
      setCustomDescription(defaultJob.description);
      setCustomBudget(defaultJob.budget);
    } else {
      setCustomTitle(`${cat.category} Delivery Task`);
      setCustomDescription(`Client project requiring autonomous execution for ${cat.examples}`);
      setCustomBudget(Math.round((cat.typicalBudgetRange.min + cat.typicalBudgetRange.max) / 2));
    }
    setExecutionResult(null);
    setAddedToOrders(false);
  };

  const handleSelectPreset = (preset: SampleJobPreset) => {
    setCustomTitle(preset.title);
    setCustomDescription(preset.description);
    setCustomBudget(preset.budget);
    setExecutionResult(null);
    setAddedToOrders(false);
  };

  const handleExecuteEngine = async () => {
    setIsExecuting(true);
    setExecutionResult(null);
    setAddedToOrders(false);

    try {
      const res = await fetch('/api/work-orders/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: `gen_${selectedCategory.id}_${Date.now()}`,
          title: customTitle || `${selectedCategory.category} Task`,
          description: customDescription,
          category: selectedCategory.category,
          tags: selectedCategory.techStack,
          budget: customBudget,
        }),
      });

      const data = await res.json();
      if (data.success && data.deliverable) {
        setExecutionResult(data.deliverable);
        setActiveFileIndex(0);
      } else {
        throw new Error(data.error || 'Execution did not return deliverables');
      }
    } catch (err: any) {
      console.error('Execution failed:', err);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCopyCurrentFile = () => {
    if (!executionResult || !executionResult.files[activeFileIndex]) return;
    navigator.clipboard.writeText(executionResult.files[activeFileIndex].content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 2000);
  };

  const handleDownloadAllFiles = () => {
    if (!executionResult) return;
    const current = executionResult.files[activeFileIndex];
    if (!current) return;
    const blob = new Blob([current.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = current.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddLiveWorkOrder = () => {
    if (!executionResult) return;
    if (onAddWorkOrder) {
      onAddWorkOrder({
        id: `ord_${Date.now()}`,
        title: customTitle,
        category: selectedCategory.category,
        amount: customBudget,
        status: 'in-progress',
        client: {
          name: 'Verified Direct Client',
          country: 'United States',
          rating: 4.95,
          totalSpent: 45000,
          paymentVerified: true
        },
        time: 'Just now',
        description: customDescription,
        skills: selectedCategory.techStack,
      });
      setAddedToOrders(true);
    }
  };

  const filteredCategories = SUPPORTED_JOB_CATEGORIES_LIST.filter(c =>
    c.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.examples.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.deliverables.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.techNeeded.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getCategoryIcon = (key: JobCategoryKey) => {
    switch (key) {
      case 'data_scraping': return <Database className="w-5 h-5 text-emerald-400" />;
      case 'data_entry_conversion': return <FileSpreadsheet className="w-5 h-5 text-cyan-400" />;
      case 'content_writing': return <FileText className="w-5 h-5 text-purple-400" />;
      case 'translation': return <Languages className="w-5 h-5 text-amber-400" />;
      case 'transcription': return <Headphones className="w-5 h-5 text-rose-400" />;
      case 'simple_coding': return <Code className="w-5 h-5 text-blue-400" />;
      case 'image_processing': return <ImageIcon className="w-5 h-5 text-pink-400" />;
      case 'seo_research': return <Search className="w-5 h-5 text-yellow-400" />;
      case 'pdf_doc_automation': return <FileCheck className="w-5 h-5 text-orange-400" />;
      case 'social_media_content': return <Share2 className="w-5 h-5 text-teal-400" />;
      default: return <Layers className="w-5 h-5 text-indigo-400" />;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-[#0d1527] to-slate-900 p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 border border-blue-500/30 text-blue-400 mb-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Full Autonomous Job Matrix (10 Core Work Types)</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
              Supported Job Types & Autonomous Delivery Engines
            </h1>
            <p className="text-slate-400 text-sm mt-1 max-w-3xl leading-relaxed">
              Every job category includes automated ingestion filters, platform matching, and a deterministic code/deliverable engine that produces production-grade files (.csv, .xlsx, .docx, .py, .gs, .srt, .png, etc.).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Engine Types</span>
              <span className="text-lg font-bold text-emerald-400">10 / 10 Active</span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2.5 text-center">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block">AI Orchestrator</span>
              <span className="text-lg font-bold text-blue-400">Gemini 3.8</span>
            </div>
          </div>
        </div>

        {/* Search / Filter bar */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by category, deliverable, tech..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-950/90 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Click any category card below to launch its interactive autonomous deliverable generator.</span>
          </div>
        </div>
      </div>

      {/* 10 Categories Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5">
        {filteredCategories.map((cat) => {
          const isSelected = selectedCategory.id === cat.id;
          return (
            <div
              key={cat.id}
              onClick={() => handleSelectCategory(cat)}
              className={`group cursor-pointer rounded-xl border p-3.5 transition-all duration-200 relative flex flex-col justify-between ${
                isSelected
                  ? 'border-blue-500 bg-blue-950/20 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60">
                    {getCategoryIcon(cat.id)}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cat.badgeColor}`}>
                    {cat.deliverableFormats.join(' ')}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">
                  {cat.category}
                </h3>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {cat.examples}
                </p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-1.5 text-[11px]">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Deliverable:</span>
                  <span className="text-slate-200 font-medium font-mono">{cat.deliverables}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Tech Needed:</span>
                  <span className="text-blue-400 font-mono truncate block">{cat.techNeeded}</span>
                </div>
                <div className="pt-1 flex items-center justify-between text-slate-400">
                  <span className="text-emerald-400 font-semibold">${cat.typicalBudgetRange.min} - ${cat.typicalBudgetRange.max}</span>
                  <span className="text-[10px] text-blue-400 font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    {isSelected ? 'Active Tool' : 'Select'} <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Interactive Autonomous Engine & Generator Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Job Configuration & Presets (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30">
                  {getCategoryIcon(selectedCategory.id)}
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">{selectedCategory.category} Engine</h2>
                  <span className="text-xs text-slate-400 font-mono">Deliverables: {selectedCategory.deliverables}</span>
                </div>
              </div>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${selectedCategory.badgeColor}`}>
                READY
              </span>
            </div>

            {/* Tech Stack Chips */}
            <div className="mt-3.5 flex flex-wrap gap-1.5">
              {selectedCategory.techStack.map(t => (
                <span key={t} className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
                  {t}
                </span>
              ))}
            </div>

            {/* Presets Selector */}
            <div className="mt-4">
              <label className="text-xs font-semibold text-slate-400 block mb-1.5">
                Pre-configured Real Marketplace Gigs:
              </label>
              <div className="space-y-1.5">
                {selectedCategory.sampleJobs.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPreset(p)}
                    className="w-full text-left p-2 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/50 transition-all flex items-center justify-between text-xs"
                  >
                    <div className="truncate pr-2">
                      <span className="font-semibold text-slate-200 block truncate">{p.title}</span>
                      <span className="text-[10px] text-slate-400">{p.platform} • {p.clientLocation}</span>
                    </div>
                    <span className="text-emerald-400 font-bold font-mono shrink-0">${p.budget}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Form Fields */}
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Job Title</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Client Scope & Requirements</label>
                <textarea
                  rows={3}
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Target Contract Payout</label>
                  <div className="relative">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="number"
                      value={customBudget}
                      onChange={(e) => setCustomBudget(Number(e.target.value))}
                      className="w-full pl-7 pr-3 py-1.5 text-xs rounded-xl bg-slate-950 border border-slate-800 text-white font-mono font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Target Deliverable</label>
                  <div className="px-3 py-1.5 text-xs rounded-xl bg-slate-950 border border-slate-800 text-cyan-300 font-mono font-semibold truncate">
                    {selectedCategory.deliverables}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-5 space-y-2">
              <button
                onClick={handleExecuteEngine}
                disabled={isExecuting || !customTitle.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                {isExecuting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Executing {selectedCategory.category} Pipeline...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Run Autonomous Solver & Build Deliverables</span>
                  </>
                )}
              </button>

              {onSelectCategoryFilter && (
                <button
                  onClick={() => onSelectCategoryFilter(selectedCategory.category)}
                  className="w-full py-2 px-4 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white font-medium text-xs border border-slate-700 flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span>Filter Live Work Orders by "{selectedCategory.category}"</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Deliverable Viewer (7 cols) */}
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden flex flex-col h-full min-h-[520px]">
            {/* Deliverable Viewer Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse" />
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>Generated Deliverable Artifacts</span>
                    {executionResult && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-normal">
                        {executionResult.files.length} Files Generated ({executionResult.linesOfCode} LOC)
                      </span>
                    )}
                  </h3>
                </div>
              </div>

              {executionResult && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCurrentFile}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs flex items-center gap-1 cursor-pointer"
                    title="Copy active file content"
                  >
                    {copiedFile ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span className="text-[11px]">{copiedFile ? 'Copied!' : 'Copy'}</span>
                  </button>

                  <button
                    onClick={handleDownloadAllFiles}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs flex items-center gap-1 cursor-pointer"
                    title="Download active file"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[11px]">Download</span>
                  </button>

                  {onAddWorkOrder && (
                    <button
                      onClick={handleAddLiveWorkOrder}
                      disabled={addedToOrders}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                        addedToOrders
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{addedToOrders ? 'Added to Orders' : 'Queue into Work Orders'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Content Area */}
            {isExecuting ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-12 h-12 border-3 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-4" />
                <h4 className="text-base font-bold text-white mb-1">Synthesizing {selectedCategory.category} Package</h4>
                <p className="text-xs text-slate-400 max-w-md">
                  Autonomous solver is generating production-grade source code, data outputs, test suites, and client handover notes for "{customTitle}".
                </p>
                <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 text-[11px] text-blue-400 font-mono">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Targeting formats: {selectedCategory.deliverables}</span>
                </div>
              </div>
            ) : executionResult ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* File Tabs */}
                <div className="flex items-center gap-1 px-3 pt-2 bg-slate-950 border-b border-slate-800 overflow-x-auto">
                  {executionResult.files.map((file, idx) => (
                    <button
                      key={file.filename}
                      onClick={() => setActiveFileIndex(idx)}
                      className={`px-3 py-1.5 text-xs font-mono rounded-t-lg transition-colors border-t border-x cursor-pointer flex items-center gap-2 whitespace-nowrap ${
                        activeFileIndex === idx
                          ? 'bg-slate-900 text-white border-slate-700 border-b-transparent'
                          : 'bg-transparent text-slate-400 border-transparent hover:text-slate-200'
                      }`}
                    >
                      <span>{file.filename}</span>
                      <span className="text-[10px] text-slate-500 uppercase">{file.language}</span>
                    </button>
                  ))}
                </div>

                {/* File Meta Bar */}
                <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                  <span className="truncate pr-2">
                    <strong className="text-slate-200">Description:</strong> {executionResult.files[activeFileIndex]?.description}
                  </span>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] font-mono">
                    <span className="flex items-center gap-1 text-slate-400">
                      <Clock className="w-3 h-3 text-blue-400" />
                      {executionResult.executionTimeMs}ms
                    </span>
                    <span className="text-slate-500">SHA: {executionResult.checksum}</span>
                  </div>
                </div>

                {/* Code / Content Display */}
                <div className="flex-1 p-4 bg-[#0a0f1d] overflow-auto max-h-[380px] font-mono text-xs text-slate-300">
                  <pre className="whitespace-pre-wrap break-all leading-relaxed select-text">
                    {executionResult.files[activeFileIndex]?.content}
                  </pre>
                </div>

                {/* Summary & Client Verification Footer */}
                <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Architecture & Tech Notes:
                      </span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        {executionResult.architectureNotes}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                        Client Handover Message:
                      </span>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        {executionResult.clientHandoverNote}
                      </p>
                    </div>
                  </div>

                  {/* Verification Checklist */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {executionResult.verificationChecklist.map((item, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{item}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500">
                <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 mb-3">
                  <Layers className="w-8 h-8 text-slate-600" />
                </div>
                <h4 className="text-sm font-semibold text-slate-300 mb-1">Ready for Execution</h4>
                <p className="text-xs text-slate-500 max-w-sm">
                  Select a category and preset job on the left, then click <strong>"Run Autonomous Solver"</strong> to build the full deliverable package with real files.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
