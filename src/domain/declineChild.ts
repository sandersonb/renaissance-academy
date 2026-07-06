/**
 * Decline a child — pure port of users.pm `cleanup_and_coalesce`
 * (declineOffer.pl). Sets DECLINE (or DECL_REENROLL for a returning student),
 * and if the child was wait-listed, frees their Position and coalesces the
 * queue behind them. Also signals clearing of language preference + ChildExtra.
 *
 * Returns the full change set so the adapter applies it in one transaction.
 */
import { RegStatus, isWaitStatus } from './regStatus.js';
import type { Child } from './types.js';

export interface DeclineResult {
  ok: boolean;
  error?: string;
  /** the child's new status */
  to?: RegStatus;
  /** waitlist neighbors whose position shifts up */
  coalesced: { childId: number; position: number }[];
  clearLanguagePreference: boolean;
  clearChildExtra: boolean;
}

export function declineChild(children: readonly Child[], childId: number): DeclineResult {
  const child = children.find((c) => c.childId === childId);
  if (!child) {
    return { ok: false, error: 'Invalid Child_ID', coalesced: [], clearLanguagePreference: false, clearChildExtra: false };
  }
  const isReenroll = /REENROLL/.test(child.regStatus);
  const to = isReenroll ? RegStatus.DECL_REENROLL : RegStatus.DECLINE;

  const coalesced: { childId: number; position: number }[] = [];
  if (isWaitStatus(child.regStatus) && child.position != null) {
    for (const c of children) {
      if (c.grade === child.grade && c.regStatus === child.regStatus && c.position && c.position > child.position) {
        coalesced.push({ childId: c.childId, position: c.position - 1 });
      }
    }
  }
  return { ok: true, to, coalesced, clearLanguagePreference: true, clearChildExtra: true };
}
