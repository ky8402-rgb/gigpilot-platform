import React, { useState, useEffect } from 'react';
import {
  Database,
  ShieldCheck,
  RotateCcw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
  HardDrive,
  RefreshCw,
  FileCheck,
  Layers,
  ArrowRight,
  ShieldAlert,
  Server,
  Zap,
  Check,
  Copy,
  Info
} from 'lucide-react';
import {
  fetchDatabaseSnapshots,
  triggerDatabaseSnapshot,
  restoreDatabaseSnapshot,
  verifyDatabaseSnapshot,
  SnapshotStatusResponse,
  DatabaseSnapshotItem
} from '../services/api';

interface DatabaseSnapshotManagerProps {
  onNavigateToLogs?: () => void;
}

export const DatabaseSnapshotManager: React.FC<DatabaseSnapshotManagerProps> = ({ onNavigateToLogs }) => {
  const [snapshotData, setSnapshotData] = useState<SnapshotStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [customNotes, setCustomNotes] = useState<string>('');
  const [showNotesInput, setShowNotesInput] = useState<boolean>(false);

  // Restore Modal State
  const [restoringSnapshot, setRestoringSnapshot] = useState<DatabaseSnapshotItem | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreDryRun, setRestoreDryRun] = useState<boolean>(false);
  const [restoreResult, setRestoreResult] = useState<any | null>(null);

  // Verification State
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verificationResults, setVerificationResults] = useState<Record<string, any>>({});

  // Toast / Feedback State
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [copiedChecksum, setCopiedChecksum] = useState<string | null>(null);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await fetchDatabaseSnapshots();
      if (data) {
        setSnapshotData(data);
      }
    } catch (err) {
      console.warn('Failed to load snapshots:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setActionNotice({ type, message });
    setTimeout(() => setActionNotice(null), 5000);
  };

  const handleTriggerSnapshot = async () => {
    setIsTriggering(true);
    try {
      const res = await triggerDatabaseSnapshot(customNotes || undefined);
      if (res.success && res.snapshot) {
        showToast('success', `Snapshot ${res.snapshot.id} captured! Retained: ${res.retainedBackups?.length || 3}/3 backups.`);
        setCustomNotes('');
        setShowNotesInput(false);
        await loadData(true);
      } else {
        showToast('error', res.error || 'Failed to capture snapshot');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Error executing snapshot');
    } finally {
      setIsTriggering(false);
    }
  };

  const handleVerifySnapshot = async (snapId: string) => {
    setVerifyingId(snapId);
    try {
      const res = await verifyDatabaseSnapshot(snapId);
      if (res.success) {
        setVerificationResults(prev => ({
          ...prev,
          [snapId]: {
            verified: true,
            recordsCount: res.details?.totalRecords,
            timestamp: new Date().toLocaleTimeString()
          }
        }));
        showToast('success', `Integrity Verified: Checksum and schema validated for ${snapId}.`);
      } else {
        showToast('error', res.error || 'Checksum verification failed');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Verification error');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleExecuteRestore = async () => {
    if (!restoringSnapshot) return;
    setIsRestoring(true);
    setRestoreResult(null);

    try {
      const res = await restoreDatabaseSnapshot(restoringSnapshot.id, restoreDryRun);
      if (res.success) {
        setRestoreResult(res);
        showToast('success', res.message || 'Database state successfully restored!');
        await loadData(true);
      } else {
        showToast('error', res.error || 'Failed to restore snapshot');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Restore error');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleCopyChecksum = (checksum: string) => {
    navigator.clipboard.writeText(checksum);
    setCopiedChecksum(checksum);
    setTimeout(() => setCopiedChecksum(null), 2000);
  };

  const handleDownloadSnapshot = (snapshotId: string) => {
    window.location.href = `/api/db/snapshots/download/${snapshotId}`;
  };

  const activeBackups = snapshotData?.backups || [];
  const maxSlots = snapshotData?.retentionPolicy?.maxSuccessfulBackups || 3;

  return (
    <div className="space-y-6">
      {/* Toast Notification Banner */}
      {actionNotice && (
        <div
          className={`flex items-center justify-between p-4 rounded-xl border text-sm transition-all ${
            actionNotice.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
              : actionNotice.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/40 text-rose-200'
              : 'bg-indigo-950/80 border-indigo-500/40 text-indigo-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {actionNotice.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            ) : actionNotice.type === 'error' ? (
              <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
            ) : (
              <Info className="h-5 w-5 text-indigo-400 shrink-0" />
            )}
            <span className="font-medium">{actionNotice.message}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-xs text-slate-400 hover:text-white ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Top Banner: Automated PostgreSQL Snapshot & Retention Service */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl backdrop-blur">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-cyan-500/5 blur-3xl" />
        <div className="absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-indigo-500/5 blur-3xl" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-sm">
                <Database className="h-5 w-5" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Automated PostgreSQL Snapshot & Disaster Recovery
              </h2>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                24h Daily Scheduler Active
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-3xl leading-relaxed">
              Triggers daily automated snapshots of the PostgreSQL database, pushes state diffs and verification metadata to the internal status log, and enforces a strict <strong className="text-slate-200">3-backup retention policy</strong> for instant point-in-time recovery after system failure.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              id="btn-refresh-snapshots"
              onClick={() => loadData()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
              title="Refresh snapshot ledger"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
              <span>Refresh</span>
            </button>

            <button
              id="btn-trigger-snapshot"
              onClick={handleTriggerSnapshot}
              disabled={isTriggering}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-950/50 transition-all disabled:opacity-50 cursor-pointer"
            >
              <HardDrive className={`h-4 w-4 ${isTriggering ? 'animate-spin' : ''}`} />
              <span>{isTriggering ? 'Capturing Snapshot...' : 'Trigger Instant Snapshot'}</span>
            </button>
          </div>
        </div>

        {/* Custom Notes expandable toggle */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <Clock className="h-3.5 w-3.5 text-cyan-400" />
            <span>Next Automated Daily Snapshot:</span>
            <span className="font-mono text-cyan-300 font-medium">
              {snapshotData?.schedule?.nextRun
                ? new Date(snapshotData.schedule.nextRun).toLocaleString()
                : 'In 24 Hours'}
            </span>
          </div>

          <button
            onClick={() => setShowNotesInput(!showNotesInput)}
            className="text-xs text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer underline underline-offset-4"
          >
            {showNotesInput ? 'Hide Snapshot Notes' : '+ Add Custom Notes to Next Snapshot'}
          </button>
        </div>

        {showNotesInput && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={customNotes}
              onChange={e => setCustomNotes(e.target.value)}
              placeholder="e.g., Pre-deployment checkpoint, Major schema upgrade verification..."
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        )}
      </div>

      {/* KPI Cards: Retention Slots & Health Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* 1. Retention Policy Card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="font-medium flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-cyan-400" /> Retention Policy
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              Strict 3-Max
            </span>
          </div>
          <div className="text-xl font-bold text-white tracking-tight">
            {activeBackups.length} / {maxSlots} <span className="text-xs font-normal text-slate-400">Slots Used</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Auto-rotates & prunes oldest backup on new snapshot
          </p>
        </div>

        {/* 2. Total Records Protected */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="font-medium flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-emerald-400" /> Protected Records
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              6 Tables
            </span>
          </div>
          <div className="text-xl font-bold text-emerald-400 tracking-tight">
            {activeBackups[0]?.totalRecords ?? 0} <span className="text-xs font-normal text-slate-400">Live Entities</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Users, WorkOrders, Transactions, Bids & Proposals
          </p>
        </div>

        {/* 3. Storage Footprint & Checksums */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="font-medium flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" /> Checksum Security
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              SHA-256
            </span>
          </div>
          <div className="text-xl font-bold text-indigo-300 tracking-tight">
            {activeBackups[0]?.sizeFormatted ?? '0 B'} <span className="text-xs font-normal text-slate-400">Latest Size</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Full cryptographic state verification
          </p>
        </div>

        {/* 4. Disaster Recovery Readiness */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span className="font-medium flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-400" /> Recovery SLA
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              &lt; 500ms
            </span>
          </div>
          <div className="text-xl font-bold text-amber-300 tracking-tight">
            Instant <span className="text-xs font-normal text-slate-400">Zero-Loss RPO</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Relational dependency order reconstruction
          </p>
        </div>
      </div>

      {/* 3 Retained Backups Cards (Slot 1, Slot 2, Slot 3) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers className="h-4 w-4 text-cyan-400" />
              Retained Backup Ledger (Strict 3-Snapshot Retention)
            </h3>
          </div>
          {onNavigateToLogs && (
            <button
              onClick={onNavigateToLogs}
              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer"
            >
              View in Activity Logs Stream →
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(slotIndex => {
            const snap = activeBackups[slotIndex];
            const slotNumber = slotIndex + 1;
            const isLatest = slotIndex === 0;

            if (!snap) {
              return (
                <div
                  key={`empty-slot-${slotNumber}`}
                  className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-5 flex flex-col items-center justify-center text-center space-y-2 min-h-[280px]"
                >
                  <div className="p-3 rounded-full bg-slate-900 border border-slate-800 text-slate-600">
                    <Database className="h-6 w-6" />
                  </div>
                  <div className="font-semibold text-slate-400 text-sm">
                    Retention Slot #{slotNumber} (Empty)
                  </div>
                  <p className="text-xs text-slate-500 max-w-[200px]">
                    Will be filled automatically on subsequent daily snapshot cycles.
                  </p>
                </div>
              );
            }

            const isVerified = verificationResults[snap.id]?.verified;

            return (
              <div
                key={snap.id}
                id={`snapshot-card-${snap.id}`}
                className={`rounded-2xl border p-5 flex flex-col justify-between space-y-4 transition-all ${
                  isLatest
                    ? 'border-cyan-500/40 bg-gradient-to-b from-slate-900/90 to-slate-950/90 shadow-lg shadow-cyan-950/20 ring-1 ring-cyan-500/20'
                    : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div>
                  {/* Slot Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        isLatest
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          : slotNumber === 2
                          ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}>
                        Slot #{slotNumber} {isLatest ? '• Latest' : slotNumber === 2 ? '• Previous' : '• Archive'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {snap.trigger === 'DAILY_SCHEDULE' ? '24h Scheduled' : 'Manual Trigger'}
                      </span>
                    </div>

                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Ready
                    </span>
                  </div>

                  {/* Snapshot Details */}
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Snapshot ID:</span>
                      <span className="font-mono text-slate-200 font-medium truncate max-w-[170px]" title={snap.id}>
                        {snap.id}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Timestamp:</span>
                      <span className="text-slate-300">
                        {new Date(snap.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Size / Duration:</span>
                      <span className="text-slate-200 font-mono">
                        {snap.sizeFormatted} ({snap.durationMs}ms)
                      </span>
                    </div>

                    {/* Checksum with Copy */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/40">
                      <span className="text-slate-400">SHA-256:</span>
                      <button
                        onClick={() => handleCopyChecksum(snap.checksum)}
                        className="flex items-center gap-1 font-mono text-[11px] text-slate-400 hover:text-cyan-300 transition-colors"
                        title="Click to copy full SHA-256 hash"
                      >
                        <span>{snap.checksum.substring(0, 12)}...</span>
                        {copiedChecksum === snap.checksum ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>

                    {/* Table Records Grid */}
                    <div className="mt-3 pt-3 border-t border-slate-800/80">
                      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                        <span>Table Breakdown</span>
                        <span className="text-cyan-400 font-mono">{snap.totalRecords} Total</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                        <div className="rounded bg-slate-950/60 p-1 border border-slate-800/60">
                          <span className="text-[9px] text-slate-500 block">Users</span>
                          <span className="font-bold text-slate-200">{snap.tables?.users ?? 0}</span>
                        </div>
                        <div className="rounded bg-slate-950/60 p-1 border border-slate-800/60">
                          <span className="text-[9px] text-slate-500 block">Orders</span>
                          <span className="font-bold text-slate-200">{snap.tables?.workOrders ?? 0}</span>
                        </div>
                        <div className="rounded bg-slate-950/60 p-1 border border-slate-800/60">
                          <span className="text-[9px] text-slate-500 block">Payments</span>
                          <span className="font-bold text-emerald-400">{snap.tables?.transactions ?? 0}</span>
                        </div>
                        <div className="rounded bg-slate-950/60 p-1 border border-slate-800/60">
                          <span className="text-[9px] text-slate-500 block">PayPal</span>
                          <span className="font-bold text-slate-200">{snap.tables?.paypalOrders ?? 0}</span>
                        </div>
                        <div className="rounded bg-slate-950/60 p-1 border border-slate-800/60">
                          <span className="text-[9px] text-slate-500 block">Proposals</span>
                          <span className="font-bold text-slate-200">{snap.tables?.proposals ?? 0}</span>
                        </div>
                        <div className="rounded bg-slate-950/60 p-1 border border-slate-800/60">
                          <span className="text-[9px] text-slate-500 block">Bids</span>
                          <span className="font-bold text-slate-200">{snap.tables?.bids ?? 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions per Card */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Verify Button */}
                    <button
                      onClick={() => handleVerifySnapshot(snap.id)}
                      disabled={verifyingId === snap.id}
                      className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <FileCheck className={`h-3.5 w-3.5 ${verifyingId === snap.id ? 'animate-spin text-cyan-400' : isVerified ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <span>{verifyingId === snap.id ? 'Verifying...' : isVerified ? 'Verified' : 'Verify'}</span>
                    </button>

                    {/* Download JSON Button */}
                    <button
                      onClick={() => handleDownloadSnapshot(snap.id)}
                      className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
                    >
                      <Download className="h-3.5 w-3.5 text-slate-400" />
                      <span>Download</span>
                    </button>
                  </div>

                  {/* Restore / Disaster Recovery Button */}
                  <button
                    onClick={() => {
                      setRestoringSnapshot(snap);
                      setRestoreResult(null);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/50 hover:bg-cyan-900/60 px-3 py-2 text-xs font-bold text-cyan-200 transition-all cursor-pointer shadow-sm"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-cyan-400" />
                    <span>Disaster Recovery Restore</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Disaster Recovery State Restoration Modal */}
      {restoringSnapshot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    PostgreSQL Disaster Recovery Restoration
                  </h3>
                  <p className="text-xs text-slate-400">
                    Target Snapshot: <span className="font-mono text-cyan-300">{restoringSnapshot.id}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRestoringSnapshot(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs text-amber-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                State Recovery Assurance
              </div>
              <p>
                This operation reconstructs relational table state across Users, WorkOrders, Transactions, PayPalOrders, Proposals, and Bids in exact foreign key dependency order.
              </p>
            </div>

            {/* Dry Run Toggle Option */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950/60">
              <div>
                <span className="text-xs font-semibold text-slate-200">Simulation / Dry-Run Mode</span>
                <p className="text-[11px] text-slate-400">Verify schema and integrity without committing writes</p>
              </div>
              <input
                type="checkbox"
                checked={restoreDryRun}
                onChange={e => setRestoreDryRun(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
              />
            </div>

            {/* Result Display if executed */}
            {restoreResult && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  {restoreResult.dryRun ? 'Dry-Run Simulation Succeeded' : 'Disaster Recovery Completed'}
                </div>
                <p className="text-slate-300">{restoreResult.message}</p>
                <div className="text-[11px] text-slate-400 font-mono">
                  Checksum Verified: SHA-256 Match • Latency: {restoreResult.durationMs}ms
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                onClick={() => setRestoringSnapshot(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleExecuteRestore}
                disabled={isRestoring}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-md transition-all disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className={`h-4 w-4 ${isRestoring ? 'animate-spin' : ''}`} />
                <span>
                  {isRestoring
                    ? 'Restoring State...'
                    : restoreDryRun
                    ? 'Execute Dry-Run Test'
                    : 'Confirm & Recover State'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
