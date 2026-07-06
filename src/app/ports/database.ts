import type { Repositories } from './repositories.js';

/**
 * Unit-of-work abstraction. `transaction(work)` runs `work` against a
 * transaction-scoped Repositories and commits, or rolls back if it throws —
 * so multi-row writes (change_status, lottery commit, roll-year, notify) are
 * atomic (deviation B2). Read-only callers use `repos` directly.
 */
export interface Database {
  repos: Repositories;
  transaction<T>(work: (tx: Repositories) => Promise<T>): Promise<T>;
}
