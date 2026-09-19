import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { fetchContractOperationsSummary, ContractOperationsSummary } from "../services/api";

const stateLabels: Record<string,string> = {
  DISCOVERED:"Discovered", QUALIFIED:"Qualified", PROPOSAL_READY:"Proposal ready",
  BID_SUBMITTED:"Bid submitted", AWARDED:"Awarded", ACCEPTED:"Accepted",
  FUNDED:"Funded", EXECUTING:"Executing", QUALITY_VERIFIED:"Quality verified",
  DELIVERED:"Delivered", CLIENT_APPROVED:"Client approved",
  SETTLEMENT_PENDING:"Settlement pending", PROVIDER_CONFIRMED:"Provider confirmed",
  SETTLED:"Settled", BLOCKED:"Blocked"
};

export const ContractOperationsPanel: React.FC = () => {
  const [data,setData] = useState<ContractOperationsSummary|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [loading,setLoading] = useState(true);

  const refresh = async () => {
    try { setLoading(true); setError(null); setData(await fetchContractOperationsSummary()); }
    catch (e:any) { setError(e?.message || "Contract telemetry unavailable"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Activity className="h-5 w-5" /> Contract Operations
          </div>
          <p className="mt-1 text-sm text-slate-500">Live lifecycle state, bottlenecks and stalled contracts.</p>
        </div>
        <button onClick={refresh} disabled={loading} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-50" title="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</div>
      ) : !data ? (
        <div className="text-sm text-slate-500">Loading contract telemetry…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Active" value={data.activeContracts} />
            <Metric label="Settled" value={data.settledContracts} />
            <Metric label="Blocked" value={data.blockedContracts} warning={data.blockedContracts > 0} />
            <Metric label="Stalled >6h" value={data.stalledContracts} warning={data.stalledContracts > 0} />
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Lifecycle</div>
            <div className="flex gap-1 overflow-x-auto pb-2">
              {Object.entries(data.byState).map(([state,count]) => (
                <div key={state} className="min-w-[112px] rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">{stateLabels[state] || state}</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">{count}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {data.operations.filter(o => o.blockingReasons.length || o.state === "SETTLEMENT_PENDING").slice(0,5).map(o => (
              <div key={o.id} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                {o.state === "SETTLEMENT_PENDING" ? <Clock3 className="mt-0.5 h-4 w-4 text-amber-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{o.title}</div>
                  <div className="text-xs text-slate-500">{stateLabels[o.state] || o.state} · {o.clientName}</div>
                  {o.blockingReasons.length > 0 && <div className="mt-1 text-xs text-amber-700">{o.blockingReasons.join(" · ")}</div>}
                </div>
              </div>
            ))}
            {data.operations.every(o => !o.blockingReasons.length && o.state !== "SETTLEMENT_PENDING") && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4" /> No active contract bottlenecks detected.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};

function Metric({label,value,warning=false}:{label:string;value:number;warning?:boolean}) {
  return <div className={`rounded-xl border p-3 ${warning ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
    <div className="text-xs text-slate-500">{label}</div>
    <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
  </div>;
}
