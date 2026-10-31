/** Separate insert-only cycle bootstrap. Defaults to inspection; writes need --apply. */
import { runDatabaseCli } from '../adapters/mysql/migrations/cli.js';

process.exitCode = await runDatabaseCli('settings');
