import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import mysql, { type Connection } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rows } from '../../src/app/adapters/mysql/migrations/catalog.js';
import { applyMigrations, HISTORY, initializeCycle, inspectMigrations, migrationLockName, readCycle, requireCurrentMigrations } from '../../src/app/adapters/mysql/migrations/engine.js';
import { initializePreview, inspectPreview, loadPreviewPlan, PREVIEW_TABLES, previewChecksum } from '../../src/app/adapters/mysql/migrations/preview.js';
import { PREVIEW_DATABASE, PREVIEW_HISTORY } from '../../src/app/adapters/mysql/migrations/previewState.js';
import { createMysqlDatabase, createPool } from '../../src/app/adapters/mysql/index.js';
import { databaseConnectionOptions } from '../../src/app/adapters/mysql/connectionOptions.js';
import { startTestMysql } from './harness.js';

const execute = promisify(execFile);
const plan = loadPreviewPlan(process.cwd());

describe('guarded full-Unicode preview bootstrap on owned MySQL 8.4.11', () => {
  let server: Awaited<ReturnType<typeof startTestMysql>>;
  let connection: Connection;
  const migrationPassword = randomUUID();
  const appPassword = randomUUID();
  const config = () => ({ ...server.config, database: PREVIEW_DATABASE, user: 'preview_migrator', password: migrationPassword });
  const environment = () => ({ ...process.env, NODE_ENV: 'production', DB_HOST: String(server.config.host),
    DB_PORT: String(server.config.port), DB_NAME: PREVIEW_DATABASE, DB_USER: 'preview_migrator', DB_PASSWORD: migrationPassword,
    DB_TLS_MODE: 'verify_identity', DB_TLS_CA_FILE: server.tlsCaFile, HOST: '127.0.0.1', PORT: '0' });
  const invoke = (file: string, args: string[] = []) => execute(process.execPath, ['--import', 'tsx', file, ...args], {
    cwd: process.cwd(), timeout: 15000, env: environment(),
  });
  beforeAll(async () => {
    server = await startTestMysql({ migrate: false, base: false });
    await server.pool.query("CREATE USER 'preview_migrator'@'%' IDENTIFIED BY ? REQUIRE SSL", [migrationPassword]);
    await server.pool.query("GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON `enrollment\\_preview`.* TO 'preview_migrator'@'%'");
    await server.pool.query("CREATE USER 'preview_app'@'%' IDENTIFIED BY ? REQUIRE SSL", [appPassword]);
    await server.pool.query("GRANT SELECT,INSERT,UPDATE,DELETE ON `enrollment\\_preview`.* TO 'preview_app'@'%'");
  }, 180000);
  afterAll(async () => { await server?.stop(); });
  beforeEach(async () => {
    await server.pool.query(`CREATE DATABASE ${PREVIEW_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    connection = await mysql.createConnection(config());
  });
  afterEach(async () => {
    await connection?.end().catch(() => {});
    if (server) {
      await server.pool.query(`DROP DATABASE ${PREVIEW_DATABASE}`); // This suite's fixed schema inside its uniquely owned container only.
      await server.pool.query("GRANT REFERENCES ON `enrollment\\_preview`.* TO 'preview_migrator'@'%'");
    }
  });

  it('inspects empty schema without creating state or changing session mode, including the actual CLI', async () => {
    await connection.query("SET SESSION sql_mode=''");
    await connection.query('SET SESSION autocommit=0');
    await connection.query('SET SESSION foreign_key_checks=0');
    expect(await initializePreview(connection, plan)).toMatchObject({ state: 'empty', tables: [], issues: [] });
    expect((await rows(connection, 'SELECT @@SESSION.sql_mode AS mode'))[0]!.mode).toBe('');
    expect((await rows(connection, 'SELECT @@SESSION.autocommit AS a, @@SESSION.foreign_key_checks AS f'))[0]).toEqual({ a: 0, f: 0 });
    const result = await invoke('src/app/cli/initPreview.ts');
    expect(result.stdout).toContain('READ ONLY');
    expect(result.stdout).toContain('"state": "empty"');
    expect(await rows(connection, 'SHOW TABLES')).toEqual([]);
  });

  it('applies with restricted grants, original history and full Unicode; initializes no cycle/families/accounts/jobs', async () => {
    const result = await invoke('src/app/cli/initPreview.ts', ['--apply']);
    expect(result.stdout).toContain('"state": "applied"');
    const status = await inspectPreview(connection, plan);
    expect(status.issues).toEqual([]);
    expect(status.tables).toHaveLength(PREVIEW_TABLES.length + 2);
    const history = await rows(connection, `SELECT filename,checksum,state FROM ${HISTORY} ORDER BY filename`);
    expect(history).toEqual(plan.migrations.map(({ filename, checksum }) => ({ filename, checksum, state: 'applied' })));
    await requireCurrentMigrations(connection, plan.migrations);
    expect(await readCycle(connection)).toBeNull();
    await expect(invoke('src/app/http/main.ts')).rejects.toMatchObject({ stderr: expect.stringContaining('cycle is uninitialized') });
    for (const table of ['users', 'Parent', 'Child', 'Current_Student', 'admin_users', 'email_outbox', 'SiteSettings']) {
      expect((await rows(connection, `SELECT COUNT(*) AS n FROM ${table}`))[0]!.n).toBe(0);
    }
    const storage = await rows(connection, 'SELECT TABLE_COLLATION AS c, ENGINE AS e FROM information_schema.tables WHERE table_schema=DATABASE()');
    expect(storage.every((t) => t.c === 'utf8mb4_unicode_ci' && t.e === 'InnoDB')).toBe(true);
    const text = await rows(connection, "SELECT CHARACTER_SET_NAME AS c, COLLATION_NAME AS collation_name FROM information_schema.columns WHERE table_schema=DATABASE() AND CHARACTER_SET_NAME IS NOT NULL AND DATA_TYPE <> 'json'");
    expect(text.length).toBeGreaterThan(30);
    expect(text.every((c) => c.c === 'utf8mb4' && c.collation_name === 'utf8mb4_unicode_ci')).toBe(true);
    expect(await rows(connection, "SELECT CONSTRAINT_NAME FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='user_cookies'")).toHaveLength(1);
    expect(await rows(connection, "SELECT DATA_TYPE AS t FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='Note' AND column_name='Note'")).toEqual([{ t: 'blob' }]);
    await expect(connection.query('DROP TABLE Declines')).rejects.toMatchObject({ code: 'ER_TABLEACCESS_DENIED_ERROR' });
    await expect(connection.query('USE enrollment')).rejects.toMatchObject({ code: 'ER_DBACCESS_DENIED_ERROR' });
    expect((await rows(connection, 'SELECT IS_FREE_LOCK(?) AS free', [migrationLockName(PREVIEW_DATABASE)]))[0]!.free).toBe(1);
  });

  it('round-trips supplementary characters through runtime adapters and preserves later data on repeat refusal', async () => {
    await connection.query('SET SESSION autocommit=0');
    await connection.query('SET SESSION foreign_key_checks=0');
    await initializePreview(connection, plan, { apply: true });
    expect((await rows(connection, 'SELECT @@SESSION.autocommit AS a, @@SESSION.foreign_key_checks AS f'))[0]).toEqual({ a: 1, f: 1 });
    const pool = createPool(databaseConnectionOptions({ ...environment(), DB_USER: 'preview_app', DB_PASSWORD: appPassword }));
    try {
      const database = createMysqlDatabase(pool);
      const user = await database.repos.users.create({ username: 'preview😀𐐷', encpass: 'synthetic-only', status: 'CONFIRMED', pwHash: null, pwAlgo: null });
      const unicode = 'Māori 中文 𐐷 😀';
      await pool.query('INSERT INTO ParentExtra (Parent_ID,Title_ID,Answer) VALUES (?,?,?)', [user, 20, unicode]);
      expect((await database.repos.users.findById(user))!.username).toBe('preview😀𐐷');
      expect((await rows(pool, 'SELECT Answer FROM ParentExtra WHERE Parent_ID=?', [user]))[0]!.Answer).toBe(unicode);
      await pool.query('UPDATE ExtraTitles SET Question=? WHERE Title_ID=11', [unicode]);
      await pool.query('INSERT INTO Extra (Title_ID,Value) VALUES (11,?)', [unicode]);
      expect(await inspectPreview(connection, plan)).toMatchObject({ state: 'applied', issues: [] });
      const readOnly = await invoke('src/app/cli/initPreview.ts');
      expect(readOnly.stdout).toContain('"state": "applied"');
      expect(readOnly.stdout).not.toContain(unicode);
      const before = await rows(connection, `SELECT * FROM ${PREVIEW_HISTORY}`);
      await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('never resets');
      expect(await rows(connection, `SELECT * FROM ${PREVIEW_HISTORY}`)).toEqual(before);
      expect((await database.repos.users.findById(user))!.username).toBe('preview😀𐐷');
      expect((await rows(pool, 'SELECT Question FROM ExtraTitles WHERE Title_ID=11'))[0]!.Question).toBe(unicode);
      await expect(pool.query('ALTER TABLE Extra ADD COLUMN not_allowed INT')).rejects.toThrow();
      await expect(pool.query('USE enrollment')).rejects.toMatchObject({ code: 'ER_DBACCESS_DENIED_ERROR' });
    } finally { await pool.end(); }
  });

  it('refuses production names in the engine and CLI before any history/table write', async () => {
    const other = await mysql.createConnection(server.config);
    try {
      await expect(initializePreview(other, plan, { apply: true })).rejects.toThrow('restricted');
      expect(await rows(other, 'SHOW TABLES')).toEqual([]);
      await expect(execute(process.execPath, ['--import', 'tsx', 'src/app/cli/initPreview.ts', '--apply'], {
        timeout: 10000, env: { ...environment(), DB_NAME: 'enrollment', DB_HOST: 'unreachable.invalid' },
      })).rejects.toMatchObject({ stderr: expect.stringContaining('restricted to DB_NAME') });
    } finally { await other.end(); }
  });

  it('refuses populated tables and views without adopting or resetting them', async () => {
    await connection.query('CREATE TABLE unrelated_probe (value INT); INSERT INTO unrelated_probe VALUES (7)');
    expect((await inspectPreview(connection, plan)).issues.join(' ')).toContain('not empty');
    await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('not empty');
    expect(await rows(connection, 'SELECT * FROM unrelated_probe')).toEqual([{ value: 7 }]);
    expect(await rows(connection, `SHOW TABLES LIKE '${PREVIEW_HISTORY}'`)).toEqual([]);
  });

  it('refuses a preexisting view even if no base tables exist', async () => {
    await server.pool.query(`CREATE VIEW ${PREVIEW_DATABASE}.unrelated_view AS SELECT 1 AS n`);
    await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('not empty');
    expect((await rows(connection, "SELECT TABLE_TYPE AS t FROM information_schema.tables WHERE table_schema=DATABASE()"))[0]!.t).toBe('VIEW');
  });

  it('refuses visible stored routines even if there are no tables', async () => {
    await server.pool.query(`CREATE PROCEDURE ${PREVIEW_DATABASE}.routine_probe() SELECT 1`);
    const owner = await mysql.createConnection({ ...server.config, database: PREVIEW_DATABASE });
    try {
      await expect(initializePreview(owner, plan, { apply: true })).rejects.toThrow('stored objects');
      expect(await rows(owner, 'SHOW TABLES')).toEqual([]);
    } finally { await owner.end(); }
  });

  it('refuses wrong database defaults and plan checksum corruption before creating bootstrap history', async () => {
    await server.pool.query(`ALTER DATABASE ${PREVIEW_DATABASE} CHARACTER SET latin1 COLLATE latin1_swedish_ci`);
    await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('database default');
    expect(await rows(connection, 'SHOW TABLES')).toEqual([]);
    await server.pool.query(`ALTER DATABASE ${PREVIEW_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('database default');
    expect(await rows(connection, 'SHOW TABLES')).toEqual([]);
    await server.pool.query(`ALTER DATABASE ${PREVIEW_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await expect(initializePreview(connection, { ...plan, checksum: '0'.repeat(64) }, { apply: true })).rejects.toThrow('checksum');
    expect(await rows(connection, 'SHOW TABLES')).toEqual([]);
  });

  it('serializes competing operators before writes', async () => {
    const blocker = await mysql.createConnection(config());
    try {
      await blocker.query('SELECT GET_LOCK(?,0)', [migrationLockName(PREVIEW_DATABASE)]);
      await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('holds the schema lock');
      expect(await rows(connection, 'SHOW TABLES')).toEqual([]);
    } finally { await blocker.end(); }
  });

  it('requires REFERENCES for the retained foreign key, records partial failure and never replays it', async () => {
    await server.pool.query("REVOKE REFERENCES ON `enrollment\\_preview`.* FROM 'preview_migrator'@'%'");
    await connection.end(); connection = await mysql.createConnection(config());
    await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('ER_TABLEACCESS_DENIED_ERROR');
    expect((await rows(connection, `SELECT state,phase FROM ${PREVIEW_HISTORY}`))[0]).toEqual({ state: 'failed', phase: 'base' });
    await expect(initializePreview(connection, plan, { apply: true })).rejects.toThrow('no automatic replay');
    await expect(applyMigrations(connection, plan.migrations, { apply: true })).rejects.toThrow('Preview bootstrap');
  });

  it('blocks API, normal migration CLI and cycle initialization after failure AFTER additive migration completion', async () => {
    const unicodeSql = plan.unicodeSql + '\nALTER TABLE missing_preview_probe ADD COLUMN n INT;';
    const broken = { ...plan, unicodeSql, checksum: previewChecksum(plan.baseSql, plan.migrations, unicodeSql) };
    await expect(initializePreview(connection, broken, { apply: true })).rejects.toThrow('Committed DDL may remain');
    expect((await rows(connection, `SELECT state,phase FROM ${PREVIEW_HISTORY}`))[0]).toEqual({ state: 'failed', phase: 'utf8mb4' });
    expect((await rows(connection, `SELECT state FROM ${HISTORY}`)).every((row) => row.state === 'applied')).toBe(true);
    await expect(requireCurrentMigrations(connection, plan.migrations)).rejects.toThrow('Preview bootstrap');
    await expect(initializeCycle(connection, plan.migrations, { yearBegin: 2027, lotteryOpen: false, postLottery: false }, { apply: true })).rejects.toThrow('Preview bootstrap');
    await expect(invoke('src/app/adapters/mysql/migrate.ts', ['--apply'])).rejects.toMatchObject({ stderr: expect.stringContaining('Preview bootstrap') });
    await expect(invoke('src/app/http/main.ts')).rejects.toMatchObject({ stderr: expect.stringContaining('Preview bootstrap') });
    expect(await readCycle(connection)).toBeNull();
  });

  it('blocks reconnect/replay after connection loss and releases the whole bootstrap lock', async () => {
    const baseSql = plan.baseSql + '\nDO SLEEP(30);';
    const slow = { ...plan, baseSql, checksum: previewChecksum(baseSql, plan.migrations, plan.unicodeSql) };
    const worker = await mysql.createConnection(config());
    const id = Number((await rows(worker, 'SELECT CONNECTION_ID() AS id'))[0]!.id);
    const outcome = initializePreview(worker, slow, { apply: true }).then(() => null, (error: Error) => error);
    try {
      let found = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        const tables = await rows(connection, 'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [PREVIEW_HISTORY]);
        if (tables.length && (await rows(connection, `SELECT state FROM ${PREVIEW_HISTORY}`))[0]?.state === 'running') { found = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(found).toBe(true);
      expect((await inspectMigrations(connection, plan.migrations)).issues.some((issue) => issue.message.includes('Preview bootstrap'))).toBe(true);
      await server.pool.query(`KILL CONNECTION ${id}`); // Only this test's own worker.
      expect(await outcome).toBeInstanceOf(Error);
      expect((await rows(connection, `SELECT state FROM ${PREVIEW_HISTORY}`))[0]!.state).toBe('running');
      // KILL acknowledges before all server-side DDL/thread cleanup necessarily
      // finishes. Wait for this owned worker's advisory lock to actually release.
      let free = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        free = Number((await rows(connection, 'SELECT IS_FREE_LOCK(?) AS free', [migrationLockName(PREVIEW_DATABASE)]))[0]!.free) === 1;
        if (free) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(free).toBe(true);
      await expect(initializePreview(connection, slow, { apply: true })).rejects.toThrow('no automatic replay');
      expect((await rows(connection, 'SELECT IS_FREE_LOCK(?) AS free', [migrationLockName(PREVIEW_DATABASE)]))[0]!.free).toBe(1);
    } finally { worker.destroy(); }
  });

  it('detects changed bootstrap assets and post-completion charset drift without rewriting history', async () => {
    await initializePreview(connection, plan, { apply: true });
    const unicodeSql = plan.unicodeSql + '\n-- changed asset';
    const changed = { ...plan, unicodeSql, checksum: previewChecksum(plan.baseSql, plan.migrations, unicodeSql) };
    expect((await inspectPreview(connection, changed)).issues.join(' ')).toContain('checksum drift');
    const before = await rows(connection, `SELECT * FROM ${PREVIEW_HISTORY}`);
    await connection.query('ALTER TABLE ParentExtra CONVERT TO CHARACTER SET utf8 COLLATE utf8_unicode_ci');
    expect((await inspectPreview(connection, plan)).issues.join(' ')).toContain('utf8mb4_unicode_ci');
    expect(await rows(connection, `SELECT * FROM ${PREVIEW_HISTORY}`)).toEqual(before);
  });
});
