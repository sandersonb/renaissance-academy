/** Explicit operator CLI. Default is read-only; importing the engine has no I/O. */
import { runDatabaseCli } from './migrations/cli.js';

process.exitCode = await runDatabaseCli('migrate');
