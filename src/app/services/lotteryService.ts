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

  /** Dry run — no DB writes. Returns the summary + a seed to commit later. */
  async preview(capsArg?: number[]): Promise<LotterySummary> {
    const { caps, children } = await this.load(capsArg);
    const seed = makeSeed();
    return summarize(seed, caps, children, runLottery(children, caps, seed));
  }

  /** Apply the draw: record the immutable log, then place each student. */
  async commit(capsArg?: number[], seedArg?: string): Promise<LotterySummary & { runId: number }> {
    const { caps, children } = await this.load(capsArg);
    const seed = seedArg ?? makeSeed();
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
      return id;
    });

    return { runId, ...summarize(seed, caps, children, result) };
  }
}
