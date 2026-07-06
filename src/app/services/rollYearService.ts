/**
 * RollYearService — the December reset (RULES_SPEC §2.1) as a guarded admin
 * action. Replaces the manual SQL ritual + page.pm hand-edits.
 *
 * Safety model:
 *   - validate(): parse + validate the roster CSV; NO changes. Surfaces row
 *     errors before anything destructive happens.
 *   - commit(): validate FIRST (refuse to purge if the CSV has errors), then
 *     purge the per-year tables, import Current_Student, and set the new year /
 *     gates (lottery_open=1, post_lottery=0). Admins must back up first.
 *
 * TODO(M5): wrap purge+import+settings in a single DB transaction. Validation
 * happens before any destructive step, so a bad CSV can't wipe data.
 */
import { parseRoster } from '../../domain/rosterCsv.js';
import type { Database } from '../ports/database.js';

export class RollYearError extends Error {}

export interface RollValidation {
  ok: boolean;
  rowCount: number;
  errors: { line: number; message: string }[];
  byGrade: Record<number, number>;
}

export class RollYearService {
  constructor(private db: Database) {}

  validate(csv: string): RollValidation {
    const { rows, errors } = parseRoster(csv);
    const byGrade: Record<number, number> = {};
    for (const r of rows) byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
    return { ok: errors.length === 0 && rows.length > 0, rowCount: rows.length, errors, byGrade };
  }

  async commit(yearBegin: number, csv: string): Promise<{ imported: number }> {
    const { rows, errors } = parseRoster(csv);
    if (errors.length > 0) {
      throw new RollYearError(`Roster has ${errors.length} error(s); fix them before rolling the year.`);
    }
    if (rows.length === 0) throw new RollYearError('Roster is empty.');
    if (!Number.isInteger(yearBegin) || yearBegin < 2000 || yearBegin > 2100) {
      throw new RollYearError('Invalid enrollment year.');
    }

    // Destructive section (CSV already validated) — purge + import + settings
    // are one transaction, so a failure can't leave a half-reset database.
    const imported = await this.db.transaction(async (tx) => {
      await tx.maintenance.purgeForNewYear();
      const n = await tx.maintenance.importCurrentStudents(rows);
      await tx.settings.set({ yearBegin, lotteryOpen: true, postLottery: false });
      return n;
    });
    return { imported };
  }
}
