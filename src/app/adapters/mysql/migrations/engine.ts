import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import type { Connection } from 'mysql2/promise';
import { backfillCatalog, catalogConflicts, parseCatalog, rows, type Catalog, type Queryable } from './catalog.js';
import { PREVIEW_HISTORY, previewCompletionIssue } from './previewState.js';

export const HISTORY = 'enrollment_schema_migrations';
export class MigrationSafetyError extends Error {}
export interface Migration { filename: string; checksum: string; sql: string; catalog?: Catalog }
export interface Issue { kind: 'dirty' | 'drift' | 'unknown' | 'ordering' | 'untracked' | 'catalog' | 'baseline'; message: string; filename?: string }
export interface Entry { filename: string; checksum: string; state: 'pending' | 'running' | 'applied' | 'failed'; recordedChecksum?: string }
export interface Inspection { database: string; historyExists: boolean; entries: Entry[]; issues: Issue[] }
export interface Cycle { yearBegin: number; lotteryOpen: boolean; postLottery: boolean }
const NEW_TABLES = ['app_sessions', 'admin_users', 'admin_sessions', 'lottery_run', 'lottery_assignment', 'app_settings', 'email_outbox', 'enrollment_document'];

export function loadMigrations(directory: string): Migration[] {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) throw new MigrationSafetyError('Migration directory missing or not a real directory. Run from the release root containing db/migrations.');
  const sequences = new Set<string>();
  const result = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort().map((filename) => {
    const match = /^(\d{3})_[a-z0-9_]+\.sql$/.exec(filename);
    if (!match || match[1] === '000' || sequences.has(match[1]!)) throw new MigrationSafetyError('Invalid or duplicate migration sequence.');
    sequences.add(match[1]!);
    const file = join(directory, filename);
    if (!lstatSync(file).isFile()) throw new MigrationSafetyError('Migration files must be regular files, not symlinks.');
    const sqlBytes = readFileSync(file);
    const sql = new TextDecoder('utf-8', { fatal: true }).decode(sqlBytes);
    const companion = file.replace(/\.sql$/, '.json');
    let raw = Buffer.alloc(0);
    let catalog: Catalog | undefined;
    if (existsSync(companion)) {
      if (filename !== '002_survey_data.sql' || !lstatSync(companion).isFile()) throw new MigrationSafetyError('Unsupported migration companion.');
      raw = readFileSync(companion);
      catalog = parseCatalog(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    }
    if (filename === '002_survey_data.sql' && !catalog) throw new MigrationSafetyError('Survey migration requires its reviewed companion.');
    return { filename, sql, catalog, checksum: createHash('sha256').update(sqlBytes).update('\0').update(raw).digest('hex') };
  });
  if (!result.length) throw new MigrationSafetyError('No migrations found. Check the working directory.');
  return result;
}

async function databaseName(db: Queryable): Promise<string> {
  const result = await rows(db, 'SELECT DATABASE() AS name');
  if (!result[0]?.name) throw new MigrationSafetyError('An explicit database must be selected.');
  return String(result[0].name);
}

