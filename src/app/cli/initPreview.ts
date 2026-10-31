import { runPreviewCli } from '../adapters/mysql/migrations/previewCli.js';

process.exitCode = await runPreviewCli();
