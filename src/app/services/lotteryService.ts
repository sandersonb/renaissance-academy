/**
 * LotteryService — the admin "Run Lottery" action (legacy lottery.sh /
 * dry_run_lottery.sh). Wraps the pure, seeded M1 engine:
 *   - preview(): run a dry draw and return a summary + the seed. NO DB writes.
 *   - commit():  run, PERSIST the immutable draw log (lottery_run/_assignment),
 *                and apply the placements to Child. Pass the previewed seed to
 *                commit the exact draw that was reviewed (reproducible — B3).
 */
import { GRADES, RegStatus, gradeLabel } from '../../domain/regStatus.js';
import { runLottery, type LotteryResult } from '../../domain/lottery/engine.js';
import { makeSeed } from '../../domain/lottery/rng.js';
import type { Child } from '../../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../ports/database.js';
import type { ChildRecord, Repositories } from '../ports/repositories.js';

export class LotteryError extends Error {}

const toDomain = (c: ChildRecord): Child => ({
  childId: c.childId, parentId: c.parentId, grade: c.gradeNextYear,
  regStatus: c.regStatus, considerations: c.lotteryConsiderations, position: c.position,
});

export interface LotterySummary {
  seed: string;
  caps: number[];
  totals: { offered: number; waitlisted: number; siblingPulls: number; initialCount: number };
  byGrade: { grade: string; offered: number; wait: number; sibWait: number }[];
}

function summarize(seed: string, caps: number[], input: Child[], result: LotteryResult): LotterySummary {
  const a = result.assignments;
  const offered = a.filter((x) => x.to === RegStatus.PEND_OFFER).length;
  const wait = a.filter((x) => x.to === RegStatus.WAIT).length;
  const sib = a.filter((x) => x.to === RegStatus.SIB_WAIT).length;
  return {
    seed,
    caps,
    totals: {
      offered,
      waitlisted: wait + sib,
      siblingPulls: a.filter((x) => x.viaSibling).length,
      initialCount: input.filter((c) => c.regStatus === RegStatus.INITIAL).length,
    },
    byGrade: GRADES.map((g) => ({
      grade: gradeLabel(g),
      offered: a.filter((x) => x.grade === g && x.to === RegStatus.PEND_OFFER).length,
      wait: a.filter((x) => x.grade === g && x.to === RegStatus.WAIT).length,
      sibWait: a.filter((x) => x.grade === g && x.to === RegStatus.SIB_WAIT).length,
    })).filter((r) => r.offered + r.wait + r.sibWait > 0),
  };
}

export class LotteryService {
  private repos: Repositories;
  constructor(private db: Database, private config: AppConfig) {
    this.repos = db.repos;
  }

  private async load(capsArg?: number[]): Promise<{ caps: number[]; children: Child[] }> {
    const caps = capsArg && capsArg.length === 10 ? capsArg : await this.repos.capacity.gradeCaps();
    const children = (await this.repos.children.all()).map(toDomain);
    return { caps, children };
  }

  /**
   * Illustrative dry run — NO DB writes, and the seed it uses is NOT reused by
   * commit(). Each preview is one random sample of "what might happen"; the
   * official draw is drawn independently, so a preview must never be presented as
   * the outcome. (Legal/fairness requirement.)
   */
  async preview(capsArg?: number[]): Promise<LotterySummary> {
    const { caps, children } = await this.load(capsArg);
    const seed = makeSeed();
    return summarize(seed, caps, children, runLottery(children, caps, seed));
  }

  /** Apply the official draw: record the immutable log, then place each student. */
  async commit(capsArg?: number[]): Promise<LotterySummary & { runId: number }> {
    // Guard: the draw runs once per cycle. post_lottery=1 means it already ran;
    // re-running would re-place students and disrupt existing offers/waitlists.
    if (this.config.postLottery) {
      throw new LotteryError('The lottery has already been run for this year. To re-run it, first turn off the "Post-lottery" gate in Settings.');
    }
    const { caps, children } = await this.load(capsArg);
    // ALWAYS a fresh, server-generated seed — a previewed draw is never reused.
    // The live lottery is an independent random draw nobody has seen.
    const seed = makeSeed();
    const result = runLottery(children, caps, seed);

    // Record the draw log AND apply every placement atomically (B2/B3).
    const runId = await this.db.transaction(async (tx) => {
      const id = await tx.lotteryRuns.createRun({ seed, year: this.config.yearBegin, caps, committed: true });
      await tx.lotteryRuns.addAssignments(
        id,
        result.assignments.map((a) => ({
          childId: a.childId, fromStatus: a.from, toStatus: a.to, position: a.position, phase: a.phase, viaSibling: a.viaSibling,
        })),
      );
      for (const a of result.assignments) await tx.children.updateStatus(a.childId, a.to, a.position);
      // Committing a draw moves the cycle into its post-lottery phase.
      await tx.settings.set({ yearBegin: this.config.yearBegin, lotteryOpen: this.config.lotteryOpen, postLottery: true });
      return id;
    });
    this.config.postLottery = true; // apply live (shared config object)

    return { runId, ...summarize(seed, caps, children, result) };
  }
}
