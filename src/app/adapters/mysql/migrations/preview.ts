import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import type { Connection } from 'mysql2/promise';
import { rows, type Queryable } from './catalog.js';
import { applyMigrations, HISTORY, inspectMigrations, loadMigrations, migrationLockName, MigrationSafetyError, withMigrationLock, type Migration } from './engine.js';
import { PREVIEW_DATABASE, PREVIEW_HISTORY, previewCompletionIssue } from './previewState.js';

export const PREVIEW_TABLES = [
  'users', 'Parent', 'Child', 'ChildExtra', 'Current_Student', 'Declines', 'Extra',
  'ExtraTitles', 'MaxEnrollment', 'Note', 'ParentExtra', 'SiteSettings', 'user_cookies',
  'app_sessions', 'admin_users', 'admin_sessions', 'lottery_run', 'lottery_assignment',
  'app_settings', 'email_outbox', 'enrollment_document',
] as const;
export interface PreviewPlan { baseSql: string; unicodeSql: string; migrations: Migration[]; checksum: string }
export interface PreviewInspection {
  database: string; checksum: string; state: 'empty' | 'unrecognized' | 'running' | 'failed' | 'applied';
  tables: string[]; issues: string[];
}

export function previewChecksum(baseSql: string, migrations: Migration[], unicodeSql: string): string {
  return createHash('sha256').update('preview-bootstrap-v1\0').update(baseSql).update('\0')
    .update(JSON.stringify(migrations.map(({ filename, checksum }) => ({ filename, checksum }))))
    .update('\0').update(unicodeSql).digest('hex');
}

export function loadPreviewPlan(root: string): PreviewPlan {
  try {
    const directory = join(root, 'db/preview');
    if (!lstatSync(directory).isDirectory()) throw new Error('Invalid asset directory');
    const read = (name: string) => {
      const path = join(directory, name);
      if (!lstatSync(path).isFile()) throw new Error('Invalid asset');
      const sql = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
      if (!sql.trim()) throw new Error('Empty asset');
      return sql;
    };
    const baseSql = read('base.sql');
    const unicodeSql = read('utf8mb4.sql');
    const migrations = loadMigrations(join(root, 'db/migrations'));
    return { baseSql, migrations, unicodeSql, checksum: previewChecksum(baseSql, migrations, unicodeSql) };
  } catch {
    throw new MigrationSafetyError('Missing/invalid reviewed preview assets. Run from the trusted release root containing db/preview and db/migrations.');
  }
}

export function requirePreviewDatabase(database: string): void {
  if (database !== PREVIEW_DATABASE) throw new MigrationSafetyError('Preview initialization is restricted to DB_NAME=enrollment_preview; no target override is available.');
}

async function unicodeIssues(db: Queryable): Promise<string[]> {
  const tables = await rows(db, 'SELECT TABLE_NAME AS n, TABLE_COLLATION AS c, ENGINE AS e, TABLE_TYPE AS t FROM information_schema.tables WHERE table_schema=DATABASE()');
  const expected = new Set<string>([...PREVIEW_TABLES, HISTORY, PREVIEW_HISTORY]);
  const issues: string[] = [];
  if (tables.length !== expected.size || tables.some((t) => !expected.has(String(t.n)))) issues.push('Preview table inventory differs from the reviewed bootstrap.');
  if (tables.some((t) => t.c !== 'utf8mb4_unicode_ci' || t.e !== 'InnoDB' || t.t !== 'BASE TABLE')) issues.push('Preview tables must be InnoDB with utf8mb4_unicode_ci defaults.');
  const columns = await rows(db, `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns
    WHERE table_schema=DATABASE() AND CHARACTER_SET_NAME IS NOT NULL AND DATA_TYPE <> 'json'
    AND (CHARACTER_SET_NAME <> 'utf8mb4' OR COLLATION_NAME <> 'utf8mb4_unicode_ci')`);
  if (columns.length) issues.push('Preview text columns have not all reached utf8mb4_unicode_ci.');
  return issues;
}

