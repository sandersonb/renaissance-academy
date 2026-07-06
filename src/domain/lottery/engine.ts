/**
 * Lottery engine — a faithful, SEEDED reimplementation of lottery.pl.orig
 * (RULES_SPEC §6), validated against the March 2019 trace via the invariant
 * harness (see test/lottery.test.ts and new/analyze_lottery_results.py).
 *
 * Pure function: (children snapshot + caps + seed) -> assignments. No DB, no
 * I/O, no mutation of the caller's array (works on a deep-ish copy). The DB
 * adapter (M3) loads the snapshot, persists the assignments, and stores the
 * recorded seed + draw log (lottery_run / lottery_assignment).
 *
 * Phase order (legacy): preference -> underfill -> main draw -> standby.
 * Sibling preference: a selected student pulls in their INITIAL siblings, who
 * get an offer (if their grade has room) else SIB_WAIT (ranked ahead of WAIT).
 *
 * Intentional deviation from legacy (squashed bug): the legacy do_underfill
 * iterates a pre-fetched INITIAL list and could re-process a child already
 * pulled in as a sibling (double-offer / double-decrement of openings). We
 * guard against re-processing a non-INITIAL child. See DEVIATIONS below.
 */
import { GRADES, RegStatus, gradeLabel, hasConsideration } from '../regStatus.js';
import type { Child, GradeCaps } from '../types.js';
import { createRng, makeSeed, type Rng } from './rng.js';

export type LotteryPhase = 'preference' | 'underfill' | 'lottery' | 'standby';

export interface Assignment {
  childId: number;
  parentId: number;
  grade: number;
  from: RegStatus;
  to: RegStatus;
  position: number | null;
  phase: LotteryPhase;
  /** processed as a sibling (legacy IS_SIBLING -> indented in the trace) */
  viaSibling: boolean;
}

export interface LotteryResult {
  seed: string;
  caps: GradeCaps;
  /** openings per grade at the start of each phase (after the prior phase) */
  openingsByPhase: Record<LotteryPhase, number[]>;
  assignments: Assignment[];
}

const SIB = { DO: 0, IS: 1, NO: 2 } as const;
type SibMode = (typeof SIB)[keyof typeof SIB];

export function runLottery(
  input: readonly Child[],
  caps: GradeCaps,
  seedArg?: string,
): LotteryResult {
  const seed = seedArg ?? makeSeed();
  const rng = createRng(seed);

  // Work on copies so the caller's data is untouched.
  const children: Child[] = input.map((c) => ({ ...c }));
  const byId = new Map(children.map((c) => [c.childId, c]));

  // openings[g] = caps[g] - seats already consumed (re-enrolled/offered/etc.)
  const openings = GRADES.map((g) => {
    const used = children.filter(
      (c) => c.grade === g && SEAT_CONSUMING_HAS(c.regStatus),
    ).length;
    return Math.max(0, (caps[g] ?? 0) - used);
  });

  // Next WAIT / SIB_WAIT positions per grade (continue from any existing).
  const waitPos = GRADES.map((g) => maxPos(children, g, RegStatus.WAIT) + 1);
  const sibWaitPos = GRADES.map((g) => maxPos(children, g, RegStatus.SIB_WAIT) + 1);

  const assignments: Assignment[] = [];
  const openingsByPhase = {} as Record<LotteryPhase, number[]>;
  const snapshotOpenings = (p: LotteryPhase) => {
    openingsByPhase[p] = openings.slice();
  };

  const initialInGrade = (g: number) =>
    children.filter((c) => c.grade === g && c.regStatus === RegStatus.INITIAL);
  const initialSiblings = (parentId: number) =>
    children.filter((c) => c.parentId === parentId && c.regStatus === RegStatus.INITIAL);

  const place = (
    child: Child,
    to: RegStatus,
    phase: LotteryPhase,
    viaSibling: boolean,
    position: number | null,
  ) => {
    const from = child.regStatus;
    child.regStatus = to;
    child.position = position;
    assignments.push({
      childId: child.childId,
      parentId: child.parentId,
      grade: child.grade,
      from,
      to,
      position,
      phase,
      viaSibling,
    });
  };

  const processChild = (child: Child, mode: SibMode, phase: LotteryPhase) => {
    // Guard (deviation): never re-process a child already placed (e.g. pulled
    // in as a sibling, then reached again by an outer loop). Legacy lacked this.
    if (child.regStatus !== RegStatus.INITIAL) return;
    const g = child.grade;
    const viaSibling = mode === SIB.IS;

    if (openings[g]! > 0) {
      place(child, RegStatus.PEND_OFFER, phase, viaSibling, null);
      openings[g]!--;
      if (mode === SIB.DO) {
        for (const sib of initialSiblings(child.parentId)) {
          processChild(sib, SIB.IS, phase);
        }
      }
    } else if (mode !== SIB.IS) {
      place(child, RegStatus.WAIT, phase, false, waitPos[g]!);
      waitPos[g]!++;
    } else {
      place(child, RegStatus.SIB_WAIT, phase, true, sibWaitPos[g]!);
      sibWaitPos[g]!++;
    }
  };

  // --- Phase 1: preference tier (Lottery_Considerations > 0), as IS_SIBLING ---
  snapshotOpenings('preference');
  const pref = rng.shuffle(
    children.filter(
      (c) => c.regStatus === RegStatus.INITIAL && c.considerations > 0,
    ),
  );
  for (const c of pref) processChild(c, SIB.IS, 'preference');

  // --- Phase 2: underfill grades with candidates <= openings (DO_SIBLING) ---
  snapshotOpenings('underfill');
  for (const g of GRADES) {
    const candidates = initialInGrade(g);
    if (candidates.length > 0 && openings[g]! >= candidates.length) {
      // Legacy caps openings to the candidate count for this grade.
      openings[g] = candidates.length;
      for (const c of candidates) processChild(c, SIB.DO, 'underfill');
    }
  }

  // --- Phase 3: main draw — random grade, then random INITIAL student ---
  snapshotOpenings('lottery');
  for (;;) {
    const pool = GRADES.filter((g) => openings[g]! > 0 && initialInGrade(g).length > 0);
    if (pool.length === 0) break;
    const g = rng.pick(pool);
    const student = rng.pick(initialInGrade(g));
    processChild(student, SIB.DO, 'lottery');
  }

  // --- Phase 4: standby — everyone left to the wait list ---
  snapshotOpenings('standby');
  for (const c of rng.shuffle(children.filter((c) => c.regStatus === RegStatus.INITIAL))) {
    processChild(c, SIB.NO, 'standby');
  }

  return { seed, caps, openingsByPhase, assignments };
}

