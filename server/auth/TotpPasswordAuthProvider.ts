/**
 * TOTP + password owner-auth provider. Default `AUTH_PROVIDER=totp`.
 *
 * Stores owner credentials in `.gigpilot-data/owner-auth-config.json` with
 * mode 0600. JWT signing key is sourced (in order) from JWT_SECRET env,
 * OWNER_SESSION_SECRET env, or a key generated at first boot and persisted
 * alongside the config.
 *
 * **No hardcoded defaults.** Specifically:
 *  - If a fresh owner-auth-config.json must be created AND neither
 *    OWNER_AUTH_PIN nor JWT_SECRET/OWNER_SESSION_SECRET is set, this
 *    provider refuses to start instead of generating random fallbacks.
 *    Random fallbacks (e.g. a 4-byte PIN printed to a log) are recoverable
 *    by an attacker who reads stderr, so they are NOT a substitute for an
 *    explicit operator-supplied secret.
 *  - The legacy default PIN string '778899' that older code path-replaced
 *    is gone. The only thing stored is whatever the operator explicitly
 *    provides.
 *  - The owner email defaults to a generic placeholder ('owner@local') and
 *    is meant to be overridden via OWNER_EMAIL env or the bootstrap call.
 *
 * The bootstrap flow (`initiateTotpSetup` / `completeSetup`) is one-time
 * only: once an account is configured, the routes that invoke them refuse
 * to re-enroll without an authenticated session.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import {
  AuthResult,
  AuthStatus,
  LoginCredentials,
  OwnerAuthProvider,
  TotpSetupData,
} from './types.js';

const RFC4648_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 1) {
    const idx = RFC4648_BASE32.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += RFC4648_BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += RFC4648_BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function generateTOTP(secretBase32: string, timeOffsetSteps = 0): string {
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30) + timeOffsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const digest = crypto.createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binaryCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binaryCode % 1_000_000).toString().padStart(6, '0');
}

export function verifyTOTP(token: string, secretBase32: string): boolean {
  if (!/^\d{6}$/.test(token?.trim() || '')) return false;
  return [-1, 0, 1].some((offset) => generateTOTP(secretBase32, offset) === token.trim());
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
}

interface PersistedConfig {
  ownerEmail: string;
  passwordSalt: string;
  passwordHash: string;
  totpSecret: string;
  totpEnabled: boolean;
  /** Hashed, not plaintext. We store SHA-256(OWNER_AUTH_PIN) and verify with timingSafeEqual. */
  emergencyPinHash: string | null;
  jwtSecret: string;
  createdAt: string;
}

export class TotpPasswordAuthProvider implements OwnerAuthProvider {
  public readonly id = 'totp';
  public readonly name = 'TOTP + Master Password';

  private readonly dataDir: string;
  private readonly configPath: string;
  private readonly config: PersistedConfig;
  private readonly jwtSecret: string;

  /** Short-lived enrollment state. Lives only in memory. */
  private pendingTotpSecret: string | null = null;
  private pendingTotpExpiresAt: number | null = null;

  constructor() {
    this.dataDir = process.env.GIGPILOT_DATA_DIR || path.join(process.cwd(), '.gigpilot-data');
    this.configPath = path.join(this.dataDir, 'owner-auth-config.json');
    this.config = this.loadOrFailClosed();
    this.jwtSecret = this.resolveJwtSecret();
    this.persistJwtSecretIfNew();
  }