/** Metadata and history only, including after synthetic families are added. */
export async function inspectPreview(db: Queryable, plan: PreviewPlan): Promise<PreviewInspection> {
  const selected = (await rows(db, 'SELECT DATABASE() AS name'))[0]?.name;
  requirePreviewDatabase(String(selected ?? ''));
  const database = String(selected);
  const issues: string[] = [];
  if (plan.checksum !== previewChecksum(plan.baseSql, plan.migrations, plan.unicodeSql)) issues.push('Preview plan checksum does not match its inputs.');
  const defaults = (await rows(db, 'SELECT DEFAULT_CHARACTER_SET_NAME AS c, DEFAULT_COLLATION_NAME AS collation_name FROM information_schema.schemata WHERE schema_name=DATABASE()'))[0];
  if (defaults?.c !== 'utf8mb4' || defaults.collation_name !== 'utf8mb4_unicode_ci') issues.push('Preview database default must be utf8mb4 / utf8mb4_unicode_ci; this tool will not alter it.');
  const objects = await rows(db, 'SELECT TABLE_NAME AS n FROM information_schema.tables WHERE table_schema=DATABASE()');
  const tables = objects.map((t) => String(t.n)).sort();
  const extras = await rows(db, `SELECT 'routine' AS kind FROM information_schema.routines WHERE routine_schema=DATABASE()
    UNION ALL SELECT 'event' FROM information_schema.events WHERE event_schema=DATABASE()
    UNION ALL SELECT 'trigger' FROM information_schema.triggers WHERE trigger_schema=DATABASE()`);
  if (extras.length) issues.push('Preview contains stored objects; not an empty fresh-schema target.');
  let state: PreviewInspection['state'] = tables.length ? 'unrecognized' : 'empty';
  if (tables.includes(PREVIEW_HISTORY)) {
    const completion = await previewCompletionIssue(db, database, migrationLockName(database));
    if (completion) issues.push(completion);
    const history = await rows(db, `SELECT id, checksum, state FROM ${PREVIEW_HISTORY}`);
    const record = history[0];
    if (history.length === 1 && Number(record?.id) === 1 && ['running', 'failed', 'applied'].includes(String(record?.state))) {
      state = String(record!.state) as PreviewInspection['state'];
      if (record!.checksum !== plan.checksum) issues.push('Preview bootstrap checksum drift; existing history will not be rewritten.');
      if (state === 'applied') {
        issues.push(...await unicodeIssues(db));
        const status = await inspectMigrations(db, plan.migrations);
        issues.push(...status.issues.map((issue) => issue.message));
        if (!status.historyExists || status.entries.some((e) => e.state !== 'applied')) issues.push('Preview additive migrations are incomplete.');
      }
    }
  } else if (tables.length) {
    issues.push('Preview is not empty; existing tables/views will not be adopted, dropped or reset.');
  }
  return { database, checksum: plan.checksum, state, tables, issues };
}

/** Fresh preview only: no reset/resume/production mode and no implicit cycle. */
export async function initializePreview(connection: Connection, plan: PreviewPlan, options: { apply?: boolean } = {}): Promise<PreviewInspection> {
  if (!options.apply) return inspectPreview(connection, plan);
  requirePreviewDatabase(String((await rows(connection, 'SELECT DATABASE() AS name'))[0]?.name ?? ''));
  return withMigrationLock(connection, async () => {
    const status = await inspectPreview(connection, plan);
    if (status.issues.length) throw new MigrationSafetyError(status.issues.join('\n'));
    if (status.state !== 'empty') throw new MigrationSafetyError('Preview is already initialized or nonempty; --apply never resets or replays it.');
    // This dedicated operator connection must durably record state even if the
    // server's session defaults are permissive. No global setting is changed.
    await connection.query('SET SESSION autocommit=1');
    await connection.query('SET SESSION foreign_key_checks=1');
    await connection.query("SET SESSION sql_mode=CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_ALL_TABLES')");
    await connection.query(`CREATE TABLE ${PREVIEW_HISTORY} (
      id TINYINT PRIMARY KEY, checksum CHAR(64) NOT NULL,
      state ENUM('running','applied','failed') NOT NULL, phase VARCHAR(32) NOT NULL,
      owner_nonce CHAR(36) NOT NULL, started_by VARCHAR(255) NOT NULL,
      started_at DATETIME(6) NOT NULL, completed_at DATETIME(6) NULL, failure_code VARCHAR(64) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    try {
      const nonce = randomUUID();
      await connection.query('SET @ra_preview_bootstrap_nonce=?', [nonce]);
      await connection.query(`INSERT INTO ${PREVIEW_HISTORY} (id,checksum,state,phase,owner_nonce,started_by,started_at)
        VALUES (1,?,'running','base',?,CURRENT_USER(),NOW(6))`, [plan.checksum, nonce]);
      await connection.query(plan.baseSql);
      await connection.query(`UPDATE ${PREVIEW_HISTORY} SET phase='migrations' WHERE id=1`);
      await applyMigrations(connection, plan.migrations, { apply: true });
      await connection.query(`UPDATE ${PREVIEW_HISTORY} SET phase='utf8mb4' WHERE id=1`);
      await connection.query(plan.unicodeSql);
      const problems = await unicodeIssues(connection);
      if (problems.length) throw new MigrationSafetyError(problems.join('\n'));
      await connection.query(`UPDATE ${PREVIEW_HISTORY} SET state='applied',phase='complete',completed_at=NOW(6) WHERE id=1`);
      return inspectPreview(connection, plan);
    } catch (error) {
      await connection.rollback().catch(() => {});
      const raw = String((error as { code?: string })?.code ?? 'PREVIEW_BOOTSTRAP_ERROR');
      const code = /^[A-Z0-9_]{1,64}$/.test(raw) ? raw : 'PREVIEW_BOOTSTRAP_ERROR';
      await connection.query(`UPDATE ${PREVIEW_HISTORY} SET state='failed',failure_code=? WHERE id=1`, [code]).catch(() => {});
      throw new MigrationSafetyError(`Preview bootstrap failed (${code}). Committed DDL may remain; no replay. Inspect under an operator-approved recovery plan.`);
    } finally {
      await connection.query('SET @ra_preview_bootstrap_nonce=NULL').catch(() => {});
    }
  });
}
