/** Disposable, uniquely owned MySQL 8.4.11. Never reads DB_* or removes old containers. */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql, { type Connection, type ConnectionOptions, type Pool } from 'mysql2/promise';
import { applyMigrations, initializeCycle, loadMigrations } from '../../src/app/adapters/mysql/migrations/engine.js';
import { databaseConnectionOptions } from '../../src/app/adapters/mysql/connectionOptions.js';
import { createTlsFixture } from '../tlsFixtures.js';

const ROOT = process.cwd();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function dockerAvailable(): boolean {
  try { execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore', timeout: 10000 }); return true; }
  catch { return false; }
}

export async function startTestMysql(options: { migrate?: boolean; tls?: boolean; base?: boolean } = {}): Promise<{
  pool: Pool; config: ConnectionOptions; tlsCaFile?: string; stop: () => Promise<void>;
}> {
  if (!dockerAvailable()) throw new Error('Functional tests require Docker; refusing to silently skip MySQL verification.');
  const name = `ra-mysql-${randomUUID()}`;
  const password = randomUUID(); // Disposable test-only credential, never an RDS secret.
  let ownedId: string | undefined;
  let pool: Pool | undefined;
  const certificates = options.tls === false ? undefined : createTlsFixture();
  const stop = async () => {
    await pool?.end().catch(() => {});
    if (ownedId) {
      execFileSync('docker', ['rm', '-f', ownedId], { stdio: 'ignore', timeout: 30000 });
      ownedId = undefined;
    }
    certificates?.cleanup();
  };
  try {
    const mounts = certificates ? [
      '--mount', `type=bind,src=${certificates.caFile},dst=/tls/ca.pem,readonly`,
      '--mount', `type=bind,src=${certificates.certFile},dst=/tls/server.pem,readonly`,
      '--mount', `type=bind,src=${certificates.keyFile},dst=/tls/server-key.pem,readonly`,
    ] : [];
    const serverOptions = certificates ? ['--ssl-ca=/tls/ca.pem', '--ssl-cert=/tls/server.pem', '--ssl-key=/tls/server-key.pem'] :
      ['--auto-generate-certs=OFF', '--ssl-ca=', '--ssl-cert=', '--ssl-key='];
    ownedId = execFileSync('docker', ['run', '-d', '--name', name, '--memory=1g', '--cpus=2', ...mounts,
      '-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', 'MYSQL_DATABASE=enrollment',
      '-p', '127.0.0.1::3306', 'mysql:8.4.11', '--require-secure-transport=OFF', ...serverOptions], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120000 }).trim();
    const port = Number(execFileSync('docker', ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}', ownedId], { encoding: 'utf8' }).trim());
    const config = databaseConnectionOptions({ NODE_ENV: 'test', DB_HOST: certificates ? 'localhost' : '127.0.0.1',
      DB_PORT: String(port), DB_USER: 'root', DB_PASSWORD: password, DB_NAME: 'enrollment',
      DB_TLS_MODE: certificates ? 'verify_identity' : 'disabled', DB_TLS_CA_FILE: certificates?.caFile }, { multipleStatements: true });
    config.connectTimeout = 1000;
    let connection: Connection | undefined;
    for (let attempt = 0; attempt < 120; attempt++) {
      try { connection = await mysql.createConnection(config); break; }
      catch { await sleep(500); }
    }
    if (!connection) throw new Error('Disposable MySQL 8.4 did not become TCP-ready');
    try {
      if (options.base !== false) await connection.query(readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8'));
      if (options.migrate !== false) {
        const migrations = loadMigrations(join(ROOT, 'db', 'migrations'));
        await applyMigrations(connection, migrations, { apply: true });
        await initializeCycle(connection, migrations, { yearBegin: 2026, lotteryOpen: true, postLottery: false }, { apply: true });
      }
    } finally { await connection.end(); }
    pool = mysql.createPool({ ...config, multipleStatements: false, connectionLimit: 5 });
    return { pool, config, tlsCaFile: certificates?.caFile, stop };
  } catch (error) { await stop(); throw error; }
}

/** Each call is given only the pool created by the disposable harness. */
export async function resetData(pool: Pool): Promise<void> {
  const tables = ['Child', 'Parent', 'users', 'user_cookies', 'app_sessions', 'admin_sessions',
    'admin_users', 'Note', 'ParentExtra', 'ChildExtra', 'Current_Student',
    'lottery_run', 'lottery_assignment', 'email_outbox'];
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of tables) await pool.query(`TRUNCATE TABLE \`${table}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
}