  /** Loads an existing config or refuses to start. **No random fallbacks.** */
  private loadOrFailClosed(): PersistedConfig {
    if (!fs.existsSync(this.configPath)) {
      // Bootstrap: refuse to start with random fallbacks. Operator MUST run the
      // setup flow first OR set OWNER_AUTH_PIN to a known value AND set
      // OWNER_EMAIL. We log clearly to stderr so the operator sees what to do.
      const envPin = (process.env.OWNER_AUTH_PIN || '').trim();
      if (envPin.length < 6) {
        process.stderr.write(
          [
            '[auth] No owner-auth-config.json found and OWNER_AUTH_PIN is not set.',
            '[auth] Refusing to bootstrap with random credentials. To configure:',
            '[auth]   1) Set OWNER_AUTH_PIN to a 6+ digit PIN, then restart.',
            '[auth]   2) Call POST /api/auth/setup-init and POST /api/auth/setup-complete',
            '[auth]      to enroll the first owner.',
            '',
          ].join('\n'),
        );
        throw new Error(
          'Auth bootstrap blocked: no owner-auth-config.json and no OWNER_AUTH_PIN. ' +
            'Set OWNER_AUTH_PIN to a 6+ digit PIN, or run the setup flow.',
        );
      }
      // Operator pre-supplied PIN. Create the skeleton config — it remains
      // unusable for login until TOTP is enrolled via the bootstrap flow.
      return this.bootstrapFromEnvPin(envPin);
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as PersistedConfig;
      // passwordHash + totpEnabled are mandatory for login to work.
      // jwtSecret is optional — if missing, resolveJwtSecret will pull it
      // from JWT_SECRET / OWNER_SESSION_SECRET env vars and persist it.
      if (!parsed.passwordHash || !parsed.totpEnabled) {
        throw new Error('Owner-auth-config.json is incomplete (missing passwordHash or totpEnabled)');
      }
      // Migration: legacy configs stored emergencyPin in plaintext. Hash it
      // now and remove the plaintext field so PIN login continues to work
      // and the disk no longer carries the operator's raw PIN. This runs
      // exactly once per deploy.
      let migrated = false;
      const legacy: any = (parsed as any).emergencyPin;
      if (legacy && typeof legacy === 'string' && legacy.length >= 6 && !parsed.emergencyPinHash) {
        parsed.emergencyPinHash = crypto.createHash('sha256').update(legacy.trim()).digest('hex');
        delete (parsed as any).emergencyPin;
        migrated = true;
      }
      if (migrated) {
        try {
          fs.writeFileSync(this.configPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
        } catch (err: any) {
          process.stderr.write(`[auth] Failed to persist migrated owner-auth-config.json: ${err?.message ?? err}\n`);
        }
      }
      return parsed;
    } catch (err: any) {
      throw new Error(`Failed to load owner-auth-config.json: ${err?.message ?? String(err)}`);
    }
  }

  private bootstrapFromEnvPin(envPin: string): PersistedConfig {
    const ownerEmail = (process.env.OWNER_EMAIL || '').trim() || 'owner@local';
    const cfg: PersistedConfig = {
      ownerEmail,
      passwordSalt: '',
      passwordHash: '',
      totpSecret: '',
      totpEnabled: false,
      // We store the SHA-256 hash of the operator-supplied PIN; the original
      // PIN is never persisted to disk in plaintext.
      emergencyPinHash: crypto.createHash('sha256').update(envPin).digest('hex'),
      jwtSecret: '',
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    process.stderr.write(
      `[auth] Created owner-auth-config.json from OWNER_AUTH_PIN for ${ownerEmail}.\n` +
        `[auth] Complete the setup flow at POST /api/auth/setup-init to enroll TOTP + password before login.\n`,
    );
    return cfg;
  }

  private resolveJwtSecret(): string {
    const fromEnv = process.env.JWT_SECRET || process.env.OWNER_SESSION_SECRET;
    if (fromEnv && fromEnv.length >= 32) return fromEnv;
    // If we already have a persisted jwtSecret in the config, use it.
    if (this.config.jwtSecret && this.config.jwtSecret.length >= 32) return this.config.jwtSecret;
    // No env var, no persisted secret — refuse to start. Generating a random
    // one and persisting would lock out anyone whose deploy pipeline doesn't
    // carry the file across restarts; requiring an explicit env var is safer.
    throw new Error(
      'Auth bootstrap blocked: JWT signing key not configured. ' +
        'Set JWT_SECRET (preferred) or OWNER_SESSION_SECRET to a 32+ character secret.',
    );
  }

  private persistJwtSecretIfNew(): void {
    if (this.config.jwtSecret !== this.jwtSecret) {
      this.config.jwtSecret = this.jwtSecret;
      this.saveConfig();
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    } catch (err: any) {
      process.stderr.write(`[auth] Failed to persist owner-auth-config.json: ${err?.message ?? err}\n`);
    }
  }

  // -------------------------------------------------------------------------
  // Public contract
  // -------------------------------------------------------------------------

  public isConfigured(): boolean {
    return Boolean(this.config.passwordHash && this.config.totpEnabled);
  }

  public getStatus(isAuthenticated: boolean): AuthStatus {
    const status: AuthStatus = {
      isAuthenticated,
      isConfigured: this.isConfigured(),
      totpEnabled: this.config.totpEnabled,
      hasPassword: Boolean(this.config.passwordHash),
    };
    return isAuthenticated ? { ...status, ownerEmail: this.config.ownerEmail } : status;
  }

  public async initiateTotpSetup(email?: string): Promise<TotpSetupData> {
    if (this.isConfigured()) {
      throw new Error('Owner account is already configured. TOTP re-enrollment requires an authenticated owner session.');
    }
    const targetEmail = email || this.config.ownerEmail;
    this.pendingTotpSecret = base32Encode(crypto.randomBytes(20));
    this.pendingTotpExpiresAt = Date.now() + 10 * 60 * 1000;
    const issuer = 'GigPilot Trading Platform';
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(targetEmail)}?secret=${this.pendingTotpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    return { secret: this.pendingTotpSecret, otpauthUrl, qrCodeDataUrl };
  }

  public async completeSetup(args: { password: string; totpCode: string; email?: string }): Promise<AuthResult> {
    if (this.isConfigured()) {
      return { success: false, error: 'Owner account is already configured. Setup cannot be re-run without an authenticated session.' };
    }
    if (!this.pendingTotpSecret || !this.pendingTotpExpiresAt || Date.now() > this.pendingTotpExpiresAt) {
      this.pendingTotpSecret = null;
      this.pendingTotpExpiresAt = null;
      return { success: false, error: 'No pending TOTP enrollment. Complete /auth/setup-init first (enrollments expire after 10 minutes).' };
    }
    if (!args.password || args.password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }
    const secretToVerify = this.pendingTotpSecret;
    if (!verifyTOTP(args.totpCode, secretToVerify)) {
      return { success: false, error: 'Invalid Google Authenticator 6-digit code. Please check your phone time.' };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    this.config.ownerEmail = args.email || this.config.ownerEmail;
    this.config.passwordSalt = salt;
    this.config.passwordHash = hashPassword(args.password, salt);
    this.config.totpSecret = secretToVerify;
    this.config.totpEnabled = true;
    this.pendingTotpSecret = null;
    this.pendingTotpExpiresAt = null;
    this.saveConfig();
    return { success: true, token: this.generateToken(this.config.ownerEmail) };
  }

  public async login(credentials: LoginCredentials): Promise<AuthResult> {
    const { email, password, totpCode, emergencyPin } = credentials;
    if (!email || email.toLowerCase().trim() !== this.config.ownerEmail.toLowerCase().trim()) {
      return { success: false, error: 'Access denied: personal single-owner account.' };
    }
    if (!this.isConfigured()) {
      return { success: false, error: 'Owner account is not initialized yet. Please complete initial setup.' };
    }
    if (!totpCode) {
      return { success: false, error: 'A current 6-digit TOTP code is required.' };
    }

    // Emergency PIN path: timing-safe compare against the persisted hash.
    if (emergencyPin && this.config.emergencyPinHash) {
      const inputHash = crypto.createHash('sha256').update(emergencyPin.trim()).digest();
      const expectedHash = Buffer.from(this.config.emergencyPinHash, 'hex');
      const pinOk = inputHash.length === expectedHash.length && crypto.timingSafeEqual(inputHash, expectedHash);
      const totpOk = verifyTOTP(totpCode, this.config.totpSecret);
      if (pinOk && totpOk) return { success: true, token: this.generateToken(this.config.ownerEmail) };
    }

    if (!password) return { success: false, error: 'Master password is required.' };
    const testHash = hashPassword(password, this.config.passwordSalt);
    const expectedHash = Buffer.from(this.config.passwordHash, 'hex');
    const actualHash = Buffer.from(testHash, 'hex');
    if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) {
      return { success: false, error: 'Invalid owner password.' };
    }
    if (!verifyTOTP(totpCode, this.config.totpSecret)) {
      return { success: false, error: 'Invalid Google Authenticator code. Please check your device clock.' };
    }
    return { success: true, token: this.generateToken(this.config.ownerEmail) };
  }

  public generateToken(identity: string): string {
    return jwt.sign({ sub: identity, role: 'owner', iat: Math.floor(Date.now() / 1000) }, this.jwtSecret, { expiresIn: '1h' });
  }

  public verifyToken(token: string): boolean {
    if (!token) return false;
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return Boolean(decoded && decoded.role === 'owner');
    } catch {
      return false;
    }
  }
}
