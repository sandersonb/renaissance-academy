import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/app/config.js';
import { createMemoryDatabase } from '../src/app/adapters/memory/index.js';
import { ConsoleEmailProvider, emailProviderFromEnv } from '../src/app/adapters/email/providers.js';
import { buildServer } from '../src/app/http/server.js';
import { adminNetworks, AuthRateLimiter, authCookie, authRate, authToken, httpPolicy, loopbackPeer, normalizedIp, rateKey, sameOriginWrite } from '../src/app/http/security.js';
import { realPasswordOps } from '../src/app/services/password.js';
import { sessionParent } from './sessionFixtures.js';

const origin = 'https://enrollment.example.org';
const headers = { origin, 'x-enrollment-request': '1' };
const protectedConfig = () => loadConfig({ NODE_ENV: 'production', DB_NAME: 'enrollment_preview', APP_BASE_URL: origin,
  ADMIN_IP_ALLOWLIST: '203.0.113.10', TRUST_PROXY: 'true', BCRYPT_COST: '4' });
const provider = { async send() {} };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('pure HTTP boundary policies', () => {
  it('normalizes equivalent IPv6 and mapped IPv4 without accepting malformed addresses', () => {
    expect(normalizedIp('::ffff:c633:640a')).toBe('198.51.100.10');
    expect(normalizedIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(normalizedIp('198.51.100.010')).toBeNull();
    expect(normalizedIp('fe80::1%eth0')).toBeNull();
    expect(loopbackPeer('::ffff:127.0.0.1', 0)).toBe(true);
    expect(loopbackPeer('127.0.0.1', 1)).toBe(false);
    expect(loopbackPeer('203.0.113.10', 0)).toBe(false);
  });
  it('matches validated exact/bounded networks and refuses prefixes and broad mapped ranges', () => {
    const allowed = adminNetworks(['198.51.100.10', '203.0.113.0/24', '2001:db8::/64', '::ffff:192.0.2.0/120'], true);
    expect(allowed('::ffff:c633:640a')).toBe(true);
    expect(allowed('198.51.100.100')).toBe(false);
    expect(allowed('203.0.113.255')).toBe(true);
    expect(allowed('203.0.114.1')).toBe(false);
    expect(allowed('2001:db8::abcd')).toBe(true);
    expect(allowed('192.0.2.8')).toBe(true);
    for (const value of ['203.0.113', '0.0.0.0/0', '::/0', '::/64', '::ffff:0:0/96', '::ffff:192.0.2.0/119', 'invalid']) {
      expect(() => adminNetworks([value], true)).toThrow('bounded');
    }
    expect(() => adminNetworks([], true)).toThrow('explicitly restricted');
  });
  it('requires exact protected origin/marker and rejects cross-site metadata', () => {
    expect(sameOriginWrite(headers, origin, true)).toBe(true);
    expect(sameOriginWrite({}, origin, true)).toBe(false);
    expect(sameOriginWrite({ origin }, origin, true)).toBe(false);
    expect(sameOriginWrite({ ...headers, origin: `${origin}.evil` }, origin, true)).toBe(false);
    expect(sameOriginWrite({ ...headers, 'sec-fetch-site': 'cross-site' }, origin, true)).toBe(false);
    expect(sameOriginWrite({}, origin, false)).toBe(true);
    expect(sameOriginWrite({ origin: 'null' }, origin, false)).toBe(false);
  });
  it('reads only canonical unique auth cookies, ignoring malformed unrelated cookies', () => {
    const value = 'a'.repeat(32);
    expect(authToken(`legacy=%INVALID; __Host-ra-preview-parent=${value}`, '__Host-ra-preview-parent')).toBe(value);
    expect(authToken(`__Host-ra-preview-parent=${value}; __Host-ra-preview-parent=${value}`, '__Host-ra-preview-parent')).toBeUndefined();
    expect(authToken(`__Host-ra-preview-parent=%61${value.slice(1)}`, '__Host-ra-preview-parent')).toBeUndefined();
    expect(authToken(`sid=${value}`, '__Host-ra-preview-parent')).toBeUndefined();
    expect(authCookie('__Host-ra-preview-parent', '', 0, { production: true, realm: 'preview' })).toContain('Max-Age=0; Secure');
  });
  it('bounds limiter storage, never evicts active keys to grant attempts, and expires windows', () => {
    let time = 0; const limiter = new AuthRateLimiter(() => time, 2);
    expect(limiter.consume('a', 2, 1000).allowed).toBe(true);
    expect(limiter.consume('a', 2, 1000).allowed).toBe(true);
    expect(limiter.consume('a', 2, 1000).allowed).toBe(false);
    expect(limiter.consume('b', 1, 1000).allowed).toBe(true);
    expect(limiter.consume('c', 1, 1000)).toEqual({ allowed: false, retryAfter: 60 });
    expect(limiter.consume('a', 2, 1000).allowed).toBe(false);
    time = 60001;
    expect(limiter.consume('c', 1, 1000).allowed).toBe(true);
    expect(rateKey('login', 'SensitiveUsername')).not.toContain('SensitiveUsername');
    expect(rateKey('login', ' ALICE ')).toBe(rateKey('login', 'alice'));
  });
  it('sets finite quotas for each credential/mail action with no unlimited development switch', () => {
    for (const path of ['/api/auth/login', '/api/admin/login']) {
      expect(authRate(path, true)).toMatchObject({ ip: 20, identity: 10, window: 300000, fields: ['username'] });
    }
    expect(authRate('/api/auth/register', true)).toMatchObject({ ip: 10, identity: 3, window: 3600000, fields: ['username', 'email'] });
    for (const path of ['/api/auth/forgot', '/api/auth/reset', '/api/auth/resend']) {
      expect(authRate(path, true)).toMatchObject({ ip: 5, identity: 3, window: 900000 });
      expect(authRate(path, false)!.ip).toBeLessThanOrEqual(2000);
    }
    expect(authRate('/api/me', true)).toBeNull();
    expect(() => adminNetworks(Array(65).fill('203.0.113.10'), true)).toThrow('bounded');
  });
  it('rejects protected HTTP/credential-bearing/nonroot origins and mode downgrade', () => {
    for (const appBaseUrl of ['http://enrollment.example.org', 'https://user:secret@example.org', `${origin}/new/`, `${origin}?token=SECRET`]) {
      expect(() => httpPolicy({ ...protectedConfig(), appBaseUrl })).toThrow('APP_BASE_URL');
    }
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => httpPolicy({ ...protectedConfig(), httpSecurity: { production: false, realm: 'development' } })).toThrow('cannot disable');
  });
  it('forbids console/unknown production provider fallback without reflecting input', () => {
    expect(() => emailProviderFromEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'console' })).toThrow('forbidden');
    expect(() => emailProviderFromEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'DO_NOT_PRINT' })).toThrow('EMAIL_PROVIDER');
    expect(() => emailProviderFromEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: 'smtp' })).toThrow('SMTP connection');
    expect(() => buildServer({ config: protectedConfig(), db: createMemoryDatabase(), emailProvider: new ConsoleEmailProvider() })).toThrow('forbids console');
  });
});

