/**
 * The canonical legal-transition matrix (RULES_SPEC §4), ported verbatim from
 * Enrollment.pm `$flow`. This gates MANUAL admin status changes
 * (`change_status`). The lottery engine sets statuses directly and does not
 * consult this matrix (the draw is the authority for INITIAL -> *).
 */
import { RegStatus } from './regStatus.js';

export const FLOW: Readonly<Record<RegStatus, readonly RegStatus[]>> = {
  PEND_REENROLL: [RegStatus.ACPT_REENROLL, RegStatus.DECL_REENROLL],
  ACPT_REENROLL: [RegStatus.DECL_REENROLL],
  // INITIAL -> {PEND_OFFER, SIB_WAIT, WAIT} all happen via the lottery, not the
  // admin matrix. $flow lists PEND_OFFER and SIB_WAIT; kept as-is for parity.
  INITIAL: [RegStatus.PEND_OFFER, RegStatus.SIB_WAIT],
  PEND_OFFER: [RegStatus.OFFER],
  SIB_WAIT: [RegStatus.PEND_OFFER, RegStatus.DECLINE],
  WAIT: [RegStatus.PEND_OFFER, RegStatus.DECLINE],
  OFFER: [RegStatus.PEND_REGISTER, RegStatus.DECLINE],
  PEND_REGISTER: [RegStatus.REGISTER, RegStatus.FIN_REGISTER, RegStatus.DECLINE],
  FIN_REGISTER: [RegStatus.REGISTER, RegStatus.DECLINE],
  REGISTER: [RegStatus.DECLINE],
  // Terminal / not manually advanceable:
  IP_REENROLL: [],
  IP_OFFER: [],
  DECL_REENROLL: [],
  DECLINE: [],
};

export const flowable = (from: RegStatus): readonly RegStatus[] => FLOW[from] ?? [];

export const canTransition = (from: RegStatus, to: RegStatus): boolean =>
  flowable(from).includes(to);
