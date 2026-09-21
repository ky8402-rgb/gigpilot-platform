import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

// RFC 4648 Base32 alphabet for TOTP secrets
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
  if (bits > 0) {
    output += RFC4648_BASE32[(value << (5 - bits)) & 31];
  }
  return output;
}

export function generateTOTP(secretBase32: string, timeOffsetSteps = 0): string {
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  const counter = Math.floor(epoch / timeStep) + timeOffsetSteps;

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);

  const key = base32Decode(secretBase32);
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(buf);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const binaryCode = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  );

  const otp = binaryCode % 1000000;
  return otp.toString().padStart(6, '0');
}

export function verifyTOTP(token: string, secretBase32: string): boolean {
  if (!token || token.trim().length !== 6) return false;
  const cleanToken = token.trim();
  // Check -1, 0, +1 intervals (90 second clock window)
  for (let offset = -1; offset <= 1; offset++) {
    if (generateTOTP(secretBase32, offset) === cleanToken) {
      return true;
    }
  }
  return false;
}

// Password hashing using PBKDF2
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

const PERSISTENT_CONFIG_PATH = path.join(process.cwd(), '.owner-auth-config.json');

interface OwnerConfig {
  ownerEmail: string;
  passwordSalt: string;
  passwordHash: string;
  totpSecret: string;
  totpEnabled: boolean;
  emergencyPin: string;
  createdAt: string;
}

class OwnerAuthManager {
  private config: OwnerConfig;
  private pendingTotpSecret: string | null = null;
  private jwtSecret: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || process.env.OWNER_SESSION_SECRET || '';
    if (this.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET or OWNER_SESSION_SECRET must be configured with at least 32 characters.');
    }
    this.config = this.loadConfig();
  }

  private loadConfig(): OwnerConfig {
    const defaultEmail = process.env.OWNER_EMAIL || '';
    const emergencyPin = process.env.OWNER_AUTH_PIN || '';

    if (fs.existsSync(PERSISTENT_CONFIG_PATH)) {
      try {
        const raw = fs.readFileSync(PERSISTENT_CONFIG_PATH, 'utf-8');
        return JSON.parse(raw);
      } catch (err) {
        console.error('Failed to load owner config, creating fresh:', err);
      }
    }

    // Default unconfigured owner or initialized from env
    const salt = crypto.randomBytes(16).toString('hex');
    const defaultSecret = base32Encode(crypto.randomBytes(20));

    return {
      ownerEmail: defaultEmail,
      passwordSalt: salt,
      passwordHash: '', // Unset by default: requires initial setup
      totpSecret: defaultSecret,
      totpEnabled: false,
      emergencyPin,
      createdAt: new Date().toISOString()
    };
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to persist owner auth config:', err);
    }
  }

  public getStatus(isAuthenticated: boolean) {
    return {
      isAuthenticated,
      isConfigured: !!(this.config.passwordHash && this.config.totpEnabled),
      ownerEmail: this.config.ownerEmail,
      totpEnabled: this.config.totpEnabled,
      hasPassword: !!this.config.passwordHash
    };
  }

  public async initiateTotpSetup(email?: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  }> {
    const targetEmail = email || this.config.ownerEmail;
    this.pendingTotpSecret = base32Encode(crypto.randomBytes(20));
    
    const issuer = 'GigPilot Binance Quant';
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(targetEmail)}?secret=${this.pendingTotpSecret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    return {
      secret: this.pendingTotpSecret,
      otpauthUrl,
      qrCodeDataUrl
    };
  }

  public completeSetup(password: string, totpCode: string, email?: string): {
    success: boolean;
    token?: string;
    error?: string;
  } {
    if (!password || password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    const secretToVerify = this.pendingTotpSecret || this.config.totpSecret;
    if (!verifyTOTP(totpCode, secretToVerify)) {
      return { success: false, error: 'Invalid Google Authenticator 6-digit code. Please check your phone time.' };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);

    this.config.ownerEmail = email || this.config.ownerEmail;
    this.config.passwordSalt = salt;
    this.config.passwordHash = hash;
    this.config.totpSecret = secretToVerify;
    this.config.totpEnabled = true;
    this.pendingTotpSecret = null;
    this.saveConfig();

    const token = this.generateToken(this.config.ownerEmail);
    return { success: true, token };
  }

  public login(credentials: {
    email: string;
    password?: string;
    totpCode?: string;
    emergencyPin?: string;
  }): {
    success: boolean;
    token?: string;
    error?: string;
  } {
    const { email, password, totpCode, emergencyPin } = credentials;

    // Verify email matches owner
    if (email.toLowerCase().trim() !== this.config.ownerEmail.toLowerCase().trim()) {
      return { success: false, error: 'Access denied: personal single-owner account.' };
    }

    // Emergency PIN is disabled unless explicitly enabled. It must never be a
    // built-in/default credential or a replacement for password + TOTP.
    if (
      process.env.ALLOW_EMERGENCY_PIN === 'true' &&
      this.config.emergencyPin &&
      emergencyPin &&
      emergencyPin.trim().length === this.config.emergencyPin.trim().length &&
      crypto.timingSafeEqual(
        Buffer.from(emergencyPin.trim()),
        Buffer.from(this.config.emergencyPin.trim())
      )
    ) {
      const token = this.generateToken(this.config.ownerEmail);
      return { success: true, token };
    }

    // If not configured yet, notify setup required
    if (!this.config.passwordHash || !this.config.totpEnabled) {
      return { success: false, error: 'Owner account is not initialized yet. Please complete initial setup.' };
    }

    // Verify password
    if (!password) {
      return { success: false, error: 'Master password is required.' };
    }

    const testHash = hashPassword(password, this.config.passwordSalt);
    if (testHash !== this.config.passwordHash) {
      return { success: false, error: 'Invalid owner password.' };
    }

    // Verify TOTP Code
    if (!totpCode) {
      return { success: false, error: 'Google Authenticator 6-digit code is required.' };
    }

    if (!verifyTOTP(totpCode, this.config.totpSecret)) {
      return { success: false, error: 'Invalid Google Authenticator code. Please check your device clock.' };
    }

    const token = this.generateToken(this.config.ownerEmail);
    return { success: true, token };
  }

  public generateToken(email: string): string {
    return jwt.sign(
      {
        sub: email,
        role: 'owner',
        iat: Math.floor(Date.now() / 1000)
      },
      this.jwtSecret,
      { expiresIn: '30d' }
    );
  }

  public verifyToken(token: string): boolean {
    if (!token || token.length > 4096) return false;
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return decoded && decoded.role === 'owner';
    } catch {
      return false;
    }
  }
}

export const ownerAuth = new OwnerAuthManager();
