/**
 * Admin status-change service — pure port of Enrollment.pm
 * `change_status_finalize` (RULES_SPEC §4 matrix + §11.1 algorithm).
 *
 * Pure & transactional-by-design: it computes the COMPLETE set of row changes
 * (the target child, any coalesced waitlist neighbors, and any promoted
 * siblings) and returns them, so the DB adapter can apply them in a single
 * transaction (deviation B2 — legacy did separate, untransacted UPDATEs).
 *
 * Returns { ok:false, error } when the change is illegal or capacity/ordering
 * guards fail; the caller makes no DB writes in that case.
 */
import { RegStatus, HUMANIFY, isWaitStatus } from './regStatus.js';
import { flowable } from './transitions.js';
import { gradeUsed, sibWaits } from './capacity.js';
import type { Child, GradeCaps } from './types.js';

export interface RowChange {
  childId: number;
  from: RegStatus;
  to: RegStatus;
  position: number | null;
  /** set Expiration = today + offer/paperwork days (resolved by caller) */
  setExpiration?: 'offer' | 'paperwork';
  /** delete ChildExtra rows (on DECLINE) */
  clearChildExtra?: boolean;
}

export interface ChangeResult {
  ok: boolean;
  error?: string;
  message?: string;
  changes: RowChange[];
}

export function changeStatus(
  input: readonly Child[],
  childId: number,
  target: RegStatus,
  caps: GradeCaps,
): ChangeResult {
  const children: Child[] = input.map((c) => ({ ...c }));
  const child = children.find((c) => c.childId === childId);
  if (!child) return { ok: false, error: `No such child for ID ${childId}`, changes: [] };

  const fromStatus = child.regStatus;

  // 1. Legality (the $flow matrix).
  if (!flowable(fromStatus).includes(target)) {
    return {
      ok: false,
      error: `Unable to change from ${HUMANIFY[fromStatus]} to ${HUMANIFY[target]}`,
      changes: [],
    };
  }

  // 2. A wait-listed child must have a position to be changed.
  if (isWaitStatus(fromStatus) && !child.position) {
    return {
      ok: false,
      error: `It would be okay to change to ${HUMANIFY[target]}, but missing Position!`,
      changes: [],
    };
  }

  // 3. Capacity / ordering guards (only when extending an offer).
  if (target === RegStatus.PEND_OFFER) {
    const used = gradeUsed(children, child.grade);
    const max = caps[child.grade] ?? 0;
    if (used >= max) {
      return { ok: false, error: `Used ${used} of ${max} slots for grade ${child.grade}`, changes: [] };
    }
    if (fromStatus === RegStatus.WAIT) {
      const ahead = sibWaits(children, child.grade);
      if (ahead > 0) {
        return { ok: false, error: `There are still ${ahead} students ahead in SIB_WAIT`, changes: [] };
      }
    }
  }

  const changes: RowChange[] = [];
  const apply = (c: Child, to: RegStatus, position: number | null, extra?: Partial<RowChange>) => {
    changes.push({ childId: c.childId, from: c.regStatus, to, position, ...extra });
    c.regStatus = to;
    c.position = position;
  };

  // Leaving a wait list: null position + coalesce everyone behind (deviation B2,
  // done as part of one transactional change set).
  if (isWaitStatus(fromStatus)) {
    coalesce(children, child.grade, fromStatus, child.position!, changes);
  }

  // Apply the primary change with any side effects.
  const extra: Partial<RowChange> = {};
  if (target === RegStatus.OFFER) extra.setExpiration = 'offer';
  if (target === RegStatus.PEND_REGISTER) extra.setExpiration = 'paperwork';
  if (target === RegStatus.DECLINE) extra.clearChildExtra = true;
  let newPos: number | null = null;
  if (isWaitStatus(target)) newPos = nextPosition(children, child.grade, target);
  apply(child, target, newPos, extra);

  let message = `Changed ${HUMANIFY[fromStatus]} to ${HUMANIFY[target]}`;
  if (newPos) message += ` (position ${newPos})`;

  // PEND_OFFER pulls the offered student's WAIT siblings forward (mirrors the
  // lottery's sibling preference).
  if (target === RegStatus.PEND_OFFER) {
    const waitSiblings = children.filter(
      (c) => c.parentId === child.parentId && c.regStatus === RegStatus.WAIT,
    );
    for (const sib of waitSiblings) {
      coalesce(children, sib.grade, RegStatus.WAIT, sib.position!, changes);
      const room = gradeUsed(children, sib.grade) < (caps[sib.grade] ?? 0);
      const clear = sibWaits(children, sib.grade) === 0;
      if (room && clear) {
        apply(sib, RegStatus.PEND_OFFER, null);
      } else {
        apply(sib, RegStatus.SIB_WAIT, nextPosition(children, sib.grade, RegStatus.SIB_WAIT));
      }
    }
  }

  return { ok: true, message, changes };
}

/** Null nothing; decrement Position of same grade+status entries behind `removed`. */
function coalesce(
  children: Child[],
  grade: number,
  status: RegStatus,
  removedPos: number,
  changes: RowChange[],
): void {
  for (const c of children) {
    if (c.grade === grade && c.regStatus === status && c.position && c.position > removedPos) {
      const np = c.position - 1;
      changes.push({ childId: c.childId, from: status, to: status, position: np });
      c.position = np;
    }
  }
}

function nextPosition(children: readonly Child[], grade: number, status: RegStatus): number {
  let m = 0;
  for (const c of children) {
    if (c.grade === grade && c.regStatus === status && c.position && c.position > m) m = c.position;
  }
  return m + 1;
}
