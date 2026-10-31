import { parseArgs } from 'node:util';
import mysql from 'mysql2/promise';
import { databaseConnectionOptions, DatabaseConfigurationError } from '../connectionOptions.js';
import { MigrationSafetyError } from './engine.js';
import { initializePreview, loadPreviewPlan, requirePreviewDatabase } from './preview.js';

export function parsePreviewOptions(args: string[]): { help: boolean; apply: boolean } {
  try {
    const { values, tokens } = parseArgs({ args, options: { help: { type: 'boolean' }, apply: { type: 'boolean' } }, strict: true, allowPositionals: false, tokens: true });
    const names = tokens.filter((t) => t.kind === 'option').map((t) => t.name);
    if (new Set(names).size !== names.length) throw new Error('Duplicate');
    return { help: values.help === true, apply: values.apply === true };
  } catch {
    throw new MigrationSafetyError('Only --help and an explicit --apply are accepted. No force, reset, resume or target-override flags.');
  }
}

export async function runPreviewCli(args = process.argv.slice(2), env = process.env): Promise<number> {
  let connection: mysql.Connection | undefined;
  try {
    const options = parsePreviewOptions(args);
    if (options.help) {
      console.log(`db:init-preview [--apply]
Default: READ ONLY metadata/history inspection. Fixed DB_NAME=enrollment_preview only.
Apply requires an EMPTY existing utf8mb4/utf8mb4_unicode_ci database and reviewed assets.
Creates legacy base/reference fixtures, executes unchanged tracked migrations, then finalizes UTF-8.
No DROP/LOCK TABLES/CREATE VIEW privileges; foreign key creation requires scoped REFERENCES.
No families, accounts, cycle settings, API, mail jobs, reset or automatic recovery.
Use the protected migration environment and verified TLS; see db/PREVIEW_BOOTSTRAP.md.`);
      return 0;
    }
    requirePreviewDatabase(env.DB_NAME ?? ''); // Before TLS files, network or filesystem discovery.
    const config = databaseConnectionOptions(env, { multipleStatements: true });
    const plan = loadPreviewPlan(process.cwd());
    console.log(`Preview target: ${config.host}:${config.port}/${config.database}; mode: ${options.apply ? 'EXPLICIT APPLY' : 'READ ONLY'}; checksum: ${plan.checksum}`);
    connection = await mysql.createConnection(config);
    const report = await initializePreview(connection, plan, options);
    console.log(JSON.stringify(report, null, 2));
    console.log('No cycle settings or API/workers started. No automatic replay/reset; operator review required for any partial failure.');
    return report.issues.length ? 1 : 0;
  } catch (error) {
    const raw = String((error as { code?: string })?.code ?? 'PREVIEW_BOOTSTRAP_ERROR');
    console.error(error instanceof MigrationSafetyError || error instanceof DatabaseConfigurationError ? error.message :
      `Preview operation failed (${/^[A-Z0-9_]{1,64}$/.test(raw) ? raw : 'PREVIEW_BOOTSTRAP_ERROR'}). No reset or fallback attempted.`);
    return 1;
  } finally { await connection?.end().catch(() => {}); }
}
