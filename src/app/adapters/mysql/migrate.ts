/**
 * Minimal migration runner: applies db/migrations/*.sql in order against the
 * configured database. Tolerant of "already applied" errors (duplicate
 * column/table/key) so it can be re-run safely. Run: npm run db:migrate
 *
 * Connection from env: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';

const IGNORABLE = new Set([
  1050, // table already exists
  1060, // duplicate column name
  1061, // duplicate key name
  1062, // duplicate entry (re-running data inserts)
]);

async function main() {
  const dir = join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (!process.env.DB_HOST) throw new Error('DB_HOST not set');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'enrollment',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    multipleStatements: false,
  });

  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    // Strip `--` line comments BEFORE splitting, so a ';' inside a comment
    // doesn't break statement splitting. (Simple runner: assumes no `--` or `;`
    // inside string literals, which holds for these migrations.)
    const statements = sql
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    let applied = 0;
    let skipped = 0;
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
        applied++;
      } catch (e) {
        const code = (e as { errno?: number }).errno;
        if (code && IGNORABLE.has(code)) skipped++;
        else {
          console.error(`\n${file}: failed statement:\n${stmt}\n`);
          throw e;
        }
      }
    }
    console.log(`${file}: ${applied} applied, ${skipped} already present`);
  }
  await conn.end();
  console.log('migrations complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
