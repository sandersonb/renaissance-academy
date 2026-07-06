import type { RegStatus } from './regStatus.js';

/**
 * In-memory view of a `Child` row, holding only the fields the domain logic
 * needs. The DB adapter (M3) maps rows <-> this shape; the domain stays pure
 * and unit-testable with no DB dependency.
 */
export interface Child {
  childId: number;
  parentId: number;
  grade: number; // Grade_nxt_yr, 0..9
  regStatus: RegStatus;
  considerations: number; // Lottery_Considerations bitmask
  position: number | null; // waitlist position (WAIT / SIB_WAIT)
}

/** Per-grade seat caps, index 0..9 (K..9). */
export type GradeCaps = readonly number[];
