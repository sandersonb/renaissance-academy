/**
 * Reg_Status domain model — the spine of the system (RULES_SPEC §4).
 *
 * Values are the EXACT strings stored in the legacy `Child.Reg_Status` /
 * `Current_Student.Reg_Status` columns, so the new code reads/writes the same
 * schema (additive-only policy: we do not rename these).
 */

export const RegStatus = {
  // Returning-student (re-enrollment) track
  PEND_REENROLL: 'PEND_REENROLL',
  IP_REENROLL: 'IP_REENROLL',
  ACPT_REENROLL: 'ACPT_REENROLL',
  DECL_REENROLL: 'DECL_REENROLL',
  // New-student (lottery) track
  INITIAL: 'INITIAL',
  PEND_OFFER: 'PEND_OFFER',
  OFFER: 'OFFER',
  IP_OFFER: 'IP_OFFER',
  WAIT: 'WAIT',
  SIB_WAIT: 'SIB_WAIT',
  // Convergent / terminal
  DECLINE: 'DECLINE',
  PEND_REGISTER: 'PEND_REGISTER',
  FIN_REGISTER: 'FIN_REGISTER',
  REGISTER: 'REGISTER',
} as const;

export type RegStatus = (typeof RegStatus)[keyof typeof RegStatus];

/** Admin-facing labels (from Enrollment.pm `$humanify`). */
export const HUMANIFY: Record<RegStatus, string> = {
  PEND_REENROLL: '',
  IP_REENROLL: 'Re-enrollment Incomplete',
  ACPT_REENROLL: 'Returning Student',
  DECL_REENROLL: 'Declined Enrollment',
  INITIAL: 'Awaiting lottery',
  PEND_OFFER: 'Offer Pending',
  OFFER: 'Offer Extended',
  IP_OFFER: 'Acceptance in Progress',
  WAIT: 'On Waiting List',
  SIB_WAIT: 'On Sibling Wait List',
  DECLINE: 'Declined',
  PEND_REGISTER: 'Awaiting Paperwork',
  FIN_REGISTER: 'Paperwork Incomplete',
  REGISTER: 'Registered',
};

/**
 * Statuses that consume a seat for capacity math. This is BOTH the admin
 * `grade_used` set (Enrollment.pm) AND, equivalently, the lottery's
 * "current enrollment" set — lottery.pl counts everything NOT IN
 * (DECL_REENROLL, DECLINE, INITIAL, SIB_WAIT, WAIT), which is exactly this set.
 */
export const SEAT_CONSUMING: ReadonlySet<RegStatus> = new Set<RegStatus>([
  RegStatus.ACPT_REENROLL,
  RegStatus.PEND_OFFER,
  RegStatus.OFFER,
  RegStatus.IP_OFFER,
  RegStatus.PEND_REGISTER,
  RegStatus.FIN_REGISTER,
  RegStatus.REGISTER,
]);

export const isWaitStatus = (s: RegStatus): boolean =>
  s === RegStatus.WAIT || s === RegStatus.SIB_WAIT;

/** Lottery_Considerations bitmask (users.pm `validate_considerations`). */
export const Consideration = {
  SIBLING: 1, // sibling currently attends
  PREFERENCE: 2, // parent is a founder/employee
  CURRENT: 4, // student currently attends (drives re-enrollment)
} as const;

export const hasConsideration = (mask: number, bit: number): boolean =>
  (mask & bit) !== 0;

/** Grades K(0)..9. */
export const GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const gradeLabel = (g: number): string => (g === 0 ? 'K' : String(g));
