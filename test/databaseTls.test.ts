import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import type { Connection } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseConnectionOptions, readPublicCa } from '../src/app/adapters/mysql/connectionOptions.js';
import { inspectTransport } from '../src/app/adapters/mysql/tlsDiagnostic.js';

const directories: string[] = [];
const caFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-ca-unit-'));
  directories.push(dir);
  const path = join(dir, 'ca.pem');
  writeFileSync(path, rootCertificates[0]!); // Public CA only, not a private key fixture.
  return path;
};
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); });
const base = { NODE_ENV: 'production', DB_HOST: 'database.example.test', DB_USER: 'app', DB_PASSWORD: 'test-only', DB_NAME: 'preview' };

describe('shared verified MySQL transport policy', () => {
  it('requires a CA and defaults to certificate plus DNS identity verification', () => {
    expect(() => databaseConnectionOptions(base)).toThrow('DB_TLS_CA_FILE');
    const options = databaseConnectionOptions({ ...base, DB_TLS_CA_FILE: caFile() });
    expect(options.ssl).toMatchObject({ rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' });
    expect(options.multipleStatements).toBe(false);
    expect(databaseConnectionOptions({ ...base, DB_TLS_CA_FILE: caFile() }, { multipleStatements: true }).multipleStatements).toBe(true);
  });
  it.each(['production', 'development', 'test', ''])('never permits plaintext to a remote database in %s', (environment) => {
    expect(() => databaseConnectionOptions({ ...base, NODE_ENV: environment, DB_TLS_MODE: 'disabled' })).toThrow('local');
  });
  it('requires an explicit local dev/test exception and rejects it in production', () => {
    const env = { ...base, DB_HOST: '127.0.0.1', DB_TLS_MODE: 'disabled' };
    expect(() => databaseConnectionOptions(env)).toThrow('never production');
    expect(() => databaseConnectionOptions({ ...env, NODE_ENV: '' })).toThrow();
    expect(databaseConnectionOptions({ ...env, NODE_ENV: 'test' }).ssl).toBeUndefined();
    expect(databaseConnectionOptions({ ...env, NODE_ENV: 'development', DB_HOST: 'db' }).ssl).toBeUndefined();
    expect(() => databaseConnectionOptions({ ...base, NODE_ENV: 'development', DB_HOST: 'localhost' })).toThrow('DB_TLS_CA_FILE');
  });
  it.each(['127.0.0.1', '::1', '[::1]'])('rejects IP identity fallback for %s', (host) => {
    expect(() => databaseConnectionOptions({ ...base, DB_HOST: host, DB_TLS_CA_FILE: caFile() })).toThrow('DNS hostname');
  });
  it.each(['preferred', 'required', 'false', 'verify-ca', ''])('has no downgrade/unverified mode %s', (mode) => {
    expect(() => databaseConnectionOptions({ ...base, DB_TLS_MODE: mode, DB_TLS_CA_FILE: caFile() })).toThrow('DB_TLS_MODE');
  });
  it('rejects missing, relative, malformed and private-key CA input without printing contents', () => {
    expect(() => readPublicCa('relative.pem')).toThrow('absolute');
    const path = caFile();
    unlinkSync(path);
    expect(() => readPublicCa(path)).toThrow('readable');
    for (const text of ['DO_NOT_PRINT_A_SECRET', rootCertificates[0]! + '\nDO_NOT_PRINT_A_SECRET', rootCertificates[0]! + '\n-----BEGIN PRIVATE KEY-----\nDO_NOT_PRINT\n-----END PRIVATE KEY-----']) {
      writeFileSync(path, text);
      try { readPublicCa(path); throw new Error('Expected rejection'); }
      catch (error) { expect(String(error)).not.toContain('DO_NOT_PRINT'); expect(String(error)).toContain('public CA'); }
    }
  });
});

describe('read-only database transport diagnostic', () => {
  const connection = (cipher: string, protocol: string) => {
    const query = vi.fn().mockResolvedValueOnce([[{ selected_database: 'preview', version: '8.4.11', require_secure_transport: 0 }]])
      .mockResolvedValueOnce([[{ Variable_name: 'Ssl_cipher', Value: cipher }, { Variable_name: 'Ssl_version', Value: protocol }]]);
    return { query, client: { query } as unknown as Connection };
  };
  it('only reads allowlisted server/session metadata, never application records', async () => {
    const { query, client } = connection('TEST_CIPHER', 'TLSv1.3');
    expect(await inspectTransport(client, true)).toEqual({ selected_database: 'preview', version: '8.4.11', require_secure_transport: 0,
      encrypted: true, certificate_and_hostname_verified: true, cipher: 'TEST_CIPHER', protocol: 'TLSv1.3' });
    expect(query.mock.calls).toEqual([
      ['SELECT DATABASE() AS selected_database, @@version AS version, @@GLOBAL.require_secure_transport AS require_secure_transport'],
      ["SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')"],
    ]);
  });
  it.each([['', ''], ['TEST_CIPHER', 'TLSv1.1']])('refuses missing/obsolete encryption for a verified connection', async (cipher, protocol) => {
    const { client } = connection(cipher, protocol);
    await expect(inspectTransport(client, true)).rejects.toThrow('TLS 1.2+');
  });
});
