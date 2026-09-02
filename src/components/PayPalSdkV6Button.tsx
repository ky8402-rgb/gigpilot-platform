import React, { useEffect, useRef, useState } from 'react';
import { 
  ShieldCheck, 
  Loader2, 
  CheckCircle2, 
  Sparkles, 
  AlertCircle, 
  Layers, 
  ExternalLink,
  Zap
} from 'lucide-react';
import { getPayPalSdkV6Instance, configurePayPalButton } from '../services/paypalSdkV6';

interface PayPalSdkV6ButtonProps {
  amount: number;
  currency?: string;
  description?: string;
  clientName?: string;
  clientEmail?: string;
  customId?: string;
  userId?: string;
  onSuccess?: (orderId: string, captureData: any) => void;
  onError?: (error: any) => void;
  showTelemetry?: boolean;
}

export const PayPalSdkV6Button: React.FC<PayPalSdkV6ButtonProps> = ({
  amount,
  currency = 'USD',
  description = 'Freelance Engineering Deliverable Milestone',
  clientName = 'Client',
  clientEmail = 'client@example.com',
  customId,
  userId,
  onSuccess,
  onError,
  showTelemetry = true
}) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [sdkLoading, setSdkLoading] = useState<boolean>(true);
  const [sdkReady, setSdkReady] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modeHistory, setModeHistory] = useState<string[]>([]);

  useEffect(() => {
    let cleanupFn: (() => void) | null = null;
    let isMounted = true;

    async function initButton() {
      setSdkLoading(true);
      setErrorMessage(null);

      try {
        const sdkInstance = await getPayPalSdkV6Instance();
        if (!isMounted) return;

        if (sdkInstance && buttonRef.current) {
          setSdkReady(true);
          cleanupFn = await configurePayPalButton(sdkInstance, {
            amount,
            currency,
            description,
            clientName,
            clientEmail,
            customId,
            userId,
            buttonElement: buttonRef.current,
            onPresentationModeChange: (mode) => {
              if (!isMounted) return;
              setActiveMode(mode);
              setModeHistory((prev) => [...prev, mode]);
            },
            onSuccess: (orderId, captureResult) => {
              if (!isMounted) return;
              setIsProcessing(false);
              setOrderSuccess(orderId);
              if (onSuccess) onSuccess(orderId, captureResult);
            },
            onError: (err) => {
              if (!isMounted) return;
              setIsProcessing(false);
              setErrorMessage(err?.message || 'Payment processing error');
              if (onError) onError(err);
            },
            onCancel: () => {
              if (!isMounted) return;
              setIsProcessing(false);
              setActiveMode(null);
            }
          });
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('[PayPalSdkV6Button] Init failed:', err);
        setErrorMessage(err.message || 'Failed to initialize PayPal JS SDK v6');
      } finally {
        if (isMounted) setSdkLoading(false);
      }
    }

    initButton();

    return () => {
      isMounted = false;
      if (cleanupFn) cleanupFn();
    };
  }, [amount, currency, description, clientName, clientEmail, customId, userId]);

  return (
    <div className="w-full space-y-3 rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-xl">
      {/* Header Info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#003087] text-white font-black text-xs">
            PP
          </div>
          <div>
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>PayPal JS SDK v6</span>
              <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.2 text-[9px] font-mono text-blue-400 font-bold">
                ONE-TIME PAYMENT SESSION
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Presentation fallback: Payment-Handler &rarr; Popup &rarr; Modal</p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-xs font-mono font-bold text-emerald-400">${amount.toFixed(2)} {currency}</span>
        </div>
      </div>

      {/* Button Render Target */}
      <div className="relative">
        <button
          ref={buttonRef}
          disabled={sdkLoading || isProcessing || Boolean(orderSuccess)}
          onClick={() => setIsProcessing(true)}
          className={`group w-full relative overflow-hidden flex items-center justify-center gap-2.5 rounded-xl py-3 px-4 font-bold text-xs transition-all ${
            orderSuccess
              ? 'bg-emerald-600 text-white cursor-default'
              : sdkLoading
              ? 'bg-slate-800 text-slate-400 cursor-not-allowed'
              : 'bg-[#ffc439] hover:bg-[#f4bb34] active:bg-[#eab32f] text-slate-950 shadow-md shadow-[#ffc439]/20 cursor-pointer'
          }`}
        >
          {sdkLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
              <span>Loading PayPal SDK v6...</span>
            </>
          ) : isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              <span>Processing with PayPal v6 ({activeMode || 'initializing'})...</span>
            </>
          ) : orderSuccess ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-white" />
              <span>Payment Approved (${amount.toFixed(2)} {currency})</span>
            </>
          ) : (
            <>
              <span className="font-extrabold italic text-sm tracking-tight text-[#003087]">Pay</span>
              <span className="font-extrabold italic text-sm tracking-tight text-[#0079C1]">Pal</span>
              <span className="ml-1 font-semibold text-slate-900 border-l border-slate-900/20 pl-2">
                Checkout with One-Time Session
              </span>
            </>
          )}
        </button>
      </div>

      {/* Presentation Mode Pipeline Telemetry */}
      {showTelemetry && (
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/80 p-2.5 space-y-1.5 text-[10px]">
          <div className="flex items-center justify-between text-slate-400">
            <span className="font-semibold flex items-center gap-1">
              <Layers className="w-3 h-3 text-cyan-400" />
              SDK v6 Presentation Pipeline:
            </span>
            <span className="font-mono text-slate-500">Auto-Recoverable</span>
          </div>

          <div className="grid grid-cols-3 gap-1 text-center font-mono">
            {['payment-handler', 'popup', 'modal'].map((mode, idx) => {
              const isCurrent = activeMode === mode;
              const hasTried = modeHistory.includes(mode);
              return (
                <div
                  key={mode}
                  className={`py-1 px-1.5 rounded-lg border text-[9px] transition-all ${
                    isCurrent
                      ? 'border-blue-500 bg-blue-500/20 text-blue-300 font-bold animate-pulse'
                      : hasTried
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-slate-800 bg-slate-900 text-slate-500'
                  }`}
                >
                  <span className="text-[8px] text-slate-400 mr-0.5">{idx + 1}.</span>
                  {mode}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Success Notification */}
      {orderSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-start gap-2.5 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">Transaction Successfully Verified</p>
            <p className="text-[11px] text-emerald-400/80 font-mono">
              Order ID: {orderSuccess} &bull; Work Order auto-initialized in PostgreSQL
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 flex items-center gap-2 text-xs text-red-300">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
