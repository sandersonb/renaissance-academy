import { RegStatus, SEAT_CONSUMING } from './regStatus.js';
import type { Child } from './types.js';

/** Seats consumed in a grade (Enrollment.pm `grade_used` / lottery current-enrollment). */
export const gradeUsed = (children: readonly Child[], grade: number): number =>
  children.filter((c) => c.grade === grade && SEAT_CONSUMING.has(c.regStatus)).length;

/** Count of children on the sibling wait list in a grade (`sib_waits`). */
export const sibWaits = (children: readonly Child[], grade: number): number =>
  children.filter((c) => c.grade === grade && c.regStatus === RegStatus.SIB_WAIT).length;

/** Count of INITIAL candidates in a grade. */
export const initialCount = (children: readonly Child[], grade: number): number =>
  children.filter((c) => c.grade === grade && c.regStatus === RegStatus.INITIAL).length;
