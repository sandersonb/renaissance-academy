import { rows, type Queryable } from './catalog.js';

export const PREVIEW_DATABASE = 'enrollment_preview';
export const PREVIEW_HISTORY = 'enrollment_preview_bootstrap';

/** Called only when the marker table exists. No writes or application-data reads. */
export async function previewCompletionIssue(db: Queryable, database: string, lockName: string): Promise<string | null> {
  if (database !== PREVIEW_DATABASE) return 'Preview bootstrap marker found outside enrollment_preview; refusing copied preview state.';
  const records = await rows(db, `SELECT id, checksum, state, phase,
    (owner_nonce=@ra_preview_bootstrap_nonce AND IS_USED_LOCK(?)=CONNECTION_ID()) AS active_owner
    FROM ${PREVIEW_HISTORY}`, [lockName]);
  const record = records[0];
  if (records.length !== 1 || Number(record?.id) !== 1 || !/^[a-f0-9]{64}$/.test(String(record?.checksum))) {
    return 'Preview bootstrap history is incomplete or unrecognized; operator review required.';
  }
  if (record!.state === 'applied' && record!.phase === 'complete') return null;
  // Only the active initializer's own connection can run the normal migrations
  // inside the encompassing bootstrap. Reconnecting cannot recreate this context.
  if (record!.state === 'running' && Number(record!.active_owner) === 1) return null;
  return 'Preview bootstrap is incomplete, interrupted or failed; no automatic replay. Operator review required.';
}
