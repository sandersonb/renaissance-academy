import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { httpSecurityMode, type AppConfig, type HttpSecurityMode } from '../config.js';

export const REQUEST_MARKER = 'x-enrollment-request';
export const AUTH_BODY_LIMIT = 16 * 1024;
export class HttpSecurityError extends Error {
  constructor(message: string, readonly statusCode = 403) { super(message); }
}

export function normalizedIp(value: string): string | null {
  const type = isIP(value);
  if (type === 4) return value;
  if (type !== 6 || value.includes('%')) return null;
  try {
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
    if (mapped) {
      const a = parseInt(mapped[1]!, 16); const b = parseInt(mapped[2]!, 16);
      return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    }
    return canonical;
  } catch { return null; }
}
export const loopbackPeer = (ip: string, hop = 0) => hop === 0 && ['127.0.0.1', '::1'].includes(normalizedIp(ip) ?? '');

export function adminNetworks(entries: string[], production: boolean): (ip: string) => boolean {
  if (!entries.length) {
    if (production) throw new HttpSecurityError('ADMIN_IP_ALLOWLIST must be explicitly restricted in production mode.', 500);
    return (ip) => normalizedIp(ip) !== null;
  }
  const block = new BlockList();
  try {
    if (entries.length > 64) throw new Error();
    for (const entry of entries) {
      const parts = entry.trim().split('/');
      const ip = parts[0]!; const originalType = isIP(ip); const normalized = normalizedIp(ip);
      if (!normalized || parts.length > 2) throw new Error();
      if (parts.length === 1) { block.addAddress(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6'); continue; }
      if (!/^\d+$/.test(parts[1]!)) throw new Error();
      let prefix = Number(parts[1]);
      if (originalType === 6 && isIP(normalized) === 4) prefix -= 96;
      const type = isIP(normalized) === 4 ? 'ipv4' : 'ipv6';
      if (prefix < (type === 'ipv4' ? 24 : 64) || prefix > (type === 'ipv4' ? 32 : 128)) throw new Error();
      if (type === 'ipv6') {
        const probe = new BlockList(); probe.addSubnet(normalized, prefix, 'ipv6');
        if (prefix <= 96 && probe.check('::ffff:0:0', 'ipv6')) throw new Error();
      }
      block.addSubnet(normalized, prefix, type);
    }
  } catch { throw new HttpSecurityError('ADMIN_IP_ALLOWLIST must contain exact IPs or bounded CIDRs (/24 IPv4, /64 IPv6 or narrower), never prefixes or broad mapped ranges.', 500); }
  return (ip) => { const value = normalizedIp(ip); return value !== null && block.check(value, isIP(value) === 4 ? 'ipv4' : 'ipv6'); };
}

export function httpPolicy(config: AppConfig) {
  const mode = config.httpSecurity ?? httpSecurityMode(process.env);
  if (process.env.NODE_ENV === 'production' && !mode.production) throw new HttpSecurityError('Production process cannot disable HTTP protection.', 500);
  let origin: string;
  try {
    const url = new URL(config.appBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || (mode.production && url.protocol !== 'https:') ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    origin = url.origin;
  } catch { throw new HttpSecurityError('APP_BASE_URL must be a canonical root HTTP(S) URL; HTTPS is required in production mode.', 500); }
  if (!Number.isInteger(config.bcryptCost) || config.bcryptCost < 4 || config.bcryptCost > 14) throw new HttpSecurityError('BCRYPT_COST must be an integer from 4 through 14.', 500);
  const prefix = mode.production ? (mode.realm === 'preview' ? '__Host-ra-preview' : '__Host-ra') : 'ra-dev';
  return { mode, origin, parentCookie: `${prefix}-parent`, adminCookie: `${prefix}-admin`, adminAllowed: adminNetworks(config.adminIpAllowlist, mode.production) };
}

export function authCookie(name: string, value: string, maxAge: number, mode: HttpSecurityMode): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${mode.production ? '; Secure' : ''}`;
}
/** Only inspect our auth cookie. Unrelated malformed/legacy cookies cannot poison parsing. */
export function authToken(header: string | undefined, name: string): string | undefined {
  let found: string | undefined; let count = 0;
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) { count++; found = part.slice(index + 1).trim(); }
  }
  return count === 1 && /^[a-f0-9]{32}$/.test(found ?? '') ? found : undefined;
}
export function sameOriginWrite(headers: Record<string, unknown>, origin: string, production: boolean): boolean {
  if (headers.origin !== undefined && headers.origin !== origin) return false;
  if (headers['sec-fetch-site'] !== undefined && headers['sec-fetch-site'] !== 'same-origin') return false;
  return !production || (headers.origin === origin && headers[REQUEST_MARKER] === '1');
}

export class AuthRateLimiter {
  private entries = new Map<string, { count: number; resetAt: number }>();
  private nextSweep = 0;
  constructor(private now = () => Date.now(), private capacity = 10000) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new Error('Invalid limiter capacity.');
  }
  consume(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfter: number } {
    const now = this.now();
    if (now >= this.nextSweep) {
      for (const [id, value] of this.entries) if (value.resetAt <= now) this.entries.delete(id);
      this.nextSweep = now + 60000;
    }
    let entry = this.entries.get(key);
    if (entry && entry.resetAt <= now) { this.entries.delete(key); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= this.capacity) return { allowed: false, retryAfter: 60 };
      entry = { count: 0, resetAt: now + windowMs }; this.entries.set(key, entry);
    }
    const allowed = entry.count < limit;
    if (allowed) entry.count++;
    return { allowed, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
}
export const rateKey = (kind: string, value: string) => `${kind}:${createHash('sha256').update(value.trim().toLowerCase()).digest('hex')}`;
export function authRate(path: string, production: boolean) {
  if (['/api/auth/login', '/api/admin/login'].includes(path)) return { kind: path, ip: production ? 20 : 2000, identity: production ? 10 : 1000, window: 300000, fields: ['username'] };
  if (path === '/api/auth/register') return { kind: path, ip: production ? 10 : 1000, identity: production ? 3 : 1000, window: 3600000, fields: ['username', 'email'] };
  if (['/api/auth/forgot', '/api/auth/reset', '/api/auth/resend'].includes(path)) return { kind: path, ip: production ? 5 : 1000, identity: production ? 3 : 1000, window: 900000, fields: path.endsWith('/reset') ? ['token'] : path.endsWith('/resend') ? ['email'] : ['username', 'email'] };
  return null;
}
