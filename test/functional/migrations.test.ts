import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import mysql, { type Connection } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { acknowledgeManualCompletion, applyMigrations, HISTORY, initializeCycle, inspectMigrations, loadMigrations,
  migrationLockName, readCycle, requireCurrentMigrations, type Migration } from '../../src/app/adapters/mysql/migrations/engine.js';
import { rows } from '../../src/app/adapters/mysql/migrations/catalog.js';
import { startTestMysql } from './harness.js';

const execute = promisify(execFile);
const migrations = loadMigrations(join(process.cwd(), 'db/migrations'));
const synthetic = (filename: string, sql: string): Migration => ({ filename, sql,
  checksum: createHash('sha256').update(sql).update('\0').digest('hex') });

describe('safe migrations on real disposable MySQL 8.4.11', () => {
  let server: Awaited<ReturnType<typeof startTestMysql>>;
  let db: Connection;
  let schema: string;
  let sequence = 0;
  const cliEnvironment = () => ({ ...process.env, NODE_ENV: 'production', DB_HOST: String(server.config.host),
    DB_PORT: String(server.config.port), DB_USER: 'root', DB_PASSWORD: String(server.config.password),
    DB_NAME: schema, PORT: '0', HOST: '127.0.0.1', DB_TLS_MODE: 'verify_identity', DB_TLS_CA_FILE: server.tlsCaFile });
  beforeAll(async () => { server = await startTestMysql({ migrate: false }); }, 180000);
  afterAll(async () => { await server?.stop(); });
  beforeEach(async () => {
    schema = `ra_case_${++sequence}`;
    await server.pool.query(`CREATE DATABASE \`${schema}\``);
    db = await mysql.createConnection({ ...server.config, database: schema });
    await db.query(readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8'));
  });
  afterEach(async () => {
    await db?.end().catch(() => {});
    if (server && schema) await server.pool.query(`DROP DATABASE \`${schema}\``);
  });

  it('inspection creates no ledger, columns, options or data', async () => {
    await db.query("SET SESSION sql_mode=''");
    const before = await rows(db, 'SELECT * FROM Extra ORDER BY Extra_ID');
    const status = await applyMigrations(db, migrations);
    expect(status.issues).toEqual([]);
    expect(status.historyExists).toBe(false);
    expect(status.entries.every((e) => e.state === 'pending')).toBe(true);
    expect(await rows(db, 'SELECT * FROM Extra ORDER BY Extra_ID')).toEqual(before);
    expect(await rows(db, 'SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [HISTORY])).toHaveLength(0);
    expect(await rows(db, "SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name='pw_hash'")).toHaveLength(0);
    expect((await rows(db, 'SELECT @@SESSION.sql_mode AS mode'))[0]!.mode).toBe('');
  });

  it('actual CLIs stay read-only until --apply and initialize settings separately', async () => {
    const invoke = (file: string, args: string[] = []) => execute(process.execPath,
      ['--import', 'tsx', file, ...args], { cwd: process.cwd(), timeout: 10000, env: cliEnvironment() });
    const report = await invoke('src/app/adapters/mysql/migrate.ts');
    expect(report.stdout).toContain('READ ONLY');
    expect(report.stdout).toContain('pending');
    expect((await inspectMigrations(db, migrations)).historyExists).toBe(false);
    await invoke('src/app/adapters/mysql/migrate.ts', ['--apply']);
    expect(await readCycle(db)).toBeNull();
    const cycle = await invoke('src/app/cli/initSettings.ts');
    expect(cycle.stdout).toContain('READ ONLY');
    expect(await readCycle(db)).toBeNull();
    await invoke('src/app/cli/initSettings.ts', ['--year=2027', '--lottery-open=false', '--post-lottery=true', '--apply']);
    expect(await readCycle(db)).toEqual({ yearBegin: 2027, lotteryOpen: false, postLottery: true });
  });

  it('preserves questions, options, identities, active state and saved answers; repeat apply leaves staff changes alone', async () => {
    await db.query("UPDATE ExtraTitles SET Question='Existing staff wording', Grade='-0-' WHERE Title_ID=6");
    await db.query("UPDATE Extra SET Value='Custom morning label' WHERE Extra_ID=1");
    await db.query("INSERT INTO Extra (Title_ID,Value) VALUES (17,'0')");
    await db.query("INSERT INTO users (id,username,encpass,status) VALUES (100,'fixturefamily','fixture','CONFIRMED')");
    await db.query("INSERT INTO Parent (Parent_ID,First_Name,Last_Name,Email) VALUES (100,'Fixture','Family','fixture@example.com')");
    await db.query("INSERT INTO Child (Child_ID,Parent_ID,First_Name,Last_Name,Gender,DOB,Grade_nxt_yr,Reg_Date,parent_notes) VALUES (101,100,'Fixture','Child','M','2020-05-01','3',CURDATE(),'')");
    await db.query("INSERT INTO ParentExtra (Parent_ID,Title_ID,Answer) VALUES (100,20,'Existing synthetic answer')");
    await db.query('INSERT INTO ChildExtra (Child_ID,Extra_ID) VALUES (101,1)');
    const questions = await rows(db, 'SELECT Title_ID,Question,Grade,Brief,Lottery_question FROM ExtraTitles ORDER BY Title_ID');
    const options = await rows(db, 'SELECT * FROM Extra ORDER BY Extra_ID');
    const answers = await rows(db, 'SELECT * FROM ParentExtra');
    const childAnswers = await rows(db, 'SELECT * FROM ChildExtra');
    await applyMigrations(db, migrations.slice(0, 1), { apply: true });
    await db.query('UPDATE ExtraTitles SET active=0 WHERE Title_ID=6');
    const report = await applyMigrations(db, migrations, { apply: true });
    expect(report.entries.every((e) => e.state === 'applied')).toBe(true);
    expect(report.issues).toEqual([]);
    expect(await rows(db, 'SELECT Title_ID,Question,Grade,Brief,Lottery_question FROM ExtraTitles ORDER BY Title_ID')).toEqual(questions);
    for (const option of options) expect(await rows(db, 'SELECT * FROM Extra WHERE Extra_ID=?', [option.Extra_ID])).toEqual([option]);
    expect(await rows(db, 'SELECT * FROM ParentExtra')).toEqual(answers);
    expect(await rows(db, 'SELECT * FROM ChildExtra')).toEqual(childAnswers);
    expect((await rows(db, 'SELECT active FROM ExtraTitles WHERE Title_ID=6'))[0]!.active).toBe(0);
    expect(await rows(db, 'SELECT * FROM Extra WHERE Title_ID=17')).toHaveLength(5);
    expect(await readCycle(db)).toBeNull();
    await db.query("UPDATE ExtraTitles SET input_type='textarea',sort_order=999,Question='Later staff edit' WHERE Title_ID=11");
    await db.query("INSERT INTO Extra (Title_ID,Value) VALUES (11,'Later staff option')");
    const after = await rows(db, 'SELECT * FROM ExtraTitles ORDER BY Title_ID');
    const afterOptions = await rows(db, 'SELECT * FROM Extra ORDER BY Extra_ID');
    const history = await rows(db, `SELECT * FROM ${HISTORY} ORDER BY filename`);
    await applyMigrations(db, migrations, { apply: true });
    expect(await rows(db, 'SELECT * FROM ExtraTitles ORDER BY Title_ID')).toEqual(after);
    expect(await rows(db, 'SELECT * FROM Extra ORDER BY Extra_ID')).toEqual(afterOptions);
    expect(await rows(db, `SELECT * FROM ${HISTORY} ORDER BY filename`)).toEqual(history);
  });

  it.each(['mapping', 'options', 'unknown-title', 'metadata', 'wide-column', 'nontransactional-reference'])('rejects %s conflicts before migration writes', async (kind) => {
    if (kind === 'mapping') await db.query("UPDATE ExtraTitles SET Brief='unexpected' WHERE Title_ID=11");
    if (kind === 'options') await db.query("INSERT INTO Extra (Title_ID,Value) VALUES (11,'Unreviewed choice')");
    if (kind === 'unknown-title') await db.query("INSERT INTO ExtraTitles (Title_ID,Question,Lottery_question,Brief) VALUES (99,'Custom',1,'custom')");
    if (kind === 'nontransactional-reference') await db.query('ALTER TABLE Extra ENGINE=MEMORY');
    if (kind === 'wide-column') {
      await db.query('ALTER TABLE Extra MODIFY Value VARCHAR(512) COLLATE utf8_unicode_ci DEFAULT NULL');
      await db.query('UPDATE Extra SET Value=? WHERE Extra_ID=1', ['x'.repeat(300)]);
    }
    if (kind === 'metadata') {
      await applyMigrations(db, migrations.slice(0, 1), { apply: true });
      await db.query("UPDATE ExtraTitles SET input_type='date',sort_order=77 WHERE Title_ID=11");
    }
    const before = await rows(db, 'SELECT * FROM ExtraTitles ORDER BY Title_ID');
    const status = await inspectMigrations(db, migrations);
    expect(status.issues.some((i) => i.kind === 'catalog')).toBe(true);
    await expect(applyMigrations(db, migrations, { apply: true })).rejects.toThrow();
    expect(await rows(db, 'SELECT * FROM ExtraTitles ORDER BY Title_ID')).toEqual(before);
    if (kind === 'wide-column') expect(String((await rows(db, 'SELECT Value FROM Extra WHERE Extra_ID=1'))[0]!.Value)).toHaveLength(300);
    if (kind !== 'metadata') expect((await inspectMigrations(db, migrations)).historyExists).toBe(false);
  });

  it('refuses untracked hand-applied new schema instead of quietly baselining', async () => {
    await db.query('ALTER TABLE users ADD COLUMN pw_hash VARCHAR(255) NULL');
    expect((await inspectMigrations(db, migrations)).issues.some((i) => i.kind === 'untracked')).toBe(true);
    await expect(applyMigrations(db, migrations, { apply: true })).rejects.toThrow('Untracked');
  });

  it('blocks checksum edits and missing applied files without executing later SQL', async () => {
    await applyMigrations(db, migrations, { apply: true });
    const changed = migrations.map((m, i) => i === 1 ? { ...m, checksum: '0'.repeat(64) } : m);
    const later = synthetic('009_probe.sql', 'CREATE TABLE should_not_exist (id INT);');
    await expect(applyMigrations(db, [...changed, later], { apply: true })).rejects.toThrow('Checksum');
    await expect(applyMigrations(db, migrations.slice(0, -1), { apply: true })).rejects.toThrow('missing');
    expect(await rows(db, "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='should_not_exist'")).toHaveLength(0);
  });

  it('serializes competing operators and shares the lock with initialization', async () => {
    const other = await mysql.createConnection({ ...server.config, database: schema });
    const name = migrationLockName(schema);
    try {
      await other.query('SELECT GET_LOCK(?,0)', [name]);
      await expect(applyMigrations(db, migrations, { apply: true })).rejects.toThrow('holds');
      expect((await inspectMigrations(db, migrations)).historyExists).toBe(false);
      await other.query('SELECT RELEASE_LOCK(?)', [name]);
      await applyMigrations(db, migrations, { apply: true });
      await other.query('SELECT GET_LOCK(?,0)', [name]);
      await expect(initializeCycle(db, migrations, { yearBegin: 2027, lotteryOpen: false, postLottery: false }, { apply: true })).rejects.toThrow('holds');
      expect(await readCycle(db)).toBeNull();
    } finally { await other.end(); }
  });

  it('retains partial committed DDL, blocks replay, and audits explicit manual completion', async () => {
    const file = synthetic('001_failure.sql', 'CREATE TABLE partial_probe (v INT); INSERT INTO missing_probe VALUES (7);');
    await expect(applyMigrations(db, [file], { apply: true })).rejects.toThrow('Committed DDL may remain');
    expect(await rows(db, "SHOW TABLES LIKE 'partial_probe'")).toHaveLength(1);
    expect((await inspectMigrations(db, [file])).entries[0]!.state).toBe('failed');
    await expect(applyMigrations(db, [file], { apply: true })).rejects.toThrow('recovery');
    const options = { filename: file.filename, checksum: file.checksum, reason: 'Manually completed and verified both effects', verified: false };
    await db.query("SET SESSION sql_mode=''");
    await acknowledgeManualCompletion(db, [file], options); // Plan only, still failed.
    expect((await rows(db, 'SELECT @@SESSION.sql_mode AS mode'))[0]!.mode).toBe('');
    expect((await inspectMigrations(db, [file])).entries[0]!.state).toBe('failed');
    await expect(acknowledgeManualCompletion(db, [file], { ...options, apply: true })).rejects.toThrow('acknowledge');
    await expect(acknowledgeManualCompletion(db, [file], { ...options, checksum: '0'.repeat(64) })).rejects.toThrow('checksum');
    // Explicit simulation of the operator's separately approved manual SQL repair.
    await db.query('CREATE TABLE missing_probe (v INT); INSERT INTO missing_probe VALUES (7);');
    await acknowledgeManualCompletion(db, [file], { ...options, verified: true, apply: true });
    const record = (await rows(db, `SELECT * FROM ${HISTORY}`))[0]!;
    expect(record.state).toBe('applied');
    expect(record.repair_reason).toBe(options.reason);
    expect(record.repaired_by).toBeTruthy();
    expect(record.failure_code).toBe('ER_NO_SUCH_TABLE');
    await applyMigrations(db, [file], { apply: true });
    expect(await rows(db, 'SELECT * FROM missing_probe')).toEqual([{ v: 7 }]);
  });

  it('leaves interrupted execution blocked and releases the session lock after connection loss', async () => {
    const file = synthetic('001_interrupted.sql', 'DO SLEEP(30);');
    const worker = await mysql.createConnection({ ...server.config, database: schema });
    const id = Number((await rows(worker, 'SELECT CONNECTION_ID() AS id'))[0]!.id);
    const outcome = applyMigrations(worker, [file], { apply: true }).then(() => null, (error: Error) => error);
    try {
      let running = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const found = await rows(db, 'SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [HISTORY]);
        if (found.length && (await rows(db, `SELECT state FROM ${HISTORY}`))[0]?.state === 'running') { running = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(running).toBe(true);
      await db.query(`KILL CONNECTION ${id}`); // Only this test's own worker in its owned container.
      expect(await outcome).toBeInstanceOf(Error);
      expect((await inspectMigrations(db, [file])).entries[0]!.state).toBe('running');
      await expect(applyMigrations(db, [file], { apply: true })).rejects.toThrow('recovery');
    } finally { worker.destroy(); }
  });

  it('does not split SQL strings/comments on semicolons or double hyphens', async () => {
    const file = synthetic('001_quoted.sql', "CREATE TABLE quoted_probe (v VARCHAR(255)); -- comment ;\nINSERT INTO quoted_probe VALUES ('a; -- b');");
    await applyMigrations(db, [file], { apply: true });
    expect(await rows(db, 'SELECT v FROM quoted_probe')).toEqual([{ v: 'a; -- b' }]);
  });

  it('uses strict write-session mode instead of silently truncating on a permissive server session', async () => {
    await db.query("SET SESSION sql_mode=''");
    const file = synthetic('001_strict.sql', "CREATE TABLE strict_probe (v VARCHAR(3)); INSERT INTO strict_probe VALUES ('too long');");
    await expect(applyMigrations(db, [file], { apply: true })).rejects.toThrow('ER_DATA_TOO_LONG');
    expect(await rows(db, 'SELECT * FROM strict_probe')).toHaveLength(0);
    expect((await inspectMigrations(db, [file])).entries[0]!.state).toBe('failed');
  });

  it('never initializes implicitly and refuses to overwrite an existing cycle', async () => {
    await expect(initializeCycle(db, migrations, undefined)).rejects.toThrow('incomplete');
    await applyMigrations(db, migrations, { apply: true });
    const cycle = { yearBegin: 2027, lotteryOpen: false, postLottery: true };
    expect(await initializeCycle(db, migrations, cycle)).toEqual({ existing: null, proposed: cycle });
    expect(await readCycle(db)).toBeNull();
    await expect(initializeCycle(db, migrations, undefined, { apply: true })).rejects.toThrow('Explicit');
    await initializeCycle(db, migrations, cycle, { apply: true });
    await expect(initializeCycle(db, migrations, { ...cycle, yearBegin: 2028 }, { apply: true })).rejects.toThrow('overwrite');
    expect(await readCycle(db)).toEqual(cycle);
    await requireCurrentMigrations(db, migrations);
  });

  it('production entrypoint refuses a missing cycle before worker/HTTP startup', async () => {
    await applyMigrations(db, migrations, { apply: true });
    const result = await execute(process.execPath, ['--import', 'tsx', 'src/app/http/main.ts'], {
      cwd: process.cwd(), timeout: 10000,
      env: cliEnvironment(),
    }).then(() => null, (error: { stderr?: string; stdout?: string }) => error);
    expect(result?.stderr).toContain('cycle is uninitialized');
    expect(result?.stdout).not.toContain('API listening');
    expect(await rows(db, 'SELECT * FROM app_settings')).toHaveLength(0);
  });

  it('production entrypoint refuses unresolved migration history without repairing it', async () => {
    await applyMigrations(db, migrations, { apply: true });
    await initializeCycle(db, migrations, { yearBegin: 2027, lotteryOpen: false, postLottery: false }, { apply: true });
    await db.query(`UPDATE ${HISTORY} SET state='failed' WHERE filename='008_documents.sql'`);
    const result = await execute(process.execPath, ['--import', 'tsx', 'src/app/http/main.ts'], {
      cwd: process.cwd(), timeout: 10000, env: cliEnvironment(),
    }).then(() => null, (error: { stderr?: string; stdout?: string }) => error);
    expect(result?.stderr).toContain('Operator-reviewed recovery');
    expect(result?.stdout).not.toContain('API listening');
    expect((await rows(db, `SELECT state FROM ${HISTORY} WHERE filename='008_documents.sql'`))[0]!.state).toBe('failed');
  });
});
