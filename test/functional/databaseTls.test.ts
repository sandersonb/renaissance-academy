import { execFile } from 'node:child_process';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import mysql, { type Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseConnectionOptions } from '../../src/app/adapters/mysql/connectionOptions.js';
import { createPool } from '../../src/app/adapters/mysql/index.js';
import { inspectTransport } from '../../src/app/adapters/mysql/tlsDiagnostic.js';
import { createTlsFixture } from '../tlsFixtures.js';
import { startTestMysql } from './harness.js';

const execute = promisify(execFile);

describe('verified TLS with optional MySQL 8.4 server enforcement', () => {
  let server: Awaited<ReturnType<typeof startTestMysql>>;
  let unrelated: ReturnType<typeof createTlsFixture>;
  const environment = () => ({ NODE_ENV: 'production', DB_HOST: 'localhost', DB_PORT: String(server.config.port),
    DB_USER: 'root', DB_PASSWORD: String(server.config.password), DB_NAME: 'enrollment',
    DB_TLS_MODE: 'verify_identity', DB_TLS_CA_FILE: server.tlsCaFile });
  beforeAll(async () => { server = await startTestMysql({ migrate: false }); unrelated = createTlsFixture(); }, 180000);
  afterAll(async () => { unrelated?.cleanup(); await server?.stop(); });

  it('verifies chain and hostname with a negotiated TLS 1.2+ session while global enforcement is OFF', async () => {
    const connection = await mysql.createConnection(databaseConnectionOptions(environment()));
    try {
      const report = await inspectTransport(connection, true);
      expect(report.encrypted).toBe(true);
      expect(report.certificate_and_hostname_verified).toBe(true);
      expect(report.require_secure_transport).toBe(0);
      expect(['TLSv1.2', 'TLSv1.3']).toContain(report.protocol);
      expect(report.cipher).not.toBe('');
    } finally { await connection.end(); }
  });

  it('keeps API pool TLS verified and runtime multi-statements disabled', async () => {
    const options = databaseConnectionOptions(environment(), { multipleStatements: true });
    const pool = createPool(options);
    try {
      const [status] = await pool.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      expect((status as { Value: string }[])[0]!.Value).not.toBe('');
      await expect(pool.query('SELECT 1; SELECT 2')).rejects.toThrow();
    } finally { await pool.end(); }
  });

  it('allows an unchanged legacy-style non-TLS client on the same optional server', async () => {
    const connection = await mysql.createConnection({ ...server.config, host: '127.0.0.1', ssl: undefined });
    try {
      const report = await inspectTransport(connection, false);
      expect(report.encrypted).toBe(false);
      expect(report.cipher).toBe('');
      expect(report.require_secure_transport).toBe(0);
    } finally { await connection.end(); }
  });

  it('rejects an untrusted CA rather than downgrading or ignoring certificate verification', async () => {
    await expect(mysql.createConnection(databaseConnectionOptions({ ...environment(), DB_TLS_CA_FILE: unrelated.caFile }))).rejects.toThrow();
  });

  it('rejects a wrong hostname even when the certificate CA is trusted', async () => {
    const options = databaseConnectionOptions({ ...environment(), DB_HOST: 'wrong-name.example.test' });
    // Test-only stream directs TCP to the owned container while retaining the
    // deliberately wrong TLS identity/SNI. No production hostname override flag.
    let connection: Connection | undefined;
    try {
      connection = await mysql.createConnection({ ...options, stream: () => connect({ host: '127.0.0.1', port: Number(server.config.port) }) });
      throw new Error('Expected hostname rejection');
    } catch (error) {
      expect(String(error)).toMatch(/hostname|altnames|certificate|ssl/i);
      expect(String(error)).not.toContain('Expected hostname rejection');
    } finally { await connection?.end().catch(() => {}); }
  });

  it('diagnostic CLI reads session metadata without creating history or reading application records', async () => {
    const [before] = await server.pool.query('SHOW TABLES');
    const result = await execute(process.execPath, ['--import', 'tsx', 'src/app/cli/checkDbTls.ts'], {
      cwd: process.cwd(), timeout: 10000, env: { ...process.env, ...environment() },
    });
    const report = JSON.parse(result.stdout);
    expect(report.certificate_and_hostname_verified).toBe(true);
    expect(report.selected_database).toBe('enrollment');
    const [after] = await server.pool.query('SHOW TABLES');
    expect(after).toEqual(before);
    expect(JSON.stringify(report)).not.toContain(String(server.config.password));
  });

  it('every real DB entrypoint refuses a missing CA before connecting or mutating the disposable schema', async () => {
    const [before] = await server.pool.query('SHOW TABLES');
    const entrypoints: [string, string[]][] = [
      ['src/app/http/main.ts', []],
      ['src/app/adapters/mysql/migrate.ts', ['--apply']],
      ['src/app/cli/initSettings.ts', ['--year=2027', '--lottery-open=false', '--post-lottery=false', '--apply']],
      ['src/app/cli/initPreview.ts', ['--apply']],
      ['src/app/cli/createAdmin.ts', ['--username', 'test-only-admin']],
      ['src/app/cli/importRoster.ts', []],
      ['src/app/cli/seed.ts', []],
      ['src/app/cli/checkDbTls.ts', []],
    ];
    for (const [file, args] of entrypoints) {
      await expect(execute(process.execPath, ['--import', 'tsx', file, ...args], {
        cwd: process.cwd(), timeout: 10000,
        env: { ...process.env, ...environment(), DB_NAME: file.endsWith('/initPreview.ts') ? 'enrollment_preview' : 'enrollment',
          DB_TLS_CA_FILE: '', ADMIN_PASSWORD: 'test-only-not-created' },
      })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('DB_TLS_CA_FILE') });
    }
    expect((await server.pool.query('SHOW TABLES'))[0]).toEqual(before);
  }, 30000);

  it('refuses a server with TLS unavailable without falling back to a legacy connection', async () => {
    const plaintext = await startTestMysql({ migrate: false, tls: false });
    try {
      const options = databaseConnectionOptions({ ...environment(), DB_PORT: String(plaintext.config.port) });
      await expect(mysql.createConnection(options)).rejects.toMatchObject({ code: 'HANDSHAKE_NO_SSL_SUPPORT' });
      // The server itself is alive and accepts plaintext: failure was the NEW
      // client's TLS requirement, not simply unavailable TCP/server resources.
      const legacy = await mysql.createConnection(plaintext.config);
      try { expect((await inspectTransport(legacy, false)).encrypted).toBe(false); }
      finally { await legacy.end(); }
    } finally { await plaintext.stop(); }
  });
});
