import React, { useState, useEffect } from 'react';
import { BackendBidItem, BackendStats, apiUrl } from '../services/api';

interface WithdrawalSummaryProps {
  bids: BackendBidItem[];
  stats?: BackendStats | null;
  onWithdrawPlatform?: (platform: string, amount: number) => void;
  onNotify?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export const WithdrawalSummary: React.FC<WithdrawalSummaryProps> = ({
  bids,
  stats,
  onWithdrawPlatform,
  onNotify,
}) => {
  const [withdrawingBidId, setWithdrawingBidId] = useState<string | null>(null);
  const [withdrawnBidIds, setWithdrawnBidIds] = useState<Set<string>>(new Set());
  const [localBids, setLocalBids] = useState<BackendBidItem[]>(bids);

  // Synchronize localBids when external bids change, keeping track of withdrawn items
  useEffect(() => {
    setLocalBids((prevLocal) => {
      const withdrawnMap = new Set(withdrawnBidIds);
      return bids.map((b) => {
        const id = String(b.id || (b as any).job_id);
        if (withdrawnMap.has(id)) {
          return { ...b, status: 'Paid', work_status: 'Paid' };
        }
        return b;
      });
    });
  }, [bids, withdrawnBidIds]);

  // Extract individual won or completed bids for granular withdrawal
  const wonBids = React.useMemo(() => {
    return localBids.filter((bid) => {
      const status = (bid.status || '').toLowerCase();
      return ['won', 'awarded', 'accepted', 'completed', 'in progress', 'in_progress', 'paid'].includes(status);
    });
  }, [localBids]);

  // Aggregate earnings and won bids by platform
  const platformStats = React.useMemo(() => {
    const summary: Record<
      string,
      {
        name: string;
        platformKey: string;
        wonCount: number;
        earned: number;
        withdrawnAmount: number;
        currency: string;
        payoutUrl: string;
        icon: string;
        badgeColor: string;
        btnBorder: string;
        btnText: string;
        payoutMethod: string;
        feeRate: string;
        sampleBidId?: string;
      }
    > = {
      freelancer: {
        name: 'Freelancer.com',
        platformKey: 'freelancer',
        wonCount: 0,
        earned: 0,
        withdrawnAmount: 0,
        currency: 'USD',
        payoutUrl: 'https://www.freelancer.com/payments/withdraw.php',
        icon: 'fas fa-globe text-sky-400',
        badgeColor: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
        btnBorder: 'border-sky-500/40 hover:border-sky-400 text-sky-300 hover:bg-sky-500/10',
        btnText: '💰 Withdraw on Freelancer',
        payoutMethod: 'PayPal / Wire / Express Payout',
        feeRate: '0% on verified milestones',
      },
      upwork: {
        name: 'Upwork',
        platformKey: 'upwork',
        wonCount: 0,
        earned: 0,
        withdrawnAmount: 0,
        currency: 'USD',
        payoutUrl: 'https://www.upwork.com/nx/navigator/payments/withdraw',
        icon: 'fab fa-upwork text-emerald-400',
        badgeColor: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        btnBorder: 'border-emerald-500/40 hover:border-emerald-400 text-emerald-300 hover:bg-emerald-500/10',
        btnText: '💰 Withdraw on Upwork',
        payoutMethod: 'Direct to Local Bank / PayPal',
        feeRate: 'Weekly scheduled disbursements',
      },
      remoteok: {
        name: 'RemoteOK',
        platformKey: 'remoteok',
        wonCount: 0,
        earned: 0,
        withdrawnAmount: 0,
        currency: 'USD',
        payoutUrl: 'https://remoteok.com',
        icon: 'fas fa-bolt text-orange-400',
        badgeColor: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
        btnBorder: 'border-orange-500/40 hover:border-orange-400 text-orange-300 hover:bg-orange-500/10',
        btnText: '📧 View RemoteOK Jobs',
        payoutMethod: 'Direct Client Invoice / Outreach',
        feeRate: 'Manual Client Outreach',
      },
    };

    localBids.forEach((bid) => {
      const p = (bid.platform || 'freelancer').toLowerCase();
      const status = (bid.status || '').toLowerCase();
      const isWon = ['won', 'awarded', 'accepted', 'completed', 'in progress', 'in_progress', 'paid'].includes(status);
      const isWithdrawn = status === 'paid' || withdrawnBidIds.has(String(bid.id || (bid as any).job_id));
      const amount = Number(bid.bid_amount || 0);

      let key = 'freelancer';
      if (p.includes('upwork')) key = 'upwork';
      else if (p.includes('remote') || p.includes('direct')) key = 'remoteok';

      if (isWon) {
        summary[key].wonCount += 1;
        summary[key].earned += amount;
        if (isWithdrawn) {
          summary[key].withdrawnAmount += amount;
        }
        if (!summary[key].sampleBidId && bid.id) {
          summary[key].sampleBidId = bid.id;
        }
      }
    });

    // Fallback: if total earned is reported in backend stats, allocate to primary platform
    const totalWonAggregated = Object.values(summary).reduce((acc, p) => acc + p.wonCount, 0);
    const totalEarnedAggregated = Object.values(summary).reduce((acc, p) => acc + p.earned, 0);

    if (totalEarnedAggregated === 0 && (stats?.earned || 0) > 0) {
      summary.freelancer.earned = stats?.earned || 0;
      summary.freelancer.wonCount = stats?.won || 1;
    } else if ((stats?.won || 0) > totalWonAggregated && summary.freelancer.wonCount === 0) {
      summary.freelancer.wonCount = stats?.won || 1;
    }

    return Object.values(summary);
  }, [localBids, stats, withdrawnBidIds]);

  const totalEarningsAll = platformStats.reduce((acc, p) => acc + p.earned, 0);
  const totalWonContractsAll = platformStats.reduce((acc, p) => acc + p.wonCount, 0);
  const totalWithdrawnAll = platformStats.reduce((acc, p) => acc + p.withdrawnAmount, 0);

  /**
   * Dedicated withdraw handler:
   * 1. Extracts the exact bidId from the row data and logs it before calling the endpoint.
   * 2. Checks response.ok status and includes a robust .catch() block logging the specific backend error message.
   * 3. Performs a success state transition updating the bid status locally to prevent duplicate requests.
   */
  const handleWithdrawBid = (bid: BackendBidItem) => {
    // 1. Correctly extract bidId from the row and log it to the console before invoking withdrawal function
    const extractedBidId = String(bid.id || (bid as any).job_id || 'bid_won');
    const amount = Number(bid.bid_amount || 0);
    const platform = (bid.platform || 'freelancer').toLowerCase();
    const isFreelancer = platform.includes('freelancer');
    const fallbackPayoutUrl: string = isFreelancer
      ? 'https://www.freelancer.com/payments/withdraw.php'
      : (platform.includes('upwork') ? 'https://www.upwork.com/nx/navigator/payments/withdraw' : 'https://remoteok.com');

    console.log(`[WithdrawalSummary] Extracting bidId from row: "${extractedBidId}" (Database Record ID: "${bid.id || 'N/A'}"). Amount: $${amount} USD, Platform: "${platform}". Invoking withdrawal function now...`);

    setWithdrawingBidId(extractedBidId);
    if (onNotify) {
      onNotify(`Initiating ${isFreelancer ? 'Freelancer.com' : platform} withdrawal for Bid #${extractedBidId} ($${amount.toFixed(2)} USD)...`, 'info');
    }

    // Direct invocation of /api/bids/withdraw with response.ok status checking and .catch() error logging
    fetch(apiUrl('/api/bids/withdraw'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidId: extractedBidId, amount, platform })
    })
      .then(async (response) => {
        // Explicitly check response.ok status
        if (!response.ok) {
          let specificError = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorJson = await response.json();
            if (errorJson && (errorJson.error || errorJson.message)) {
              specificError = errorJson.error || errorJson.message;
            }
          } catch {
            // Body was not JSON
          }
          console.error(`[WithdrawalSummary] /api/bids/withdraw returned failure status ${response.status} for bidId "${extractedBidId}":`, specificError);
          throw new Error(specificError);
        }
        return response.json();
      })
      .then((data) => {
        setWithdrawingBidId(null);
        if (!data || data.success === false) {
          const backendMsg = data?.error || 'Withdrawal rejected or failed on backend service.';
          console.error(`[WithdrawalSummary] /api/bids/withdraw returned unsuccessful payload for bidId "${extractedBidId}":`, backendMsg);
          if (onNotify) {
            onNotify(`Withdrawal notice: ${backendMsg}`, 'warning');
          }
          return;
        }

        console.log(`[WithdrawalSummary] Successfully received 200 OK from /api/bids/withdraw for bidId "${extractedBidId}":`, data);

        // 2. Success state transition: update local state & prevent duplicate requests
        setWithdrawnBidIds((prev) => new Set(prev).add(extractedBidId));
        setLocalBids((prevBids) =>
          prevBids.map((b) => {
            const id = String(b.id || (b as any).job_id);
            if (id === extractedBidId) {
              return {
                ...b,
                status: 'Paid',
                work_status: 'Paid',
              };
            }
            return b;
          })
        );

        if (onNotify) {
          onNotify(`✅ Withdrawal request confirmed for Bid #${extractedBidId} ($${amount.toFixed(2)} USD). Opening financial portal...`, 'success');
        }

        // Open official platform withdrawal portal in a new tab
        const targetUrl = data.withdrawalUrl || fallbackPayoutUrl;
        if (targetUrl && (targetUrl as string) !== '#') {
          const win = window.open(targetUrl, '_blank', 'noopener,noreferrer');
          if (!win) {
            window.location.href = targetUrl;
          }
        }
      })
      .catch((err: any) => {
        setWithdrawingBidId(null);
        const specificError = err?.message || String(err) || 'Unexpected network or server error during withdrawal.';
        console.error(`[WithdrawalSummary] .catch() captured error from /api/bids/withdraw for bidId "${extractedBidId}":`, specificError);
        if (onNotify) {
          onNotify(`Withdrawal Error: ${specificError}`, 'error');
        }

        // Fallback portal redirection even if logging has an issue
        if (fallbackPayoutUrl && (fallbackPayoutUrl as string) !== '#') {
          window.open(fallbackPayoutUrl, '_blank', 'noopener,noreferrer');
        }
      });
  };

  /**
   * Platform-level withdrawal handler with .catch() error logging & duplicate mitigation
   */
  const handleWithdrawPlatform = (platformName: string, payoutUrl: string, amount: number, sampleBidId?: string) => {
    const platformKey = platformName.toLowerCase();
    const matchingBidIds = localBids
      .filter((b) => (b.platform || 'freelancer').toLowerCase().includes(platformKey.includes('upwork') ? 'upwork' : 'freelancer'))
      .map((b) => String(b.id || (b as any).job_id))
      .filter(Boolean);

    const targetBidId = sampleBidId || (matchingBidIds.length > 0 ? matchingBidIds[0]! : 'platform_aggregate');

    console.log(`[WithdrawalSummary] Extracted platform bidId: "${targetBidId}" (All platform IDs: [${matchingBidIds.join(', ')}]) for "${platformName}". Amount: $${amount}. Invoking /api/bids/withdraw...`);

    if (onWithdrawPlatform) {
      onWithdrawPlatform(platformName, amount);
    }

    fetch(apiUrl('/api/bids/withdraw'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bidId: targetBidId, amount, platform: platformKey })
    })
      .then(async (response) => {
        if (!response.ok) {
          let specificError = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errData = await response.json();
            if (errData && errData.error) specificError = errData.error;
          } catch {
            // Non-JSON
          }
          console.error(`[WithdrawalSummary] Platform withdrawal returned failure status ${response.status} for "${platformName}":`, specificError);
          throw new Error(specificError);
        }
        return response.json();
      })
      .then((data) => {
        if (data && data.success) {
          console.log(`[WithdrawalSummary] Platform withdrawal confirmed by /api/bids/withdraw for "${platformName}":`, data);
          // Mark all matching bids as withdrawn locally
          if (matchingBidIds.length > 0) {
            setWithdrawnBidIds((prev) => {
              const updated = new Set(prev);
              matchingBidIds.forEach((id) => updated.add(id));
              return updated;
            });
            setLocalBids((prev) =>
              prev.map((b) => {
                const id = String(b.id || (b as any).job_id);
                if (matchingBidIds.includes(id)) {
                  return { ...b, status: 'Paid', work_status: 'Paid' };
                }
                return b;
              })
            );
          }
        } else {
          console.warn(`[WithdrawalSummary] Platform withdrawal notice for "${platformName}":`, data?.error);
        }

        if (payoutUrl && payoutUrl !== '#') {
          const win = window.open(payoutUrl, '_blank', 'noopener,noreferrer');
          if (!win) {
            window.location.href = payoutUrl;
          }
        }
      })
      .catch((err: any) => {
        const specificError = err?.message || String(err) || 'Platform withdrawal network error';
        console.error(`[WithdrawalSummary] .catch() captured error for platform "${platformName}":`, specificError);
        if (payoutUrl && payoutUrl !== '#') {
          window.open(payoutUrl, '_blank', 'noopener,noreferrer');
        }
      });
  };

  return (
    <div id="withdrawal-summary-section" className="bg-[#111726] rounded-2xl border border-[#1e293b] p-5 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1e293b]/80 mb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm font-bold border border-emerald-500/25">
              <i className="fas fa-money-bill-transfer"></i>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              Withdrawal Summary &amp; Platform Earnings Hub
            </h3>
            <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-0.5 rounded-full font-mono font-bold border border-emerald-500/20">
              Live Payout Portals
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time gross revenue breakdown, awarded contract counts, and instant withdrawal routing across freelance networks.
          </p>
        </div>

        {/* Global summary badges */}
        <div className="flex items-center gap-3 bg-[#161e31] px-3.5 py-2 rounded-xl border border-[#1e293b]">
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Total Settled</div>
            <div className="text-sm font-mono font-extrabold text-emerald-400">
              ${totalEarningsAll.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="h-6 w-px bg-slate-700"></div>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Disbursed</div>
            <div className="text-sm font-mono font-extrabold text-sky-400">
              ${totalWithdrawnAll.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="h-6 w-px bg-slate-700"></div>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Won Jobs</div>
            <div className="text-sm font-mono font-extrabold text-indigo-300">
              {totalWonContractsAll} Awards
            </div>
          </div>
        </div>
      </div>

      {/* Platform Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {platformStats.map((plat) => {
          const isFullyDisbursed = plat.earned > 0 && plat.withdrawnAmount >= plat.earned;
          return (
            <div
              key={plat.platformKey}
              className="bg-[#161e31] rounded-xl border border-[#1e293b] p-4 flex flex-col justify-between hover:border-slate-600 transition-all hover:-translate-y-0.5 shadow-md"
            >
              <div>
                {/* Platform Title & Won Badge */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 font-bold text-sm text-white">
                    <i className={plat.icon}></i>
                    <span>{plat.name}</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${plat.badgeColor}`}>
                    {plat.wonCount} Won {plat.wonCount === 1 ? 'Bid' : 'Bids'}
                  </span>
                </div>

                {/* Earnings Amount */}
                <div className="mb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400">Accumulated Earnings</span>
                    {plat.withdrawnAmount > 0 && (
                      <span className="text-[10px] text-sky-400 font-mono font-semibold">
                        ${plat.withdrawnAmount.toFixed(2)} Disbursed
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-extrabold font-mono text-emerald-400 tracking-tight mt-0.5">
                    ${plat.earned.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    <span className="text-xs font-normal text-slate-500 font-sans">{plat.currency}</span>
                  </div>
                </div>

                {/* Additional Meta info */}
                <div className="space-y-1.5 py-2.5 my-2 border-y border-slate-800/80 text-[11px] text-slate-400">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <i className="fas fa-credit-card text-[10px]"></i> Method:
                    </span>
                    <span className="text-slate-300 font-medium">{plat.payoutMethod}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <i className="fas fa-shield-check text-[10px]"></i> Schedule:
                    </span>
                    <span className="text-slate-300 font-medium">{plat.feeRate}</span>
                  </div>
                </div>
              </div>

              {/* Direct Payout Action Button */}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => handleWithdrawPlatform(plat.name, plat.payoutUrl, plat.earned, plat.sampleBidId)}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-2 cursor-pointer bg-[#0f172a] ${
                    isFullyDisbursed
                      ? 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30'
                      : plat.btnBorder
                  }`}
                  title={plat.platformKey === 'remoteok' ? 'View RemoteOK Jobs' : `Withdraw on ${plat.name}`}
                >
                  <i className={isFullyDisbursed ? 'fas fa-check text-[11px] text-emerald-400' : 'fas fa-arrow-up-right-from-square text-[11px]'}></i>
                  <span>
                    {plat.platformKey === 'remoteok'
                      ? '📧 View RemoteOK Jobs'
                      : isFullyDisbursed
                      ? `✅ ${plat.name} (Disbursed)`
                      : `💰 Withdraw on ${plat.name}`}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Won & Awarded Individual Bids Withdrawal Table */}
      {wonBids.length > 0 && (
        <div className="mt-5 pt-4 border-t border-[#1e293b]/70">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <i className="fas fa-file-invoice-dollar text-emerald-400"></i>
              Awarded Contracts Ready for Withdrawal ({wonBids.length})
            </h4>
            <span className="text-[11px] text-slate-500">
              Database Bid IDs verified &bull; Real-time duplicate prevention
            </span>
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {wonBids.map((bid, idx) => {
              const amount = Number(bid.bid_amount || 0);
              const bidDbId = String(bid.id || (bid as any).job_id || `bid_won_${idx}`);
              const isBusy = withdrawingBidId === bidDbId;
              const isWithdrawn = withdrawnBidIds.has(bidDbId) || (bid.status || '').toLowerCase() === 'paid';
              const isFreelancer = (bid.platform || 'freelancer').toLowerCase().includes('freelancer');

              return (
                <div
                  key={bidDbId}
                  className={`p-2.5 rounded-lg border transition-all flex items-center justify-between gap-3 text-xs ${
                    isWithdrawn
                      ? 'bg-emerald-950/20 border-emerald-500/30'
                      : 'bg-[#161e31] border-[#1e293b]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700">
                      ID: {bidDbId}
                    </span>
                    <span className="font-semibold text-white truncate max-w-[180px] sm:max-w-[260px]">
                      {(bid as any).title || bid.package || 'Contract Project'}
                    </span>
                    <span className="text-emerald-400 font-mono font-bold">
                      ${amount.toFixed(2)} USD
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold border ${
                        isWithdrawn
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                      }`}
                    >
                      {isWithdrawn ? '✅ Paid / Withdrawn' : (bid.status || 'Won')}
                    </span>
                  </div>

                  <button
                    type="button"
                    disabled={isBusy || isWithdrawn}
                    onClick={() => handleWithdrawBid(bid)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                      isWithdrawn
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-default opacity-80'
                        : 'bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 cursor-pointer disabled:opacity-50'
                    }`}
                  >
                    <i
                      className={
                        isBusy
                          ? 'fas fa-spinner fa-spin text-[10px]'
                          : isWithdrawn
                          ? 'fas fa-check-circle text-emerald-400 text-[10px]'
                          : 'fas fa-money-bill-wave text-[10px]'
                      }
                    ></i>
                    <span>
                      {isWithdrawn
                        ? `✅ Disbursed ($${amount.toFixed(2)})`
                        : isFreelancer
                        ? '💰 Withdraw on Freelancer'
                        : '💰 Withdraw on Platform'}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Note & Safety Notice */}
      <div className="mt-4 pt-3 border-t border-[#1e293b]/70 flex flex-col gap-2 text-[11.5px] text-slate-400">
        <div className="flex items-center gap-1.5 text-orange-400/90 font-medium">
          <i className="fas fa-circle-info text-xs"></i>
          <span>RemoteOK leads require manual client outreach. Use the job link to contact the client directly.</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
          <i className="fas fa-shield-halved text-emerald-400 text-xs"></i>
          <span>Direct withdrawal portals require authenticated login on the respective official partner platforms (Freelancer / Upwork).</span>
        </div>
      </div>
    </div>
  );
};


