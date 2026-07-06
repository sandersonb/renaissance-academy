/**
 * Functional-test harness: spins up a real MySQL in Docker, loads the committed
 * schema + additive migrations, and hands back a connection pool. This turns the
 * ad-hoc docker+curl checks into reproducible tests. Container is named
 * `ra-func-mysql` on host port 3308 (separate from dev's 3307).
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import mysql, { type Pool } from 'mysql2/promise';

const CONTAINER = 'ra-func-mysql';
const PORT = 3308;
const ROOT = process.cwd();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fast, reliable docker liveness probe (avoids the slow `docker info` trap). */
export function dockerAvailable(): boolean {
  try {
    execSync('docker info --format "{{.ServerVersion}}"', { stdio: 'ignore', timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

function sh(cmd: string, input?: Buffer) {
  execSync(cmd, { stdio: input ? ['pipe', 'ignore', 'ignore'] : 'ignore', input });
}

export async function startTestMysql(): Promise<{ pool: Pool; stop: () => Promise<void> }> {
  sh(`docker rm -f ${CONTAINER} || true`);
  execSync(
    `docker run -d --name ${CONTAINER} -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=enrollment ` +
      `-p ${PORT}:3306 mysql:8.0 --default-authentication-plugin=mysql_native_password`,
    { stdio: 'ignore' },
  );

  // Wait until the server answers.
  let ready = false;
  for (let i = 0; i < 90; i++) {
    try {
      execSync(`docker exec ${CONTAINER} mysqladmin ping -uroot -psecret`, { stdio: 'ignore' });
      ready = true;
      break;
    } catch {
      await sleep(2000);
    }
  }
  if (!ready) throw new Error('MySQL container did not become ready');

  // Load schema (-f to skip view-definer warnings), then migrations in order.
  const mysqlIn = `docker exec -i ${CONTAINER} mysql -uroot -psecret enrollment`;
  sh(`${mysqlIn} -f`, readFileSync(join(ROOT, 'db', 'schema.sql')));
  const migDir = join(ROOT, 'db', 'migrations');
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
    sh(mysqlIn, readFileSync(join(migDir, f)));
  }

  const pool = mysql.createPool({
    host: '127.0.0.1', port: PORT, user: 'root', password: 'secret',
    database: 'enrollment', dateStrings: true, connectionLimit: 5,
  });
  const stop = async () => {
    await pool.end().catch(() => {});
    sh(`docker rm -f ${CONTAINER} || true`);
  };
  return { pool, stop };
}

/** Truncate the per-year mutable tables (mirrors the December reset); keeps the
 *  reference data (ExtraTitles/Extra/MaxEnrollment) so each test starts clean. */
export async function resetData(pool: Pool): Promise<void> {
  const tables = [
    'Child', 'Parent', 'users', 'user_cookies', 'app_sessions', 'admin_sessions',
    'admin_users', 'Note', 'ParentExtra', 'ChildExtra', 'Current_Student',
    'lottery_run', 'lottery_assignment', 'email_outbox',
  ];
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of tables) await pool.query(`TRUNCATE TABLE \`${t}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
}
