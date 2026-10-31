import mysql from 'mysql2/promise';
import { databaseConnectionOptions, DatabaseConfigurationError } from '../adapters/mysql/connectionOptions.js';
import { inspectTransport } from '../adapters/mysql/tlsDiagnostic.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('db:check-tls — read-only server/session metadata. No schema/history/app-data reads or writes.\nConfigure explicit DB_* plus DB_TLS_CA_FILE; verified TLS is the default. No secret CLI flags.');
    return;
  }
  if (args.length) throw new DatabaseConfigurationError('No diagnostic flags except --help; credentials are environment-only.');
  const options = databaseConnectionOptions(process.env);
  const connection = await mysql.createConnection(options);
  try { console.log(JSON.stringify({ host: options.host, ...await inspectTransport(connection, Boolean(options.ssl)) }, null, 2)); }
  finally { await connection.end().catch(() => {}); }
}
main().catch((error: unknown) => {
  const code = String((error as { code?: string })?.code ?? 'DATABASE_TLS_ERROR');
  console.error(error instanceof DatabaseConfigurationError ? error.message :
    `Database TLS diagnostic failed (${/^[A-Z0-9_]{1,64}$/.test(code) ? code : 'DATABASE_TLS_ERROR'}). No fallback or mutations attempted.`);
  process.exitCode = 1;
});
