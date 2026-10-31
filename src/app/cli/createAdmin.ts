/**
 * Bootstrap / create an admin account. Run on the server:
 *   npm run admin:create -- --username alice
 * Password is taken from ADMIN_PASSWORD if set, otherwise prompted.
 * Requires DB_HOST (uses the same env as the API).
 */
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { createMysqlRepositories, createPool } from '../adapters/mysql/index.js';
import { AdminAuthService } from '../services/adminAuthService.js';
import { databaseConnectionOptions } from '../adapters/mysql/connectionOptions.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  if (!process.env.DB_HOST) throw new Error('DB_HOST not set');
  const databaseOptions = databaseConnectionOptions(process.env);
  const username = arg('--username') ?? process.env.ADMIN_USERNAME ?? (await prompt('Admin username: '));
  const password = process.env.ADMIN_PASSWORD ?? (await prompt(`Password for '${username}': `));

  const pool = createPool(databaseOptions);
  const repos = createMysqlRepositories(pool);
  const admin = new AdminAuthService(repos.admins, repos.adminSessions, loadConfig());
  const id = await admin.createAdmin(username, password);
  console.log(`created admin '${username}' (id=${id})`);
  await pool.end();
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