describe('protected Fastify HTTP boundaries', () => {
  it('sets/clears only secure preview cookies and ignores production/legacy tokens', async () => {
    const db = createMemoryDatabase(); const parent = await sessionParent(db, realPasswordOps(4));
    const app = buildServer({ config: protectedConfig(), db, emailProvider: provider });
    try {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: parent.username, password: parent.password } });
      expect(login.statusCode).toBe(200);
      const name = '__Host-ra-preview-parent';
      const cookie = login.cookies.find((c) => c.name === name)!;
      const text = String(login.headers['set-cookie']);
      expect(text).toContain('Secure'); expect(text).toContain('HttpOnly'); expect(text).toContain('SameSite=Lax'); expect(text).toContain('Path=/'); expect(text).not.toContain('Domain=');
      for (const other of ['sid', '__Host-ra-parent']) {
        expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `${other}=${cookie.value}` } })).statusCode).toBe(401);
      }
      const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie: `${name}=${cookie.value}; selector=preview; sid=legacy` } });
      expect(logout.statusCode).toBe(200);
      expect(String(logout.headers['set-cookie'])).toContain(`${name}=;`);
      expect(String(logout.headers['set-cookie'])).not.toContain('selector=');
      expect(String(logout.headers['set-cookie'])).not.toContain('sid=');
      expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers })).statusCode).toBe(200);
      expect(await parent.auth.userIdForSession(cookie.value)).toBeNull();
      const production = httpPolicy(loadConfig({ NODE_ENV: 'production', DB_NAME: 'enrollment', APP_BASE_URL: origin, ADMIN_IP_ALLOWLIST: '203.0.113.10' }));
      expect(production.parentCookie).toBe('__Host-ra-parent');
      expect(production.adminCookie).toBe('__Host-ra-admin');
    } finally { await app.close(); }
  });

  it('rejects missing/null/lookalike origins and simple writes before any account/outbox write', async () => {
    const db = createMemoryDatabase(); const app = buildServer({ config: protectedConfig(), db, emailProvider: provider });
    try {
      for (const supplied of [{}, { ...headers, origin: 'null' }, { ...headers, origin: `${origin}/` }, { ...headers, origin: `${origin}.evil` }, { origin }, { ...headers, 'sec-fetch-site': 'same-site' }]) {
        const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: supplied, payload: { password: 'DO_NOT_PRINT' } });
        expect(response.statusCode).toBe(403);
        expect(response.body).not.toContain('DO_NOT_PRINT');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
      expect(db.store.users.size).toBe(0); expect(db.store.outbox).toHaveLength(0);
    } finally { await app.close(); }
  });

  it('does not authorize an untrusted peer using forged forwarding and rejects multiple-hop chains', async () => {
    const app = buildServer({ config: protectedConfig(), db: createMemoryDatabase(), emailProvider: provider });
    try {
      expect((await app.inject({ method: 'POST', url: '/api/admin/login', remoteAddress: '198.51.100.99', headers: { ...headers, 'x-forwarded-for': '203.0.113.10' }, payload: { username: 'missing', password: 'x' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/admin/login', headers: { ...headers, 'x-forwarded-for': '203.0.113.10, 198.51.100.99' }, payload: { username: 'missing', password: 'x' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/admin/login', headers: { ...headers, 'x-forwarded-for': '203.0.113.10' }, payload: { username: 'missing', password: 'x' } })).statusCode).toBe(401);
    } finally { await app.close(); }
  });

  it('returns 429 by normalized identity across IPs and recovers after the window', async () => {
    let now = 0; const db = createMemoryDatabase();
    const lookup = vi.spyOn(db.repos.users, 'findByUsername');
    const app = buildServer({ config: protectedConfig(), db, emailProvider: provider, securityClock: () => now });
    try {
      for (let n = 0; n < 10; n++) {
        expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers, remoteAddress: `198.51.100.${n + 1}`, payload: { username: n % 2 ? 'missing' : 'Missing', password: 'x' } })).statusCode).toBe(400);
      }
      const limited = await app.inject({ method: 'POST', url: '/api/auth/login', headers, remoteAddress: '198.51.100.50', payload: { username: 'missing', password: 'x' } });
      expect(limited.statusCode).toBe(429); expect(limited.headers['retry-after']).toBe('300'); expect(lookup).toHaveBeenCalledTimes(10);
      now = 300001;
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'missing', password: 'x' } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it.each([
    { path: '/api/auth/forgot', payload: { username: 'missing', email: 'missing@example.test' }, initial: 200 },
    { path: '/api/auth/resend', payload: { email: 'missing@example.test' }, initial: 200 },
    { path: '/api/auth/reset', payload: { token: 'a'.repeat(32), password: 'test-pass' }, initial: 400 },
    { path: '/api/auth/register', payload: { username: 'newparent', password: 'secret123', firstName: 'Synthetic', lastName: 'Fixture', state: 'UT', zip: 0, email: 'newparent@example.test', homePhone: '8015551234' }, initial: 201 },
  ])('limits identity attempts on $path across client IPs', async ({ path, payload, initial }) => {
    const db = createMemoryDatabase(); const app = buildServer({ config: protectedConfig(), db, emailProvider: provider });
    try {
      for (let n = 0; n < 3; n++) {
        const response = await app.inject({ method: 'POST', url: path, headers, remoteAddress: `198.51.100.${n + 1}`, payload });
        expect(response.statusCode).toBe(n > 0 && initial === 201 ? 400 : initial);
      }
      const response = await app.inject({ method: 'POST', url: path, headers, remoteAddress: '198.51.100.50', payload });
      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({ error: 'Too many requests; try again later.' });
      expect(response.headers['retry-after']).toBe(path.endsWith('register') ? '3600' : '900');
    } finally { await app.close(); }
  });

  it('bounds IP attempts independently of identities and bounds bodies/fields without leaking parser input', async () => {
    const db = createMemoryDatabase(); const app = buildServer({ config: protectedConfig(), db, emailProvider: provider });
    try {
      for (let n = 0; n < 20; n++) expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: `missing${n}`, password: 'x' } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: 'newidentity', password: 'x' } })).statusCode).toBe(429);
      const malformed = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { ...headers, 'content-type': 'application/json' }, payload: '{"password":"DO_NOT_PRINT"' });
      expect(malformed.statusCode).toBe(400); expect(malformed.body).not.toContain('DO_NOT_PRINT');
      const large = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { password: 'DO_NOT_PRINT'.repeat(2000) } });
      expect(large.statusCode).toBe(413); expect(large.body).not.toContain('DO_NOT_PRINT');
      const reset = await app.inject({ method: 'POST', url: '/api/auth/reset', headers, payload: { token: 'a'.repeat(32), password: '😀'.repeat(19) } });
      expect(reset.statusCode).toBe(400); expect(reset.body).not.toContain('😀');
      const unknown = await app.inject({ method: 'POST', url: '/api/auth/reset', headers,
        payload: { token: 'a'.repeat(32), password: 'test-pass', DO_NOT_PRINT: 'value' } });
      expect(unknown.statusCode).toBe(400); expect(unknown.body).not.toContain('DO_NOT_PRINT');
      expect(db.store.users.size).toBe(0);
    } finally { await app.close(); }
  });

  it('does not reflect or log unexpected error SQL/body/token/query/headers', async () => {
    const db = createMemoryDatabase();
    vi.spyOn(db.repos.users, 'findByUsername').mockRejectedValue(Object.assign(new Error('SQL password=DO_NOT_PRINT'), { code: 'DO_NOT_PRINT', sql: 'private SQL', stack: 'private stack' }));
    const app = buildServer({ config: protectedConfig(), db, emailProvider: provider });
    const log = vi.fn();
    app.addHook('onRequest', async (req) => { vi.spyOn(req.log, 'error').mockImplementation(log); });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login?token=DO_NOT_PRINT',
        headers: { ...headers, cookie: 'sid=DO_NOT_PRINT' }, payload: { username: 'synthetic', password: 'DO_NOT_PRINT' } });
      expect(response.statusCode).toBe(500); expect(response.json()).toEqual({ error: 'Internal error' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(log).toHaveBeenCalledWith({ code: 'UNEXPECTED_ERROR', route: '/api/auth/login', method: 'POST' }, 'Unhandled request error');
      expect(JSON.stringify(log.mock.calls)).not.toContain('DO_NOT_PRINT');
    } finally { await app.close(); }
  });

  it('supports bounded historical long-password login and never exposes protected registration/reset tokens', async () => {
    const db = createMemoryDatabase(); const parent = await sessionParent(db, realPasswordOps(4));
    const long = 'x'.repeat(100);
    await db.repos.users.setPasswordHash(parent.id, await realPasswordOps(4).hashBcrypt(long), 'bcrypt');
    const app = buildServer({ config: protectedConfig(), db, emailProvider: provider });
    try {
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username: parent.username, password: long } })).statusCode).toBe(200);
      const registration = await app.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username: 'newparent', password: 'secret123', firstName: 'Synthetic', lastName: 'Fixture', state: 'UT', zip: 0, email: 'newparent@example.test', homePhone: '8015551234' } });
      expect(registration.statusCode).toBe(201); expect(registration.json().confirmToken).toBeUndefined();
      const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot', headers, payload: { username: parent.username, email: parent.email } });
      expect(forgot.json()).toEqual({});
      expect((await app.inject({ method: 'GET', url: '/api/settings' })).json().emailDev).toBe(false);
      expect(forgot.headers['cache-control']).toBe('no-store'); expect(forgot.headers['referrer-policy']).toBe('no-referrer');
    } finally { await app.close(); }
  });
});
