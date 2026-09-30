/**
 * Owner authentication provider — the canonical contract any owner-auth
 * implementation must satisfy.
 *
 * Design invariants (intentional, non-negotiable):
 *
 *  1. **No hardcoded credentials anywhere.** No default passwords, no default
 *     PIN, no default JWT secret. If a credential cannot be sourced from
 *     env, file, or operator action, the provider MUST throw and the
 *     platform MUST refuse to boot.
 *  2. **No unauthenticated trading access.** The default route guard uses
 *     this provider. Replacing the provider can NEVER widen that surface.
 *  3. **Bootstrap is one-time only.** A fresh owner account is created via
 *     `completeSetup` only when `isConfigured()` returns false. After that,
 *     `initiateTotpSetup` MUST refuse and throw a clear error. This stops
 *     an unauthenticated caller from ever minting a fresh TOTP secret
 *     and walking in through setup.
 *  4. **Tokens are JWTs, signed, expiring.** `verifyToken` MUST fail closed
 *     on any malformed input, expired token, or signature mismatch.
 *  5. **Recovery is operator-only.** Password resets, PIN rotation, and
 *     credential re-enrollment all require either an authenticated session
 *     or an out-of-band secret (env var, deployment-managed secret file).
 *
 * Each implementation is responsible for its own storage (filesystem,
 * secrets manager, etc.) but MUST persist with mode 0600 and MUST NOT log
 * secrets.
 */

export interface TotpSetupData {
  /** Base32-encoded shared secret to load into an authenticator app. */
  secret: string;
  /** otpauth:// URL suitable for direct import. */
  otpauthUrl: string;
  /** PNG data URL for QR-code display in a UI. */
  qrCodeDataUrl: string;
}

export interface AuthResult {
  success: boolean;
  /** JWT, present on success. */
  token?: string;
  /** Short, single-sentence error string on failure. Safe to surface to the UI. */
  error?: string;
}

export interface AuthStatus {
  /** True if the request is currently authenticated. */
  isAuthenticated: boolean;
  /** True if a password AND TOTP enrollment exist (i.e. login is enabled). */
  isConfigured: boolean;
  /** True if the configured owner has enabled TOTP. */
  totpEnabled: boolean;
  /** True if a password has been set (independent of TOTP). */
  hasPassword: boolean;
  /** Owner email. Only disclosed to authenticated sessions. */
  ownerEmail?: string;
}

export interface LoginCredentials {
  email: string;
  password?: string;
  totpCode?: string;
  emergencyPin?: string;
}

/**
 * The full contract every owner-auth provider implements. See the file
 * header for the invariants. Adding a new provider is intentionally a
 * multi-step process so every implementation is reviewed against them.
 */
export interface OwnerAuthProvider {
  /** Stable identifier — what `AUTH_PROVIDER` env var matches against. */
  readonly id: string;
  /** Display name for the UI / operator logs. */
  readonly name: string;

  /** Returns true if the owner account has been bootstrapped (password+TOTP). */
  isConfigured(): boolean;

  /** Returns the public status — safe to expose via /api/auth/status. */
  getStatus(isAuthenticated: boolean): AuthStatus;

  /**
   * Bootstrap-only: kicks off a TOTP enrollment. Throws if the owner
   * account is already configured. The returned secret expires after a
   * short window (default 10 minutes) — `completeSetup` MUST verify that
   * the secret it accepts was issued by THIS process and has not expired.
   */
  initiateTotpSetup(email?: string): Promise<TotpSetupData>;

  /**
   * Bootstrap-only: completes the TOTP enrollment with a password + a
   * 6-digit TOTP code derived from the secret just issued. Throws (or
   * returns success:false) when called against an already-configured
   * account — setup is never re-runnable without an authenticated session.
   * Returns a JWT on success.
   */
  completeSetup(args: {
    password: string;
    totpCode: string;
    email?: string;
  }): Promise<AuthResult>;

  /**
   * Authenticates a login attempt. Exactly one of (password) or
   * (emergencyPin) must be supplied; both must be accompanied by a current
   * TOTP code (RFC-6238 6-digit, 30s window). Returns a JWT on success.
   * Constant-time comparisons MUST be used for PIN and password hashes.
   */
  login(credentials: LoginCredentials): Promise<AuthResult>;

  /** Verifies a JWT. Returns false on any failure (expired, malformed, wrong signature). */
  verifyToken(token: string): boolean;

  /** Mints a JWT for the given identity. Only callable internally / in tests. */
  generateToken(identity: string): string;
}