export async function inspectMigrations(db: Queryable, migrations: Migration[]): Promise<Inspection> {
  const database = await databaseName(db);
  const tables = await rows(db, 'SELECT TABLE_NAME AS n, ENGINE AS e FROM information_schema.tables WHERE table_schema=DATABASE()');
  const names = new Set(tables.map((t) => String(t.n)));
  const historyExists = names.has(HISTORY);
  const history = historyExists ? await rows(db, `SELECT filename, checksum, state FROM ${HISTORY} ORDER BY filename`) : [];
  const byName = new Map(history.map((h) => [String(h.filename), h]));
  const issues: Issue[] = [];
  if (migrations.some((migration) => migration.filename === '009_session_revocation.sql')) {
    const authTables = new Set(['users', 'Parent', 'admin_users', 'app_sessions', 'admin_sessions']);
    for (const table of tables) {
      if (authTables.has(String(table.n)) && table.e !== 'InnoDB') {
        issues.push({ kind: 'baseline', message: `Session security requires InnoDB authentication table: ${table.n}. Review engine conversion separately.` });
      }
    }
  }
  if (names.has(PREVIEW_HISTORY)) {
    const issue = await previewCompletionIssue(db, database, migrationLockName(database));
    if (issue) issues.push({ kind: 'dirty', message: issue });
  }
  if (historyExists && tables.find((t) => t.n === HISTORY)?.e !== 'InnoDB') issues.push({ kind: 'baseline', message: 'Migration history must use InnoDB.' });
  const known = new Set(migrations.map((m) => m.filename));
  for (const h of history) {
    if (!known.has(String(h.filename))) issues.push({ kind: 'unknown', message: `Recorded migration is missing: ${h.filename}` });
  }
  let gap = false;
  const entries = migrations.map((migration): Entry => {
    const record = byName.get(migration.filename);
    const state = record ? String(record.state) : 'pending';
    if (record && String(record.checksum) !== migration.checksum) issues.push({ kind: 'drift', filename: migration.filename, message: `Checksum mismatch: ${migration.filename}` });
    if (!['pending', 'running', 'applied', 'failed'].includes(state) || (record && state === 'pending')) issues.push({ kind: 'unknown', message: `Invalid history state: ${migration.filename}` });
    if (state === 'running' || state === 'failed') issues.push({ kind: 'dirty', filename: migration.filename,
      message: state === 'running' ? `Running or interrupted migration: ${migration.filename}. Wait for any active operator; only an interrupted run needs operator-reviewed recovery.` :
        `Operator-reviewed recovery required: ${migration.filename} (${state})` });
    if (state === 'applied' && gap) issues.push({ kind: 'ordering', message: `Applied migration follows an incomplete predecessor: ${migration.filename}` });
    if (state !== 'applied') gap = true;
    return { filename: migration.filename, checksum: migration.checksum, state: state as Entry['state'], recordedChecksum: record ? String(record.checksum) : undefined };
  });
  if (!history.length) {
    const newColumns = await rows(db, "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='users' AND column_name IN ('pw_hash','pw_algo')) OR (table_name='Parent' AND column_name IN ('confirm_token','confirm_expires','reset_token','reset_expires')) OR (table_name='ExtraTitles' AND column_name IN ('input_type','active','sort_order')))");
    if (NEW_TABLES.some((name) => names.has(name)) || newColumns.length) issues.push({ kind: 'untracked', message: 'Untracked new-app schema exists without migration history. Do not baseline or ignore it automatically.' });
  }
  if (migrations.some((m) => m.filename === '001_additive.sql')) {
    for (const name of ['users', 'Parent', 'Child', 'ChildExtra', 'ParentExtra', 'Current_Student', 'Note', 'MaxEnrollment', 'Extra', 'ExtraTitles']) {
      if (!names.has(name)) issues.push({ kind: 'baseline', message: `Missing legacy base table: ${name}` });
    }
  }
  for (const migration of migrations) {
    if (migration.catalog && entries.find((e) => e.filename === migration.filename)?.state === 'pending' && names.has('ExtraTitles') && names.has('Extra')) {
      for (const message of await catalogConflicts(db, migration.catalog)) issues.push({ kind: 'catalog', filename: migration.filename, message });
    }
  }
  return { database, historyExists, entries, issues };
}

function requireClean(inspection: Inspection): void {
  if (inspection.issues.length) throw new MigrationSafetyError(inspection.issues.map((i) => i.message).join('\n'));
}

export async function requireCurrentMigrations(db: Queryable, migrations: Migration[]): Promise<void> {
  const status = await inspectMigrations(db, migrations);
  requireClean(status);
  if (!status.historyExists || status.entries.some((e) => e.state !== 'applied')) throw new MigrationSafetyError('Database upgrades are incomplete. Inspect db:migrate, then explicitly approve --apply.');
}

export function migrationLockName(database: string): string {
  return `ra:migrate:${createHash('sha256').update(database).digest('hex').slice(0, 48)}`;
}

export async function withMigrationLock<T>(connection: Connection, work: () => Promise<T>): Promise<T> {
  const name = migrationLockName(await databaseName(connection));
  const result = await rows(connection, 'SELECT GET_LOCK(?, 0) AS acquired', [name]);
  if (Number(result[0]?.acquired) !== 1) throw new MigrationSafetyError('Another migration/initialization operator holds the schema lock.');
  try { return await work(); }
  finally { await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {}); }
}

async function createHistory(connection: Connection): Promise<void> {
  await connection.query(`CREATE TABLE IF NOT EXISTS ${HISTORY} (
    filename VARCHAR(191) PRIMARY KEY, checksum CHAR(64) NOT NULL,
    state ENUM('running','applied','failed') NOT NULL,
    started_at DATETIME(6) NOT NULL, applied_at DATETIME(6) NULL,
    started_by VARCHAR(255) NOT NULL, failure_code VARCHAR(64) NULL,
    repair_reason VARCHAR(512) NULL, repaired_by VARCHAR(255) NULL, repaired_at DATETIME(6) NULL
  ) ENGINE=InnoDB`);
}

function failureCode(error: unknown): string {
  const code = String((error as { code?: string })?.code ?? 'MIGRATION_ERROR');
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'MIGRATION_ERROR';
}

async function strictWrites(connection: Connection): Promise<void> {
  // Connection-local only, and only after explicit write approval. Do not rely
  // on a legacy server's permissive mode silently accepting truncated data.
  await connection.query("SET SESSION sql_mode=CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_ALL_TABLES')");
}

