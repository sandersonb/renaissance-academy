/**
 * Load a current-student roster CSV into `Current_Student` (status PEND_REENROLL)
 * so the re-enrollment flow can be tested — without the destructive full
 * Roll-New-Year (this only refreshes Current_Student, nothing else).
 *
 *   NODE_ENV=development DB_TLS_MODE=disabled DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD=secret DB_NAME=enrollment \
 *     npm run db:import-roster            # loads db/sample-roster.csv
 *     npm run db:import-roster -- ./my-roster.csv
 *
 * Uses the same validated parser as the admin import (skips the header, parses
 * M/D/YYYY dates, requires grade 1-9). Truncates Current_Student first so it's
 * re-runnable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMysqlDatabase, createPool } from '../adapters/mysql/index.js';
import { parseRoster } from '../../domain/rosterCsv.js';
import { databaseConnectionOptions } from '../adapters/mysql/connectionOptions.js';

async function main() {
  if (!process.env.DB_HOST) throw new Error('DB_HOST not set — importing requires a real database.');
  const file = process.argv[2] ?? join(process.cwd(), 'db', 'sample-roster.csv');
  const { rows, errors } = parseRoster(readFileSync(file, 'utf8'));
  if (errors.length > 0) {
    console.error(`${errors.length} error(s) in ${file}:`);
    for (const e of errors.slice(0, 10)) console.error(`  line ${e.line}: ${e.message}`);
    process.exit(1);
  }
  if (rows.length === 0) throw new Error('roster is empty');

  const pool = createPool(databaseConnectionOptions(process.env));
  const db = createMysqlDatabase(pool);

  await pool.query('TRUNCATE TABLE `Current_Student`');
  const imported = await db.repos.maintenance.importCurrentStudents(rows);
  console.log(`imported ${imported} current students from ${file} (status PEND_REENROLL)`);
  await pool.end();
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
