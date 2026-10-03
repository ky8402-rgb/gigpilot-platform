/**
 * SINGLE AUTHORITATIVE TRADING-READINESS ASSESSOR
 *
 * Why this exists: the platform could report a healthy, green system while execution was
 * impossible. The Python engine said `healthy: true` (public + private WebSocket connected, feed
 * fresh) while Bybit was REJECTING the API key on every REST order endpoint, and the Node
 * execution engine had latched itself OFF. Nothing in the API joined those facts together, so a
 * dashboard or an operator could not tell "running fine" from "cannot trade at all".
 *
 * This module is the ONE place where readiness is decided. Every surface (`/api/health`,
 * `/api/trading/engines/health`, `/api/trading/readiness`, the dashboard) reads the same object,
 * so they cannot disagree.
 *
 * DESIGN RULES
 *  - Readiness requires EVIDENCE, never the absence of an objection. Every input is
 *    `boolean | null`, and `null` (unknown) is treated as NOT ready. An unmeasured condition
 *    cannot be evidence that trading is available. This is the same rule that made `edge_reliable`
 *    wrong once before: deriving a verdict from "nothing objected" produces green on no evidence.
 *  - It is a pure function of its inputs: no I/O, no clock, no globals, so it is exhaustively
 *    testable and cannot silently depend on ambient state.
 *  - It NEVER decides whether to trade. It reports whether trading is possible; risk controls,
 *    the kill switch and the capital gate remain the authorities on whether a trade should happen.
 */

export type ReadinessSignal = {
  id: string;
  ok: boolean;
  detail: string;
};

export type TradingReadiness = {
  /** True only when every hard gate has been positively verified. */
  ready: boolean;
  /** Why not ready — empty when `ready` is true. Human-readable, dashboard-ready. */
  blockers: string[];
  /** Per-gate evidence, including the ones that passed. */
  signals: ReadinessSignal[];
  /** Informational only; these do NOT make trading impossible. */
  context: {
    autonomyLevel: number | null;
    armed: boolean | null;
    /** Whether the autonomous loop is permitted to act, as distinct from able to act. */
    autonomousTradingActive: boolean;
  };
  assessedAt: string;
};

export type ReadinessInputs = {
  /** Python engine's own verdict (requires authenticated REST validation, not just WS). */
  engineTradingReady: boolean | null;
  /** Whether signed REST calls succeed at all (the credential AUTHENTICATES). */
  engineCredentialsOk: boolean | null;
  engineCredentialsError: string | null;
  /** Whether the credential is AUTHORISED TO TRADE. Deliberately separate from authenticating:
   *  a read-capable key can be refused on every order-mutating endpoint. */
  tradePermissionsOk: boolean | null;
  tradePermissionsError: string | null;
  /** The engine's own reasons, surfaced verbatim so the cause is never lost. */
  engineBlockers: string[];
  /** Node execution engine off-switch: false means all real order dispatch is halted. */
  executionEngineEnabled: boolean | null;
  executionEngineLastError: string | null;
  killSwitchActive: boolean | null;
  systemFailClosed: boolean | null;
  autonomyLevel: number | null;
  armed: boolean | null;
};

function gate(
  signals: ReadinessSignal[],
  blockers: string[],
  id: string,
  /** null = unknown, which is never sufficient. */
  condition: boolean | null,
  okDetail: string,
  failDetail: string
): void {
  const isOk = condition === true;
  const detail = isOk ? okDetail : failDetail;
  signals.push({ id, ok: isOk, detail });
  if (!isOk) blockers.push(failDetail);
}

