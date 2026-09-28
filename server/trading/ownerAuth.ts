import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';

const RFC4648_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
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
  for (let i = 0; i < buffer.length; i++) {
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
  const binaryCode = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binaryCode % 1000000).toString().padStart(6, '0');
}

export function verifyTOTP(token: string, secretBase32: string): boolean {
  if (!/^\d{6}$/.test(token?.trim() || '')) return false;
  return [-1, 0, 1].some(offset => generateTOTP(secretBase32, offset) === token.trim());
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

const PERSISTENT_DATA_DIR = process.env.GIGPILOT_DATA_DIR || path.join(process.cwd(), '.gigpilot-data');
const PERSISTENT_CONFIG_PATH = path.join(PERSISTENT_DATA_DIR, 'owner-auth-config.json');
const LEGACY_CONFIG_PATH = path.join(process.cwd(), '.owner-auth-config.json');

interface OwnerConfig {
  ownerEmail: string;
  passwordSalt: string;
  passwordHash: string;
  totpSecret: string;
  totpEnabled: boolean;
  emergencyPin: string;
  jwtSecret?: string;
  createdAt: string;
}

class OwnerAuthManager {
  private config: OwnerConfig;
  private pendingTotpSecret: string | null = null;
  private pendingTotpExpiresAt: number | null = null;
  private jwtSecret: string;

  constructor() {
    this.config = this.loadConfig();
    this.jwtSecret = process.env.JWT_SECRET || process.env.OWNER_SESSION_SECRET || this.config.jwtSecret || crypto.randomBytes(32).toString('hex');
    if (!this.config.jwtSecret) {
      this.config.jwtSecret = this.jwtSecret;
      this.saveConfig();
    }
  }

  private loadConfig(): OwnerConfig {
    const defaultEmail = process.env.OWNER_EMAIL || 'ky8402@gmail.com';
    const envPin = (process.env.OWNER_AUTH_PIN || '').trim();
    const secureGeneratedPin = crypto.randomBytes(4).toString('hex');
    for (const configPath of [...new Set([PERSISTENT_CONFIG_PATH, LEGACY_CONFIG_PATH])]) {
      if (!fs.existsSync(configPath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as OwnerConfig;
        if (configPath !== PERSISTENT_CONFIG_PATH) {
          fs.mkdirSync(PERSISTENT_DATA_DIR, { recursive: true });
          fs.writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(parsed, null, 2), { mode: 0o600 });
        }
        if (!parsed.emergencyPin || parsed.emergencyPin === '778899') {
          parsed.emergencyPin = envPin || secureGeneratedPin;
          fs.writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(parsed, null, 2), { mode: 0o600 });
        }
        return parsed;
      } catch (err) {
        console.error('Failed to load owner config, trying next location:', err);
      }
    }
    const newConfig: OwnerConfig = {
      ownerEmail: defaultEmail,
      passwordSalt: crypto.randomBytes(16).toString('hex'),
      passwordHash: '',
      totpSecret: base32Encode(crypto.randomBytes(20)),
      totpEnabled: false,
      emergencyPin: envPin.length >= 6 ? envPin : secureGeneratedPin,
      jwtSecret: crypto.randomBytes(32).toString('hex'),
      createdAt: new Date().toISOString()
    };
    try {
      fs.mkdirSync(PERSISTENT_DATA_DIR, { recursive: true });
      fs.writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
    } catch {}
    return newConfig;
  }

  private saveConfig(): void {
    try { fs.writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(this.config, null, 2), { mode: 0o600 }); }
    catch (err) { console.error('Failed to persist owner auth config:', err); }
  }

  public getStatus(isAuthenticated: boolean) {
    return { isAuthenticated, isConfigured: !!(this.config.passwordHash && this.config.totpEnabled), ownerEmail: this.config.ownerEmail, totpEnabled: this.config.totpEnabled, hasPassword: !!this.config.passwordHash };
  }

  public isConfigured(): boolean {
    return Boolean(this.config.passwordHash && this.config.totpEnabled);
  }

  public async initiateTotpSetup(email?: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    // Bootstrap-only. Once an owner account exists, handing out a fresh TOTP secret to an
    // unauthenticated caller would allow complete owner takeover via completeSetup().
    if (this.isConfigured()) {
      throw new Error('Owner account is already configured. TOTP re-enrollment requires an authenticated owner session.');
    }
    const targetEmail = email || this.config.ownerEmail;
    this.pendingTotpSecret = base32Encode(crypto.randomBytes(20));
    this.pendingTotpExpiresAt = Date.now() + 10 * 60 * 1000;
    const issuer = 'GigPilot Bybit Quant';
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(targetEmail)}?secret=${this.pendingTotpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
    return { secret: this.pendingTotpSecret, otpauthUrl, qrCodeDataUrl };
  }

  public completeSetup(password: string, totpCode: string, email?: string): { success: boolean; token?: string; error?: string } {
    // Bootstrap-only, and only against a secret this process just issued (never the stored
    // secret of an existing account), so an unauthenticated caller cannot overwrite owner creds.
    if (this.isConfigured()) {
      return { success: false, error: 'Owner account is already configured. Setup cannot be re-run without an authenticated session.' };
    }
    if (!this.pendingTotpSecret || !this.pendingTotpExpiresAt || Date.now() > this.pendingTotpExpiresAt) {
      this.pendingTotpSecret = null;
      this.pendingTotpExpiresAt = null;
      return { success: false, error: 'No pending TOTP enrollment. Complete /auth/setup-init first (enrollments expire after 10 minutes).' };
    }
    if (!password || password.length < 6) return { success: false, error: 'Password must be at least 6 characters long.' };
    const secretToVerify = this.pendingTotpSecret;
    if (!verifyTOTP(totpCode, secretToVerify)) return { success: false, error: 'Invalid Google Authenticator 6-digit code. Please check your phone time.' };
    const salt = crypto.randomBytes(16).toString('hex');
    this.config.ownerEmail = email || this.config.ownerEmail;
    this.config.passwordSalt = salt;
    this.config.passwordHash = hashPassword(password, salt);
    this.config.totpSecret = secretToVerify;
    this.config.totpEnabled = true;
    this.pendingTotpSecret = null;
    this.pendingTotpExpiresAt = null;
    this.saveConfig();
    return { success: true, token: this.generateToken(this.config.ownerEmail) };
  }

  public login(credentials: { email: string; password?: string; totpCode?: string; emergencyPin?: string }): { success: boolean; token?: string; error?: string } {
    const { email, password, totpCode, emergencyPin } = credentials;
    if (!email || email.toLowerCase().trim() !== this.config.ownerEmail.toLowerCase().trim()) return { success: false, error: 'Access denied: personal single-owner account.' };
    if (!this.config.passwordHash || !this.config.totpEnabled) return { success: false, error: 'Owner account is not initialized yet. Please complete initial setup.' };

    if (emergencyPin && this.config.emergencyPin) {
      const inputPin = Buffer.from(emergencyPin.trim());
      const expectedPin = Buffer.from(this.config.emergencyPin.trim());
      if (inputPin.length === expectedPin.length && crypto.timingSafeEqual(inputPin, expectedPin) && totpCode && verifyTOTP(totpCode, this.config.totpSecret)) {
        return { success: true, token: this.generateToken(this.config.ownerEmail) };
      }
    }
    if (!password) return { success: false, error: 'Master password is required.' };
    const testHash = hashPassword(password, this.config.passwordSalt);
    const expectedHash = Buffer.from(this.config.passwordHash, 'hex');
    const actualHash = Buffer.from(testHash, 'hex');
    if (actualHash.length !== expectedHash.length || !crypto.timingSafeEqual(actualHash, expectedHash)) return { success: false, error: 'Invalid owner password.' };
    if (!totpCode || !verifyTOTP(totpCode, this.config.totpSecret)) return { success: false, error: 'Invalid Google Authenticator code. Please check your device clock.' };
    return { success: true, token: this.generateToken(this.config.ownerEmail) };
  }

  public generateToken(email: string): string {
    return jwt.sign({ sub: email, role: 'owner', iat: Math.floor(Date.now() / 1000) }, this.jwtSecret, { expiresIn: '1h' });
  }

  public verifyToken(token: string): boolean {
    if (!token) return false;
    try { const decoded = jwt.verify(token, this.jwtSecret) as any; return decoded && decoded.role === 'owner'; }
    catch { return false; }
  }
}

export const ownerAuth = new OwnerAuthManager();

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7).trim();
  return (req.headers['x-owner-token'] as string) || null;
}

export function isOwner(req: Request): boolean {
  const token = extractToken(req);
  return token ? ownerAuth.verifyToken(token) : false;
}

export function requireOwnerAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') { next(); return; }
  if (!isOwner(req)) {
    res.status(401).json({ success: false, error: 'Unauthorized: Valid single-owner authentication token required for this operational trading endpoint.' });
    return;
  }
  next();
}
