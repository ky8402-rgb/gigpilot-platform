/**
 * One-shot, single-flight resolution of exchange credential state.
 *
 * Keys loaded from disk or the environment start in `VALIDATING`. Previously the only thing
 * that resolved them was a call to `GET /exchanges/credentials` — so the START pre-flight,
 * which reads the stored status without triggering the probe, could report
 * "Bybit credentials are not trade-ready: VALIDATING" purely because nothing had run the
 * check yet in this process. A limbo state is not a verdict, and reporting it as a blocker
 * told the operator their keys were bad when they had simply not been checked.
 *
 * This wrapper makes the resolution explicit and bounded:
 *
 *  - `resolve()` runs the probe at most once at a time (concurrent callers share it), so the
 *    pre-flight can call it freely even though it fires on every keystroke of the allocation
 *    input without ever spamming the exchange.
 *  - A definitive answer (CONNECTED / RESTRICTED / DISCONNECTED) is remembered, so the probe
 *    does not run again for the life of the process.
 *  - A probe that fails is reported as ERROR — never left as VALIDATING — and is retried
 *    after `retryAfterMs`, because an exchange hiccup is not evidence about the keys.
 *  - `reset()` clears the memory so freshly supplied keys are validated again.
 */

export type CredentialStatus = 'CONNECTED' | 'RESTRICTED' | 'DISCONNECTED' | 'ERROR';

export interface AccountProbeResult {
  status: string;
  message?: string;
  timestamp?: string;
}

export interface CredentialValidation {
  status: CredentialStatus;
  lastChecked?: string;
  errorMessage?: string;
}

const DEFAULT_RETRY_AFTER_MS = 15_000;

/** Map a raw account probe onto a definitive credential state. Never returns VALIDATING. */
export function mapAccountProbeToCredentialStatus(probe: AccountProbeResult): CredentialValidation {
  const status: CredentialStatus =
    probe.status === 'CONNECTED'
      ? 'CONNECTED'
      : probe.status === 'RESTRICTED'
        ? 'RESTRICTED'
        : probe.status === 'DISCONNECTED'
          ? 'DISCONNECTED'
          : 'ERROR';

  return {
    status,
    lastChecked: probe.timestamp,
    errorMessage: status === 'CONNECTED' ? undefined : probe.message,
  };
}

export class CredentialProbe {
  private inFlight: Promise<CredentialValidation> | null = null;
  private resolved = false;
  private lastAttemptAt = 0;

  constructor(
    private readonly runProbe: () => Promise<AccountProbeResult>,
    private readonly retryAfterMs: number = DEFAULT_RETRY_AFTER_MS,
  ) {}

  /** True once a definitive state has been established. */
  public get isResolved(): boolean {
    return this.resolved;
  }

  /** Forget the current verdict so newly supplied keys get validated. */
  public reset(): void {
    this.resolved = false;
    this.lastAttemptAt = 0;
  }

  /**
   * Resolve the credential state when the caller still needs an answer.
   *
   * Returns null when nothing was done — already resolved, not needed, or rate-limited after
   * a failed attempt — in which case the caller should keep using the stored status.
   */
  public async resolve(needed: boolean, now: number = Date.now()): Promise<CredentialValidation | null> {
    if (!needed || this.resolved) return null;
    if (this.inFlight) return this.inFlight;
    if (this.lastAttemptAt !== 0 && now - this.lastAttemptAt < this.retryAfterMs) return null;

    this.lastAttemptAt = now;
    const attempt = this.attempt();
    this.inFlight = attempt;
    try {
      return await attempt;
    } finally {
      if (this.inFlight === attempt) this.inFlight = null;
    }
  }

  private async attempt(): Promise<CredentialValidation> {
    try {
      const result = mapAccountProbeToCredentialStatus(await this.runProbe());
      // Only a definitive answer settles the question; ERROR must stay retryable.
      if (result.status !== 'ERROR') this.resolved = true;
      return result;
    } catch (err: any) {
      return {
        status: 'ERROR',
        lastChecked: new Date().toISOString(),
        errorMessage: err?.message || 'Credential validation probe failed to complete.',
      };
    }
  }
}
