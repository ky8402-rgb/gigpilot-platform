import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCw,
  UserCheck,
  ShieldCheck,
  Send,
  Building2,
  ExternalLink,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Wallet,
  Clock,
  Check,
  Copy,
  Zap
} from 'lucide-react';

export interface LiveMilestone {
  id: string;
  title: string;
  amount: number;
  completed: boolean;
  status: 'PENDING' | 'FUNDED' | 'RELEASED';
}

export interface LiveOrder {
  id: string;
  title: string;
  clientName: string;
  clientEmail?: string;
  amount: number;
  currency: string;
  category: string;
  platform: string;
  status: string;
  paymentStatus: 'UNFUNDED' | 'PENDING' | 'FUNDED';
  paypalOrderId?: string;
  paypalCaptureId?: string;
  payoutStatus?: 'UNPAID' | 'SUBMITTED' | 'SETTLED';
  payoutBatchId?: string;
  payoutDestination?: string;
  milestones: LiveMilestone[];
  createdAt: string;
  fundedAt?: string;
}

interface Props {
  showToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const MasterAgentLifecycleTool: React.FC<Props> = ({ showToast }) => {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRunningPipeline, setIsRunningPipeline] = useState<boolean>(false);
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/master-agent/orders');
      if (res.ok) {
        const data = await res.json();
        if (data.orders && Array.isArray(data.orders)) {
          setOrders(data.orders);
          if (!selectedOrderId && data.orders.length > 0) {
            setSelectedOrderId(data.orders[0].id);
          }
        }
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 12000);
    return () => clearInterval(interval);
  }, []);

  const selectedOrder = orders.find(o => o.id === selectedOrderId) || orders[0];

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    showToast?.(`Copied ${text}`, 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Run a specific Master Agent action
  const executeAction = async (action: string, milestoneId?: string) => {
    if (!selectedOrder) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/master-agent/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          orderId: selectedOrder.id,
          amount: selectedOrder.amount,
          currency: selectedOrder.currency || 'USD',
          milestoneId,
          payoutEmail: 'ky8402@gmail.com',
        }),
      });

      const data = await res.json();
      if (data.success) {
        showToast?.(`✅ ${data.message}`, 'success');
        await fetchOrders();
      } else {
        showToast?.(`⚠️ ${data.message}`, 'error');
      }
    } catch (err: any) {
      showToast?.(`Action failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-cycle the complete 5-step pipeline end-to-end
  const handleAutoCycle = async () => {
    if (!selectedOrder) return;
    setIsRunningPipeline(true);
    setPipelineLogs(['Initiating Master Agent autonomous 5-step pipeline...']);
    try {
      const res = await fetch('/api/master-agent/auto-cycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          payoutEmail: 'ky8402@gmail.com',
        }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.pipelineLog) {
          setPipelineLogs(data.pipelineLog);
        }
        showToast?.(`🚀 ${data.message}`, 'success');
        await fetchOrders();
      } else {
        showToast?.(`❌ Pipeline error: ${data.message}`, 'error');
      }
    } catch (err: any) {
      showToast?.(`Pipeline execution failed: ${err.message}`, 'error');
    } finally {
      setIsRunningPipeline(false);
    }
  };

  // Create a new client hire
  const handleCreateClientHire = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/master-agent/new-client-hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Autonomous Payment & Escrow Settlement Automation',
          clientName: 'Global Enterprise Solutions Inc.',
          amount: 500,
          category: 'Simple coding',
          platform: 'Direct',
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast?.(`🎉 ${data.message}`, 'success');
        await fetchOrders();
        if (data.order?.id) {
          setSelectedOrderId(data.order.id);
        }
      }
    } catch (err: any) {
      showToast?.(`Failed to create hire: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const isFunded = selectedOrder?.paymentStatus === 'FUNDED';
  const hasReleasedMilestone = selectedOrder?.milestones?.some(m => m.status === 'RELEASED');
  const isPaidOut = selectedOrder?.payoutStatus === 'SUBMITTED' || selectedOrder?.payoutStatus === 'SETTLED';
  const isOrderClosed = selectedOrder?.status === 'completed';

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-2xl backdrop-blur-sm space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Zap className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Autonomous Master Agent: 5-Step Payment &amp; Escrow Pipeline
            </h2>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
              Live REST Engine
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Solves the payment lifecycle: Automatically transitions contracts from <strong className="text-slate-200">Client Hire</strong> → <strong className="text-emerald-400">Escrow Funded</strong> → <strong className="text-cyan-400">Milestone Release</strong> → <strong className="text-sky-400">PayPal &amp; Payoneer Citibank Transfer</strong> → <strong className="text-emerald-400">Your Bank</strong>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchOrders}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleCreateClientHire}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition"
          >
            <UserCheck className="h-3.5 w-3.5" />
            + New Client Hire
          </button>
          <button
            onClick={handleAutoCycle}
            disabled={isRunningPipeline || !selectedOrder}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
          >
            <Play className={`h-3.5 w-3.5 ${isRunningPipeline ? 'animate-spin' : ''}`} />
            {isRunningPipeline ? 'Executing 5-Step Pipeline...' : 'Auto-Execute 5-Step Pipeline'}
          </button>
        </div>
      </div>

      {/* Active Client Orders Ribbon */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>Active Client Contracts ({orders.length} Active Hires)</span>
          <span className="text-[11px] text-slate-500">Select order to inspect or execute</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {orders.map((ord) => (
            <div
              key={ord.id}
              onClick={() => setSelectedOrderId(ord.id)}
              className={`cursor-pointer rounded-xl p-3 border transition-all ${
                selectedOrder?.id === ord.id
                  ? 'border-emerald-500/60 bg-emerald-950/20 shadow-md shadow-emerald-500/5 ring-1 ring-emerald-500/40'
                  : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-semibold text-white truncate max-w-[140px]">{ord.clientName}</span>
                <span className="font-mono font-bold text-emerald-400">${ord.amount} USD</span>
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-1">{ord.title}</p>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/60 text-[10px]">
                <span className={`px-1.5 py-0.5 rounded font-mono font-semibold ${
                  ord.paymentStatus === 'FUNDED' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                }`}>
                  {ord.paymentStatus === 'FUNDED' ? 'ESCROW FUNDED' : 'ESCROW PENDING'}
                </span>
                <span className={`px-1.5 py-0.5 rounded font-mono ${
                  ord.status === 'completed' ? 'bg-sky-500/20 text-sky-300 font-semibold' : 'bg-slate-800 text-slate-400'
                }`}>
                  {ord.status.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Order 5-Step Lifecycle Visualizer */}
      {selectedOrder && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <span className="text-[11px] font-mono text-cyan-400">Contract #{selectedOrder.id}</span>
              <h3 className="text-sm font-bold text-white">{selectedOrder.title}</h3>
              <p className="text-xs text-slate-400">Client: <strong className="text-slate-200">{selectedOrder.clientName}</strong> ({selectedOrder.clientEmail || 'verified@client.io'})</p>
            </div>
            <div className="text-right">
              <div className="text-lg font-mono font-extrabold text-emerald-400">${selectedOrder.amount}.00 USD</div>
              <span className="text-[10px] text-slate-500">Fixed Milestone Contract</span>
            </div>
          </div>

          {/* THE 5 STEPS */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5 pt-1">
            {/* STEP 1: Client Hires You */}
            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3 flex flex-col justify-between space-y-2">
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-1">
                  <span>1. Client Hires</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="text-[10px] text-slate-400">
                  Client contract active with {selectedOrder.clientName}.
                </p>
              </div>
              <div className="pt-2 border-t border-slate-800 text-[10px]">
                <span className="text-emerald-400 font-medium">✅ Hired &amp; Active</span>
              </div>
            </div>

            {/* STEP 2: Client Pays into Escrow */}
            <div className={`rounded-lg border p-3 flex flex-col justify-between space-y-2 ${
              isFunded ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-amber-500/40 bg-amber-950/20'
            }`}>
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                  <span className={isFunded ? 'text-emerald-300' : 'text-amber-300'}>2. Escrow Payment</span>
                  {isFunded ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Clock className="h-4 w-4 text-amber-400" />}
                </div>
                <p className="text-[10px] text-slate-400">
                  {isFunded
                    ? `Funded: $${selectedOrder.amount} USD in Escrow`
                    : 'Awaiting client escrow funding'}
                </p>
                {selectedOrder.paypalCaptureId && (
                  <span className="text-[9px] font-mono text-emerald-400 block truncate mt-1">
                    Ref: {selectedOrder.paypalCaptureId}
                  </span>
                )}
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                {!isFunded ? (
                  <button
                    onClick={() => executeAction('CREATE_PAYMENT')}
                    disabled={isLoading}
                    className="w-full text-[10px] py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium rounded border border-amber-500/40 transition"
                  >
                    Fund Escrow Now
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-medium">✅ Funded in Escrow</span>
                )}
              </div>
            </div>

            {/* STEP 3: Client Releases Milestone */}
            <div className={`rounded-lg border p-3 flex flex-col justify-between space-y-2 ${
              hasReleasedMilestone ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/80'
            }`}>
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                  <span className={hasReleasedMilestone ? 'text-emerald-300' : 'text-slate-300'}>3. Release Milestone</span>
                  {hasReleasedMilestone ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Clock className="h-4 w-4 text-slate-500" />}
                </div>
                <p className="text-[10px] text-slate-400">
                  {hasReleasedMilestone
                    ? 'Deliverable accepted & released'
                    : 'Deliverable ready for release'}
                </p>
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                {!hasReleasedMilestone ? (
                  <button
                    onClick={() => executeAction('RELEASE_MILESTONE')}
                    disabled={isLoading || !isFunded}
                    className="w-full text-[10px] py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-medium rounded border border-cyan-500/40 transition disabled:opacity-40"
                  >
                    Release Milestone
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-medium">✅ Milestone Released</span>
                )}
              </div>
            </div>

            {/* STEP 4: Platform Sends to Payoneer & PayPal */}
            <div className={`rounded-lg border p-3 flex flex-col justify-between space-y-2 ${
              isPaidOut ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/80'
            }`}>
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                  <span className={isPaidOut ? 'text-emerald-300' : 'text-slate-300'}>4. Platform Payout</span>
                  {isPaidOut ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Clock className="h-4 w-4 text-slate-500" />}
                </div>
                <p className="text-[10px] text-slate-400">
                  {isPaidOut
                    ? `Dispatched: PayPal / Payoneer Wire`
                    : 'Dispatch USD payout from escrow'}
                </p>
                {selectedOrder.payoutBatchId && (
                  <span className="text-[9px] font-mono text-sky-400 block truncate mt-1">
                    {selectedOrder.payoutBatchId}
                  </span>
                )}
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                {!isPaidOut ? (
                  <button
                    onClick={() => executeAction('PAYOUT')}
                    disabled={isLoading || !isFunded}
                    className="w-full text-[10px] py-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 font-medium rounded border border-sky-500/40 transition disabled:opacity-40"
                  >
                    Dispatch Payout
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-medium">✅ Dispatched to PayPal</span>
                )}
              </div>
            </div>

            {/* STEP 5: Payoneer / PayPal → Your Bank */}
            <div className={`rounded-lg border p-3 flex flex-col justify-between space-y-2 ${
              isOrderClosed ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/80'
            }`}>
              <div>
                <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                  <span className={isOrderClosed ? 'text-emerald-300' : 'text-slate-300'}>5. Auto-Sweep Bank</span>
                  {isOrderClosed ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Clock className="h-4 w-4 text-slate-500" />}
                </div>
                <p className="text-[10px] text-slate-400">
                  {isOrderClosed
                    ? 'Settled into Payoneer Citibank'
                    : 'Auto-sweep to Citibank (••••8744)'}
                </p>
              </div>
              <div className="pt-2 border-t border-slate-800/60">
                {!isOrderClosed ? (
                  <button
                    onClick={() => executeAction('CLOSE_ORDER')}
                    disabled={isLoading || !isFunded}
                    className="w-full text-[10px] py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-medium rounded border border-emerald-500/40 transition disabled:opacity-40"
                  >
                    Finalize &amp; Close
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-400 font-medium">✅ Bank Settled</span>
                )}
              </div>
            </div>
          </div>

          {/* Verified Settlement Accounts Summary */}
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 text-sky-400 border border-sky-500/30">
                <Building2 className="h-4 w-4" />
              </span>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">Payoneer USD Checking (Citibank NY)</span>
                  <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-[9px] font-semibold text-sky-300">PRIMARY</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Acc: <strong className="text-slate-200 font-mono">70589110002638744</strong> • ABA: <strong className="text-slate-200 font-mono">031100209</strong> • SWIFT: <strong className="text-slate-200 font-mono">CITIUS33</strong>
                </p>
                <p className="text-[10px] text-slate-500">Beneficiary: Kundan Kumar • 111 Wall Street NY</p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
                <Wallet className="h-4 w-4" />
              </span>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">PayPal Business Merchant</span>
                  <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-[9px] font-semibold text-blue-300">AUTO-SWEEP</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Email: <strong className="text-slate-200 font-mono">ky8402@gmail.com</strong> / <strong className="text-slate-200 font-mono">kundank4@icloud.com</strong>
                </p>
                <p className="text-[10px] text-slate-500">Auto-sweeps received USD to Payoneer Citibank within 24 hours</p>
              </div>
            </div>
          </div>

          {/* Autonomous Pipeline Log Console */}
          {pipelineLogs.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs font-mono space-y-1">
              <div className="text-[10px] font-bold uppercase text-slate-500 flex items-center justify-between pb-1 border-b border-slate-800/80">
                <span>Master Agent Execution Logs</span>
                <span className="text-emerald-400">● LIVE</span>
              </div>
              {pipelineLogs.map((log, i) => (
                <div key={i} className="text-slate-300 text-[11px] leading-relaxed">
                  <span className="text-emerald-400 mr-2">›</span>
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
