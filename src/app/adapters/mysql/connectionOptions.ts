/** Shared transport policy for every NEW MySQL entrypoint; never changes RDS. */
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import type { ConnectionOptions } from 'mysql2/promise';

export class DatabaseConfigurationError extends Error {}
export interface DatabaseOptions extends ConnectionOptions {
  host: string; user: string; password: string; database: string; port: number;
  ssl: Exclude<ConnectionOptions['ssl'], string> | undefined;
}

export function readPublicCa(filename: string): Buffer {
  try {
    if (!isAbsolute(filename)) throw new Error('CA path must be absolute');
    const bytes = readFileSync(filename);
    const text = bytes.toString('utf8');
    const certificates = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    const remainder = text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join('').trim();
    if (!certificates?.length || remainder || /PRIVATE KEY/.test(text) ||
        certificates.some((pem) => !new X509Certificate(pem).ca)) throw new Error('Not a public CA bundle');
    return bytes;
  } catch {
    // Never print file content: an operator might accidentally name a secret file.
    throw new DatabaseConfigurationError('DB_TLS_CA_FILE must be an absolute, readable PEM file containing public CA certificates only.');
  }
}

export function databaseConnectionOptions(env: NodeJS.ProcessEnv, options: { multipleStatements?: boolean } = {}): DatabaseOptions {
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!env[key]?.trim()) throw new DatabaseConfigurationError(`${key} must be explicitly configured; no implicit root/database/password defaults.`);
  }
  const host = env.DB_HOST!;
  const port = Number(env.DB_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DatabaseConfigurationError('DB_PORT must be a valid TCP port.');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(env.DB_NAME!) || /[@/\s]/.test(host)) throw new DatabaseConfigurationError('Use a plain DB hostname/address and schema name, not a credential-bearing URL.');
  const mode = env.DB_TLS_MODE ?? 'verify_identity';
  let ssl: DatabaseOptions['ssl'];
  if (mode === 'disabled') {
    if (!['development', 'test'].includes(env.NODE_ENV ?? '') || !['localhost', '127.0.0.1', '::1', 'db'].includes(host)) {
      throw new DatabaseConfigurationError('Disabled DB TLS is allowed only for explicit local development/test (loopback or the local Docker db service), never production/RDS.');
    }
  } else if (mode === 'verify_identity') {
    // mysql2's verifyIdentity/SNI path is hostname-based. Do not silently use its
    // localhost/IP fallback: real RDS clients must name their actual DNS endpoint.
    if (isIP(host) || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)) {
      throw new DatabaseConfigurationError('Verified DB TLS requires the certificate DNS hostname, not an IP literal or credential URL. Use the actual RDS endpoint.');
    }
    if (!env.DB_TLS_CA_FILE) throw new DatabaseConfigurationError('DB_TLS_CA_FILE is required for verified TLS; no unverified/default or plaintext fallback.');
    ssl = { ca: readPublicCa(env.DB_TLS_CA_FILE), rejectUnauthorized: true, verifyIdentity: true, minVersion: 'TLSv1.2' };
  } else {
    throw new DatabaseConfigurationError('DB_TLS_MODE must be verify_identity or the restricted local-only disabled mode.');
  }
  return { host, user: env.DB_USER!, password: env.DB_PASSWORD!, database: env.DB_NAME!, port,
    connectTimeout: 10000, dateStrings: true, multipleStatements: options.multipleStatements === true, ssl };
}
