import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMigrations } from '../src/app/adapters/mysql/migrations/engine.js';
import { loadPreviewPlan, PREVIEW_TABLES, previewChecksum, requirePreviewDatabase } from '../src/app/adapters/mysql/migrations/preview.js';
import { parsePreviewOptions, runPreviewCli } from '../src/app/adapters/mysql/migrations/previewCli.js';

const root = process.cwd();
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('preview-only operator interface', () => {
  it('defaults to inspection and offers no force/reset/resume/target/secret flags', () => {
    expect(parsePreviewOptions([])).toEqual({ help: false, apply: false });
    expect(parsePreviewOptions(['--apply']).apply).toBe(true);
    for (const args of [['--apply=false'], ['--apply', '--apply'], ['--help', '--help'], ['--force'], ['--resume'], ['--reset'], ['--database=enrollment'], ['enrollment']]) {
      expect(() => parsePreviewOptions(args)).toThrow('Only --help');
    }
  });
  it('pins the exact schema and refuses other targets before TLS/file/network work', async () => {
    expect(() => requirePreviewDatabase('enrollment_preview')).not.toThrow();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const name of ['', 'enrollment', 'ENROLLMENT_PREVIEW', 'preview']) {
      expect(() => requirePreviewDatabase(name)).toThrow('restricted');
      expect(await runPreviewCli(['--apply'], { DB_NAME: name, DB_PASSWORD: 'DO_NOT_PRINT' })).toBe(1);
    }
    expect(JSON.stringify(errors.mock.calls)).not.toContain('DO_NOT_PRINT');
  });
  it('prints help without environment/assets/database and sanitizes invalid flags', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runPreviewCli(['--help'], {})).toBe(0);
    expect(JSON.stringify(log.mock.calls)).toContain('READ ONLY');
    expect(await runPreviewCli(['--password=DO_NOT_PRINT'], {})).toBe(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('DO_NOT_PRINT');
  });
});

describe('reviewed immutable preview inputs', () => {
  it('keeps the existing eight migration identities exactly unchanged', () => {
    expect(loadMigrations(join(root, 'db/migrations')).slice(0, 8).map((m) => m.checksum)).toEqual([
      '276dcbe9dd536d4f0dd9f9b103dd5da311ffaccb62902cca604f70fa411dc9fe',
      'e8cf896c4da52a51c5b649f408ecf038cf39ab03673f38db7e63c59de1f86f1c',
      'bd4c6474611d601f8c3b9ed22cc56dccb260ae03c8fce797343b61c57093fb47',
      'bd76c208805450b33272f6061cb0f341fe120da22d50db65fb5fca2c032751db',
      '94fa77fbc160aa0e2c662c493c14a54442007a1149e9c21fc503862dd49f14c0',
      'e0f5118d27bfe6e64bbe1243cbbc10ed1189d2dd3e772e96ac20018baabded66',
      'bba1c71ed24c982144296608c5c5a26d8ef34ae2405f6b2a6b51a17f73351849',
      'e971f17505b5892cbb228422caf0c96a20e2a279982155b06d8d72c8c414db06',
    ]);
  });
  it('hashes both exact SQL assets and ordered migration identities', () => {
    const plan = loadPreviewPlan(root);
    expect(plan.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.checksum).toBe(previewChecksum(plan.baseSql, plan.migrations, plan.unicodeSql));
    expect(previewChecksum(plan.baseSql + '\n', plan.migrations, plan.unicodeSql)).not.toBe(plan.checksum);
    expect(previewChecksum(plan.baseSql, plan.migrations, plan.unicodeSql + '\n')).not.toBe(plan.checksum);
    expect(previewChecksum(plan.baseSql, [...plan.migrations].reverse(), plan.unicodeSql)).not.toBe(plan.checksum);
    expect(previewChecksum(plan.baseSql, plan.migrations.map((m, i) => i ? m : { ...m, checksum: '0'.repeat(64) }), plan.unicodeSql)).not.toBe(plan.checksum);
  });
  it('ships reviewed creation/conversion only, not a runtime dump rewrite', () => {
    const plan = loadPreviewPlan(root);
    const sql = (plan.baseSql + plan.unicodeSql).replace(/^--.*$/gm, '');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|USE|GRANT|DEFINER|LOCK TABLES|FOREIGN_KEY_CHECKS|IF NOT EXISTS)\b/i);
    expect(sql).not.toMatch(/\b(CREATE|ALTER)\s+DATABASE\b/i);
    expect([...plan.baseSql.matchAll(/CREATE TABLE (\w+)/g)]).toHaveLength(13);
    expect([...plan.unicodeSql.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]).sort()).toEqual([...PREVIEW_TABLES].sort());
    expect(plan.baseSql).not.toMatch(/INSERT INTO (users|Parent|Child|SiteSettings)\b/);
    expect(plan.baseSql).toContain('FOREIGN KEY (user_id) REFERENCES users (id)');
    expect(readFileSync(join(root, 'db/schema.sql'), 'utf8')).toContain('DROP TABLE IF EXISTS');
  });
  it('refuses missing, symlinked and invalid-UTF8 assets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-preview-unit-')); directories.push(dir);
    expect(() => loadPreviewPlan(dir)).toThrow('reviewed preview assets');
    mkdirSync(join(dir, 'db'), { recursive: true });
    symlinkSync(join(root, 'db/preview'), join(dir, 'db/preview'));
    expect(() => loadPreviewPlan(dir)).toThrow('reviewed preview assets');
    rmSync(join(dir, 'db/preview'));
    mkdirSync(join(dir, 'db/preview'));
    writeFileSync(join(dir, 'db/preview/base.sql'), Buffer.from([0xff]));
    expect(() => loadPreviewPlan(dir)).toThrow('reviewed preview assets');
    writeFileSync(join(dir, 'db/preview/base.sql'), '');
    expect(() => loadPreviewPlan(dir)).toThrow('reviewed preview assets');
    writeFileSync(join(dir, 'db/preview/base.sql'), '\ufeffCREATE TABLE fixture (id INT);');
    writeFileSync(join(dir, 'db/preview/utf8mb4.sql'), 'ALTER TABLE fixture CONVERT TO CHARACTER SET utf8mb4;');
    mkdirSync(join(dir, 'db/migrations'));
    writeFileSync(join(dir, 'db/migrations/001_fixture.sql'), 'SELECT 1;');
    expect(loadPreviewPlan(dir).baseSql).toBe('\ufeffCREATE TABLE fixture (id INT);');
  });
});
