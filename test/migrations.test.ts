import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMigrations, migrationLockName, validateCycle } from '../src/app/adapters/mysql/migrations/engine.js';
import { connectionOptions, parseOptions, runDatabaseCli } from '../src/app/adapters/mysql/migrations/cli.js';

const directories: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'ra-migration-unit-')); directories.push(dir); return dir; };
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true }); vi.restoreAllMocks(); });

describe('migration operator interface', () => {
  it('defaults to inspection and requires an unambiguous explicit apply', () => {
    expect(parseOptions([], 'migrate')).toEqual({ help: false, apply: false });
    expect(parseOptions(['--apply'], 'migrate').apply).toBe(true);
    for (const args of [['--apply=false'], ['--apply', '--apply'], ['--force'], ['production'], ['--checksum', 'abc']]) {
      expect(() => parseOptions(args, 'migrate')).toThrow('Invalid');
    }
  });
  it('requires all cycle values without choosing calendar defaults', () => {
    expect(parseOptions([], 'settings').cycle).toBeUndefined();
    for (const args of [['--apply'], ['--year', '2027'], ['--year=2027', '--lottery-open=yes', '--post-lottery=false']]) {
      expect(() => parseOptions(args, 'settings')).toThrow();
    }
    expect(parseOptions(['--year=2027', '--lottery-open=false', '--post-lottery=true'], 'settings'))
      .toMatchObject({ apply: false, cycle: { yearBegin: 2027, lotteryOpen: false, postLottery: true } });
    expect(() => validateCycle({ yearBegin: 1999, lotteryOpen: false, postLottery: false })).toThrow();
  });
  it('has no implicit root/database/password configuration', () => {
    expect(() => connectionOptions({})).toThrow('DB_HOST');
    const config = connectionOptions({ NODE_ENV: 'test', DB_TLS_MODE: 'disabled', DB_HOST: '127.0.0.1', DB_USER: 'test', DB_PASSWORD: ' test-secret ', DB_NAME: 'preview' });
    expect(config).toMatchObject({ port: 3306, database: 'preview', password: ' test-secret ', multipleStatements: true });
    expect(() => connectionOptions({ DB_HOST: 'mysql://user:secret@host', DB_USER: 'test', DB_PASSWORD: 'secret', DB_NAME: 'preview' })).toThrow('plain');
  });
  it('prints help without environment, filesystem discovery or a DB connection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await runDatabaseCli('migrate', ['--help'], {})).toBe(0);
    expect(await runDatabaseCli('settings', ['--help'], {})).toBe(0);
  });
  it('rejects invalid arguments before reporting any credential-bearing values', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runDatabaseCli('migrate', ['--password', 'DO_NOT_PRINT'], {})).toBe(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('DO_NOT_PRINT');
  });
});

describe('immutable migration inputs', () => {
  it('hashes complete SQL bytes without stripping quoted semicolons or comments', () => {
    const dir = directory();
    const sql = "SELECT 'a; -- b'; -- comment with ;\nSELECT 2;";
    writeFileSync(join(dir, '001_example.sql'), sql);
    const [migration] = loadMigrations(dir);
    expect(migration!.sql).toBe(sql);
    expect(migration!.checksum).toBe(createHash('sha256').update(sql).update('\0').digest('hex'));
  });
  it('rejects duplicate IDs, malformed names and symlink files', () => {
    const dir = directory();
    expect(() => loadMigrations(join(dir, 'missing'))).toThrow('release root');
    writeFileSync(join(dir, '001_a.sql'), 'SELECT 1;');
    writeFileSync(join(dir, '001_b.sql'), 'SELECT 2;');
    expect(() => loadMigrations(dir)).toThrow('duplicate');
    const other = directory();
    symlinkSync(join(dir, '001_a.sql'), join(other, '001_link.sql'));
    expect(() => loadMigrations(other)).toThrow('regular');
  });
  it('rejects invalid UTF-8 rather than hashing decoded replacement characters', () => {
    const dir = directory();
    writeFileSync(join(dir, '001_bad.sql'), Buffer.from([0xff, 0xfe, 0x00]));
    expect(() => loadMigrations(dir)).toThrow();
  });
  it('includes the reviewed catalog in the migration checksum', () => {
    const dir = directory();
    writeFileSync(join(dir, '002_survey_data.sql'), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow('companion');
    const manifest = { questions: [{ id: 1, brief: 'test', lottery: 0, inputType: 'text', sortOrder: 0 }] };
    writeFileSync(join(dir, '002_survey_data.json'), JSON.stringify(manifest));
    const first = loadMigrations(dir)[0]!.checksum;
    manifest.questions[0]!.brief = 'changed';
    writeFileSync(join(dir, '002_survey_data.json'), JSON.stringify(manifest));
    expect(loadMigrations(dir)[0]!.checksum).not.toBe(first);
  });
  it('uses bounded schema-specific lock names', () => {
    expect(migrationLockName('preview').length).toBeLessThanOrEqual(64);
    expect(migrationLockName('preview')).not.toBe(migrationLockName('production'));
  });
});