export function assessTradingReadiness(input: ReadinessInputs): TradingReadiness {
  const signals: ReadinessSignal[] = [];
  const blockers: string[] = [];

  const credentialFailure = input.engineCredentialsError
    ? `Credentials rejected for trading: ${input.engineCredentialsError}`
    : 'Credentials have not been validated against the exchange (never validated)';

  // Authentication: do signed REST calls work at all?
  // Its OK detail deliberately states what it does NOT prove. Reporting a bare green here is how
  // the dashboard came to claim "credentials accepted" while every order endpoint said
  // "API key is invalid" — authenticating is not the same as being allowed to trade.
  gate(
    signals,
    blockers,
    'CREDENTIALS_AUTHENTICATE',
    input.engineCredentialsOk,
    'Exchange credentials authenticate for reads (this alone does NOT permit order placement)',
    credentialFailure
  );

  // Authorization: will the exchange actually ACCEPT an order from this key?
  gate(
    signals,
    blockers,
    'TRADE_AUTHORIZED',
    input.tradePermissionsOk,
    'API key is authorised to trade (ContractTrade permission granted, not read-only)',
    input.tradePermissionsError
      ? `Credentials cannot trade: ${input.tradePermissionsError}`
      : 'Credentials cannot trade: trade permission has not been validated'
  );

  gate(
    signals,
    blockers,
    'AUTONOMOUS_ENGINE_TRADING_READY',
    input.engineTradingReady,
    'Autonomous engine reports trading-ready',
    input.engineTradingReady === null
      ? 'Autonomous engine readiness is UNKNOWN (no engine health reported)'
      : 'Autonomous engine reports trading-ready: false'
  );

  gate(
    signals,
    blockers,
    'EXECUTION_ENGINE_ENABLED',
    input.executionEngineEnabled,
    'Exchange execution engine is enabled',
    input.executionEngineEnabled === null
      ? 'Exchange execution engine state is UNKNOWN'
      : `Exchange execution engine is OFF${input.executionEngineLastError ? ` (${input.executionEngineLastError})` : ''}`
  );

  gate(
    signals,
    blockers,
    'KILL_SWITCH_RELEASED',
    input.killSwitchActive === null ? null : !input.killSwitchActive,
    'Emergency kill switch is released',
    input.killSwitchActive === null
      ? 'Emergency kill switch state is UNKNOWN'
      : 'Emergency kill switch is ACTIVE (fail-closed)'
  );

  gate(
    signals,
    blockers,
    'SYSTEM_NOT_FAIL_CLOSED',
    input.systemFailClosed === null ? null : !input.systemFailClosed,
    'System is not fail-closed',
    input.systemFailClosed === null ? 'Fail-closed state is UNKNOWN' : 'System is FAIL-CLOSED'
  );

  // The engine's own reasons are surfaced verbatim: a summary that hides the specific cause is
  // how "API key is invalid" stayed invisible behind "Unexpected end of JSON input".
  //
  // Appended plainly here; collapsing duplicates is the dedup pass's job below. (An earlier edit
  // removed this loop while rewriting the dedup, and engine blockers silently vanished from the
  // report — caught by the "engine blockers must survive" assertion, which is why that test exists.)
  for (const b of input.engineBlockers) {
    if (b && b.trim()) blockers.push(b);
  }

  // Deduplication is CASE-INSENSITIVE and ignores a trailing full stop. The assessor and the engine
  // independently report the same underlying fact with slightly different prose ("Credentials
  // cannot trade: ..." vs "credentials cannot trade: ..."), and an exact-match check let both
  // through — so the dashboard showed the same reason twice, which reads as two separate problems.
  const fingerprint = (s: string) => s.trim().toLowerCase().replace(/[.\s]+$/, '');
  const seen = new Set<string>();
  const dedupedBlockers: string[] = [];
  for (const raw of blockers) {
    const b = (raw || '').trim();
    if (!b) continue;
    const mark = fingerprint(b);
    const alreadyCovered =
      seen.has(mark) ||
      // Also collapse a shorter message fully contained in one already listed, either direction.
      dedupedBlockers.some((existing) => {
        const e = fingerprint(existing);
        return e.includes(mark) || mark.includes(e);
      });
    if (alreadyCovered) continue;
    seen.add(mark);
    dedupedBlockers.push(b);
  }

  const ready = dedupedBlockers.length === 0 && signals.every((s) => s.ok);

  return {
    ready,
    blockers: dedupedBlockers,
    signals,
    context: {
      autonomyLevel: input.autonomyLevel,
      armed: input.armed,
      autonomousTradingActive: (input.autonomyLevel ?? 0) > 0 && input.armed === true,
    },
    assessedAt: new Date().toISOString(),
  };
}