/** Dedicated connection MUST enable multipleStatements for trusted SQL files only. */
export async function applyMigrations(connection: Connection, migrations: Migration[], options: { apply?: boolean } = {}): Promise<Inspection> {
  if (!options.apply) return inspectMigrations(connection, migrations);
  return withMigrationLock(connection, async () => {
    const status = await inspectMigrations(connection, migrations);
    requireClean(status);
    const pending = migrations.filter((m) => status.entries.find((e) => e.filename === m.filename)?.state === 'pending');
    if (!pending.length) return status;
    await strictWrites(connection);
    await createHistory(connection);
    for (const migration of pending) {
      await connection.query(`INSERT INTO ${HISTORY} (filename,checksum,state,started_at,started_by) VALUES (?,?,'running',NOW(6),CURRENT_USER())`, [migration.filename, migration.checksum]);
      try {
        await connection.query(migration.sql);
        if (migration.catalog) {
          await connection.beginTransaction();
          await backfillCatalog(connection, migration.catalog);
          await connection.commit();
        }
        await connection.query(`UPDATE ${HISTORY} SET state='applied',applied_at=NOW(6) WHERE filename=? AND state='running'`, [migration.filename]);
      } catch (error) {
        await connection.rollback().catch(() => {});
        const code = failureCode(error);
        await connection.query(`UPDATE ${HISTORY} SET state='failed',failure_code=? WHERE filename=? AND state='running'`, [code, migration.filename]).catch(() => {});
        throw new MigrationSafetyError(`${migration.filename} failed (${code}). Committed DDL may remain; further apply is blocked pending operator-reviewed recovery.`);
      }
    }
    return inspectMigrations(connection, migrations);
  });
}

export interface RepairOptions { filename: string; checksum: string; reason: string; verified: boolean; apply?: boolean }
export async function acknowledgeManualCompletion(connection: Connection, migrations: Migration[], options: RepairOptions): Promise<Inspection> {
  const check = (status: Inspection) => {
    const entry = status.entries.find((e) => e.filename === options.filename);
    if (!entry || !['running', 'failed'].includes(entry.state)) throw new MigrationSafetyError('Only an interrupted/failed migration can be manually completed.');
    if (options.checksum !== entry.checksum || !/^[a-f0-9]{64}$/.test(options.checksum)) throw new MigrationSafetyError('Recovery requires the exact current and recorded checksum.');
    if (options.reason.trim().length < 10 || options.reason.length > 512) throw new MigrationSafetyError('Recovery requires a nonsecret verification reason (10–512 characters).');
    const others = status.issues.filter((i) => !(i.kind === 'dirty' && i.filename === options.filename));
    if (others.length) throw new MigrationSafetyError(others.map((i) => i.message).join('\n'));
  };
  if (!options.apply) {
    const status = await inspectMigrations(connection, migrations);
    check(status);
    return status;
  }
  if (!options.verified) throw new MigrationSafetyError('Recovery requires --acknowledge-manual-verification after manually completing/verifying all file effects.');
  return withMigrationLock(connection, async () => {
    const status = await inspectMigrations(connection, migrations);
    check(status);
    await strictWrites(connection);
    await connection.query(`UPDATE ${HISTORY} SET state='applied', applied_at=NOW(6), repair_reason=?, repaired_by=CURRENT_USER(), repaired_at=NOW(6) WHERE filename=? AND checksum=? AND state IN ('running','failed')`, [options.reason.trim(), options.filename, options.checksum]);
    return inspectMigrations(connection, migrations);
  });
}

export function validateCycle(cycle: Cycle): void {
  if (!Number.isInteger(cycle.yearBegin) || cycle.yearBegin < 2000 || cycle.yearBegin > 2100 ||
      typeof cycle.lotteryOpen !== 'boolean' || typeof cycle.postLottery !== 'boolean') throw new MigrationSafetyError('Explicit valid year, lottery-open and post-lottery values are required.');
}

export async function initializeCycle(connection: Connection, migrations: Migration[], cycle: Cycle | undefined, options: { apply?: boolean } = {}): Promise<{ existing: Cycle | null; proposed?: Cycle }> {
  if (cycle) validateCycle(cycle);
  if (options.apply && !cycle) throw new MigrationSafetyError('Explicit cycle values are required for --apply.');
  const inspect = async () => {
    await requireCurrentMigrations(connection, migrations);
    const existing = await readCycle(connection);
    return { existing, proposed: cycle };
  };
  if (!options.apply) return inspect();
  return withMigrationLock(connection, async () => {
    const status = await inspect();
    if (status.existing) throw new MigrationSafetyError('Cycle settings already exist; initialization will not overwrite them.');
    await strictWrites(connection);
    await connection.query('INSERT INTO app_settings (id,year_begin,lottery_open,post_lottery,updated_at) VALUES (1,?,?,?,NOW())', [cycle!.yearBegin, cycle!.lotteryOpen ? 1 : 0, cycle!.postLottery ? 1 : 0]);
    return { existing: await readCycle(connection), proposed: cycle };
  });
}

export async function readCycle(db: Queryable): Promise<Cycle | null> {
  const result = await rows(db, 'SELECT year_begin,lottery_open,post_lottery FROM app_settings WHERE id=1');
  if (!result.length) return null;
  const row = result[0]!;
  if (![0, 1].includes(Number(row.lottery_open)) || ![0, 1].includes(Number(row.post_lottery))) throw new MigrationSafetyError('Stored cycle flags are invalid.');
  const cycle = { yearBegin: Number(row.year_begin), lotteryOpen: Number(row.lottery_open) === 1, postLottery: Number(row.post_lottery) === 1 };
  validateCycle(cycle);
  return cycle;
}
