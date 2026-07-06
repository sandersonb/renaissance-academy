import { describe, it, expect } from 'vitest';
import { RegStatus, Consideration } from '../src/domain/regStatus.js';
import type { Child } from '../src/domain/types.js';
import { runLottery, type LotteryResult } from '../src/domain/lottery/engine.js';

/** Build a synthetic pre-draw population. */
function fixture(): Child[] {
  const kids: Child[] = [];
  let id = 1;
  const add = (parentId: number, grade: number, status: RegStatus, considerations = 0) =>
    kids.push({ childId: id++, parentId, grade, regStatus: status, considerations, position: null });

  // Grade 0 (K): 6 already re-enrolled (consume seats) + 20 new INITIAL.
  for (let i = 0; i < 6; i++) add(1000 + i, 0, RegStatus.ACPT_REENROLL);
  for (let i = 0; i < 20; i++) add(2000 + i, 0, RegStatus.INITIAL);

  // Grade 1: under-subscribed (2 INITIAL, plenty of room) -> underfill admits both.
  add(3000, 1, RegStatus.INITIAL);
  add(3001, 1, RegStatus.INITIAL);

  // Grade 2: oversubscribed, with a few preference-tier kids (sibling bit).
  for (let i = 0; i < 10; i++) {
    add(4000 + i, 2, RegStatus.INITIAL, i < 3 ? Consideration.SIBLING : 0);
  }

  // A sibling family: parent 5000 has kids in grades 0, 2, and 1 (all INITIAL).
  add(5000, 0, RegStatus.INITIAL);
  add(5000, 2, RegStatus.INITIAL);
  add(5000, 1, RegStatus.INITIAL);

  return kids;
}

const CAPS = [10, 5, 6, 0, 0, 0, 0, 0, 0, 0] as const;

function checkInvariants(input: Child[], r: LotteryResult): string[] {
  const issues: string[] = [];
  const byId = new Map(input.map((c) => [c.childId, c]));
  const initialIds = input.filter((c) => c.regStatus === RegStatus.INITIAL).map((c) => c.childId);

  // Every INITIAL child gets exactly one assignment.
  const assignedIds = r.assignments.map((a) => a.childId);
  if (new Set(assignedIds).size !== assignedIds.length) issues.push('a child was assigned more than once');
  if (new Set(assignedIds).size !== initialIds.length) {
    issues.push(`assigned ${new Set(assignedIds).size} != ${initialIds.length} INITIAL`);
  }
  const VALID_TARGETS: RegStatus[] = [RegStatus.PEND_OFFER, RegStatus.WAIT, RegStatus.SIB_WAIT];
  for (const a of r.assignments) {
    if (a.from !== RegStatus.INITIAL) issues.push(`assignment from non-INITIAL (${a.from})`);
    if (!VALID_TARGETS.includes(a.to)) issues.push(`unexpected target ${a.to}`);
  }

  // Offered per grade <= openings (caps - preseated).
  for (let g = 0; g < 10; g++) {
    const preseated = input.filter(
      (c) => c.grade === g && c.regStatus === RegStatus.ACPT_REENROLL,
    ).length;
    const openings = Math.max(0, CAPS[g]! - preseated);
    const offered = r.assignments.filter((a) => a.grade === g && a.to === RegStatus.PEND_OFFER).length;
    if (offered > openings) issues.push(`grade ${g}: offered ${offered} > openings ${openings}`);
  }

  // Sibling-pulled children are PEND_OFFER or SIB_WAIT, never plain WAIT.
  for (const a of r.assignments) {
    if (a.viaSibling && a.to === RegStatus.WAIT) issues.push(`grade ${a.grade}: sibling placed on WAIT`);
  }

  // Preference phase entries are all processed as siblings (indented in trace).
  for (const a of r.assignments) {
    if (a.phase === 'preference' && !a.viaSibling) issues.push('preference entry not via sibling');
  }

  // Waitlist positions contiguous 1..N per (grade, status).
  const posByKey = new Map<string, number[]>();
  for (const a of r.assignments) {
    if (a.to === RegStatus.WAIT || a.to === RegStatus.SIB_WAIT) {
      const k = `${a.grade}:${a.to}`;
      (posByKey.get(k) ?? posByKey.set(k, []).get(k)!).push(a.position!);
    }
  }
  for (const [k, positions] of posByKey) {
    const sorted = [...positions].sort((x, y) => x - y);
    const expected = Array.from({ length: positions.length }, (_, i) => i + 1);
    if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
      issues.push(`positions not contiguous for ${k}: ${sorted.join(',')}`);
    }
  }

  // Under-subscribed grade 1 (3 candidates incl. the family-5000 sibling, 5
  // seats) -> all offered (none waitlisted).
  const g1offers = r.assignments.filter((a) => a.grade === 1 && a.to === RegStatus.PEND_OFFER).length;
  const g1total = r.assignments.filter((a) => a.grade === 1).length;
  if (g1offers !== g1total) issues.push(`grade 1: ${g1offers}/${g1total} offered (expected all)`);

  return issues;
}

describe('lottery engine', () => {
  it('satisfies all allocation invariants', () => {
    const input = fixture();
    const r = runLottery(input, CAPS, 'seed-A');
    expect(checkInvariants(input, r)).toEqual([]);
  });

  it('is deterministic for a given seed (replayable)', () => {
    const input = fixture();
    const a = runLottery(input, CAPS, 'seed-A');
    const b = runLottery(input, CAPS, 'seed-A');
    expect(b.assignments).toEqual(a.assignments);
  });

  it('produces different draws for different seeds (but still valid)', () => {
    const input = fixture();
    const a = runLottery(input, CAPS, 'seed-A');
    const b = runLottery(input, CAPS, 'seed-B');
    expect(a.assignments).not.toEqual(b.assignments); // overwhelmingly likely
    expect(checkInvariants(input, b)).toEqual([]);
  });

  it('does not mutate the caller input', () => {
    const input = fixture();
    const snapshot = JSON.stringify(input);
    runLottery(input, CAPS, 'seed-A');
    expect(JSON.stringify(input)).toEqual(snapshot);
  });

  it('keeps a selected student\'s siblings together (offer or SIB_WAIT)', () => {
    const input = fixture();
    const r = runLottery(input, CAPS, 'seed-A');
    // Family 5000 has 3 INITIAL kids; if any was offered via the main draw,
    // siblings must appear (offered or SIB_WAIT), never left as plain WAIT.
    const fam = r.assignments.filter((a) => a.parentId === 5000);
    expect(fam.length).toBe(3);
    for (const a of fam) {
      if (a.viaSibling) expect([RegStatus.PEND_OFFER, RegStatus.SIB_WAIT]).toContain(a.to);
    }
  });
});
