/** Import the entrypoint with isolated memory/mocked startup boundaries; never connect, start or deliver. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/app/config.js';

afterEach(() => {
  vi.doUnmock('../src/app/config.js');
  vi.doUnmock('../src/app/services/adminAuthService.js');
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules();
});

describe('HTTP startup fail-closed ordering', () => {
  it.each(['provider', 'origin', 'admin-list'])('rejects invalid %s before optional bootstrap or timers', async (failure) => {
    const config = loadConfig({ NODE_ENV: 'production', DB_NAME: 'enrollment_preview', APP_BASE_URL: 'https://enrollment.example.test',
      ADMIN_IP_ALLOWLIST: '203.0.113.10', BCRYPT_COST: '4' });
    if (failure === 'origin') config.appBaseUrl = 'http://enrollment.example.test';
    if (failure === 'admin-list') config.adminIpAllowlist = [];
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DB_HOST', '');
    vi.stubEnv('EMAIL_PROVIDER', failure === 'provider' ? 'unknown' : 'smtp');
    // Transport construction alone is inert; send/start must never be reached.
    vi.stubEnv('SMTP_HOST', 'localhost');
    vi.stubEnv('ADMIN_BOOTSTRAP_USER', 'syntheticstaff'); vi.stubEnv('ADMIN_BOOTSTRAP_PASSWORD', 'DO_NOT_PRINT');
    vi.stubEnv('EMAIL_WORKER_INTERVAL_MS', '1'); vi.stubEnv('REMINDER_INTERVAL_MS', '1');
    const bootstrap = vi.fn();
    vi.doMock('../src/app/config.js', async (original) => ({ ...await original<typeof import('../src/app/config.js')>(), loadConfig: () => config }));
    vi.doMock('../src/app/services/adminAuthService.js', async (original) => {
      const actual = await original<typeof import('../src/app/services/adminAuthService.js')>();
      return { ...actual, AdminAuthService: class extends actual.AdminAuthService { bootstrapIfEmpty = bootstrap; } };
    });
    const timers = vi.spyOn(globalThis, 'setInterval');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(import('../src/app/http/main.js')).rejects.toThrow(failure === 'provider' ? 'EMAIL_PROVIDER' : failure === 'origin' ? 'APP_BASE_URL' : 'ADMIN_IP_ALLOWLIST');
    expect(bootstrap).not.toHaveBeenCalled(); expect(timers).not.toHaveBeenCalled();
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain('DO_NOT_PRINT');
  });
});
