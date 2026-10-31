import { join } from 'node:path';
import { parseArgs } from 'node:util';
import mysql, { type ConnectionOptions } from 'mysql2/promise';
import { DatabaseConfigurationError, databaseConnectionOptions } from '../connectionOptions.js';
import { acknowledgeManualCompletion, applyMigrations, initializeCycle, loadMigrations, MigrationSafetyError, validateCycle, type Cycle, type RepairOptions } from './engine.js';

export interface Options { help: boolean; apply: boolean; repair?: RepairOptions; cycle?: Cycle }

export function parseOptions(args: string[], mode: 'migrate' | 'settings'): Options {
  try {
    const options: Record<string, { type: 'boolean' | 'string' }> = { apply: { type: 'boolean' }, help: { type: 'boolean' } };
    for (const name of mode === 'migrate' ? ['repair', 'checksum', 'reason'] : ['year', 'lottery-open', 'post-lottery']) options[name] = { type: 'string' };
    if (mode === 'migrate') options['acknowledge-manual-verification'] = { type: 'boolean' };
    const { values, tokens } = parseArgs({ args, options, strict: true, allowPositionals: false, tokens: true });
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind === 'option') {
        if (seen.has(token.name)) throw new Error('Duplicate option');
        seen.add(token.name);
      }
    }
    const result: Options = { help: values.help === true, apply: values.apply === true };
    if (result.help) return result;
    if (mode === 'migrate') {
      if (values.repair) {
        if (typeof values.checksum !== 'string' || typeof values.reason !== 'string') throw new Error('Recovery fields missing');
        result.repair = { filename: String(values.repair), checksum: values.checksum, reason: values.reason,
          verified: values['acknowledge-manual-verification'] === true, apply: result.apply };
      } else if (values.checksum || values.reason || values['acknowledge-manual-verification']) throw new Error('Recovery fields without repair');
    } else {
      const inputs = ['year', 'lottery-open', 'post-lottery'];
      if (result.apply || inputs.some((key) => values[key] !== undefined)) {
        if (!inputs.every((key) => typeof values[key] === 'string') ||
            !['true', 'false'].includes(String(values['lottery-open'])) || !['true', 'false'].includes(String(values['post-lottery']))) throw new Error('Explicit cycle fields missing');
        result.cycle = { yearBegin: Number(values.year), lotteryOpen: values['lottery-open'] === 'true', postLottery: values['post-lottery'] === 'true' };
        validateCycle(result.cycle);
      }
    }
    return result;
  } catch {
    throw new MigrationSafetyError('Invalid, repeated or incomplete arguments. See --help; no database connection attempted.');
  }
}

export function connectionOptions(env: NodeJS.ProcessEnv): ConnectionOptions {
  return databaseConnectionOptions(env, { multipleStatements: true });
}

export function help(mode: 'migrate' | 'settings'): string {
  return mode === 'migrate' ? `db:migrate [--apply]
Default: read-only target/history/pending report, including on an uninitialized DB.
Only --apply permits migration/history writes. SQL errors and checksum drift stop execution.
Recovery after manually completing/verifying ALL effects (no SQL is replayed):
  --repair FILENAME --checksum SHA256 --reason NONSECRET_REASON
  [--acknowledge-manual-verification] [--apply]
Requires explicit DB_HOST, DB_PORT (default 3306), DB_NAME, DB_USER, DB_PASSWORD in environment.
Verified TLS defaults: DB_TLS_MODE=verify_identity, DB_TLS_CA_FILE=absolute-public-CA-path.
Use the compiled CLI under dist/ on the prepared host; do not source a secret .env in a shell.
` : `db:init-settings [--year YYYY --lottery-open true|false --post-lottery true|false] [--apply]
Default: read-only existing/proposed settings report. All three values are required to write.
Only inserts initial settings; refuses overwrites. Requires clean/current migrations.
Use the same explicit DB_* environment as the migration CLI; no secret CLI arguments.
`;
}

/** CLI wrapper owns/always closes its connection. Importing the engine never connects. */
export async function runDatabaseCli(mode: 'migrate' | 'settings', args = process.argv.slice(2), env = process.env): Promise<number> {
  let connection: mysql.Connection | undefined;
  try {
    const options = parseOptions(args, mode);
    if (options.help) { console.log(help(mode)); return 0; }
    const config = connectionOptions(env);
    const migrations = loadMigrations(join(process.cwd(), 'db', 'migrations'));
    console.log(`Database target: ${config.host}:${config.port}/${config.database}; mode: ${options.apply ? 'EXPLICIT APPLY' : 'READ ONLY'}`);
    connection = await mysql.createConnection(config);
    if (mode === 'settings') {
      console.log(JSON.stringify(await initializeCycle(connection, migrations, options.cycle, options), null, 2));
      return 0;
    }
    const report = options.repair ? await acknowledgeManualCompletion(connection, migrations, options.repair) :
      await applyMigrations(connection, migrations, options);
    for (const entry of report.entries) console.log(`${entry.state.padEnd(7)} ${entry.filename} ${entry.checksum}${entry.recordedChecksum && /^[a-f0-9]{64}$/.test(entry.recordedChecksum) && entry.recordedChecksum !== entry.checksum ? ` recorded=${entry.recordedChecksum}` : ''}`);
    if (report.entries.some((e) => e.filename === '002_survey_data.sql' && e.state === 'pending')) {
      console.log('Before --apply, review 002_survey_data.json against the live legacy form, including hardcoded choices not discoverable from DB metadata.');
    }
    for (const issue of report.issues) console.error(`BLOCKED: ${issue.message}`);
    if (!options.apply) console.log('Read-only: no schema/history/data writes. Use --apply only after target/backup review.');
    return report.issues.length ? 1 : 0;
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? 'DATABASE_ERROR');
    // Never print raw mysql2 errors: they can include SQL, parameters or data.
    console.error(error instanceof MigrationSafetyError || error instanceof DatabaseConfigurationError ? error.message :
      `Database operation failed (${/^[A-Z0-9_]{1,64}$/.test(code) ? code : 'DATABASE_ERROR'}). Inspect safely; no automatic recovery.`);
    return 1;
  } finally {
    await connection?.end().catch(() => {});
  }
}