// ---- small helpers (kept local to avoid import cycles) ----
const SEAT_CONSUMING_LIST: ReadonlySet<RegStatus> = new Set<RegStatus>([
  RegStatus.ACPT_REENROLL,
  RegStatus.PEND_OFFER,
  RegStatus.OFFER,
  RegStatus.IP_OFFER,
  RegStatus.PEND_REGISTER,
  RegStatus.FIN_REGISTER,
  RegStatus.REGISTER,
]);
function SEAT_CONSUMING_HAS(s: RegStatus): boolean {
  return SEAT_CONSUMING_LIST.has(s);
}
function maxPos(children: readonly Child[], grade: number, status: RegStatus): number {
  let m = 0;
  for (const c of children) {
    if (c.grade === grade && c.regStatus === status && c.position && c.position > m) {
      m = c.position;
    }
  }
  return m;
}

/**
 * Render a result in the legacy lottery.pl stdout format so it can be checked
 * by new/analyze_lottery_results.py (the golden-master harness). Names are not
 * needed by the analyzer; we emit "Child<id>".
 */
export function renderTrace(result: LotteryResult): string {
  const lines: string[] = [];
  const bar = '#'.repeat(61);
  const titles: Record<LotteryPhase, string> = {
    preference: 'Processing Students with Lottery Preference',
    underfill: "Automatically filling grades for which we don't have enough candidates",
    lottery: 'Beginning lottery',
    standby: 'Processing standby list',
  };
  const header = (phase: LotteryPhase) => {
    lines.push('', bar, titles[phase], bar, '', 'Open Positions: ');
    const o = result.openingsByPhase[phase];
    let any = false;
    for (const g of GRADES) {
      if ((o?.[g] ?? 0) > 0) {
        lines.push(`${gradeLabel(g)}: ${String(o![g]).padStart(3)}`);
        any = true;
      }
    }
    if (!any) lines.push('NONE');
    lines.push('');
  };
  const order: LotteryPhase[] = ['preference', 'underfill', 'lottery', 'standby'];
  for (const phase of order) {
    header(phase);
    for (const a of result.assignments.filter((x) => x.phase === phase)) {
      const name = `Child${a.childId}`;
      const label = `${name} (grade ${a.grade})`;
      const indent = a.viaSibling ? '  ' : '';
      if (phase === 'lottery' && !a.viaSibling) lines.push(' ', `Student ${name} selected in the lottery`);
      const action =
        a.to === RegStatus.PEND_OFFER
          ? 'position offered'
          : a.to === RegStatus.SIB_WAIT
            ? `placed on sibling wait list position ${a.position}`
            : `placed on wait list position ${a.position}`;
      lines.push(`${indent}${label.padEnd(30)} =>  ${action}`);
    }
  }
  return lines.join('\n') + '\n';
}
