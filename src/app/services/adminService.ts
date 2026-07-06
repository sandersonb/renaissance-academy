/**
 * AdminService — the staff console operations (Enrollment.pm: search,
 * show_family, change_status, add_note, waitlist). The status-change rules come
 * from the M1 domain `changeStatus` (matrix + capacity + sibling promotion); this
 * service loads the working set, runs the pure logic, applies the change set, and
 * logs a Note — mirroring change_status_finalize.
 */
import { changeStatus, type RowChange } from '../../domain/changeStatus.js';
import { RegStatus } from '../../domain/regStatus.js';
import type { Child } from '../../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Database } from '../ports/database.js';
import type { ChildRecord, NoteRecord, ParentRecord, Repositories } from '../ports/repositories.js';
import { addDays, today } from '../util/dates.js';

export class AdminError extends Error {}

const toDomain = (c: ChildRecord): Child => ({
  childId: c.childId, parentId: c.parentId, grade: c.gradeNextYear,
  regStatus: c.regStatus, considerations: c.lotteryConsiderations, position: c.position,
});

export interface FamilyView {
  parent: ParentRecord | null;
  children: ChildRecord[];
  notes: NoteRecord[];
}

export class AdminService {
  private repos: Repositories;
  constructor(private db: Database, private config: AppConfig) {
    this.repos = db.repos;
  }

  /** Search students by name, grouped into families (parent + their children). */
  async search(query: string): Promise<{ parent: ParentRecord | null; children: ChildRecord[] }[]> {
    const matches = await this.repos.children.searchByName(query);
    const byParent = new Map<number, ChildRecord[]>();
    for (const c of matches) (byParent.get(c.parentId) ?? byParent.set(c.parentId, []).get(c.parentId)!).push(c);
    const out = [];
    for (const [parentId] of byParent) {
      out.push({
        parent: await this.repos.parents.findById(parentId),
        children: await this.repos.children.findByParent(parentId),
      });
    }
    return out;
  }

  async showFamily(parentId: number): Promise<FamilyView> {
    const [parent, children, notes] = await Promise.all([
      this.repos.parents.findById(parentId),
      this.repos.children.findByParent(parentId),
      this.repos.notes.listByParent(parentId),
    ]);
    return { parent, children, notes };
  }

  /** change_status_finalize: validate + apply the transition and log a Note. */
  async changeStatus(childId: number, target: RegStatus): Promise<{ message: string }> {
    const child = await this.repos.children.findById(childId);
    if (!child) throw new AdminError('No such child');
    const all = (await this.repos.children.all()).map(toDomain);
    const caps = await this.repos.capacity.gradeCaps();
    const res = changeStatus(all, childId, target, caps);
    if (!res.ok) throw new AdminError(res.error ?? 'Change rejected');

    // Apply the whole change set + the Note atomically (B2).
    await this.db.transaction(async (tx) => {
      await this.applyChanges(tx, res.changes);
      await tx.notes.add(child.parentId, res.message ?? `Status changed to ${target}`);
    });
    return { message: res.message ?? 'Updated' };
  }

  private async applyChanges(tx: Repositories, changes: RowChange[]): Promise<void> {
    for (const ch of changes) {
      await tx.children.updateStatus(ch.childId, ch.to, ch.position);
      if (ch.setExpiration) {
        const days = ch.setExpiration === 'offer' ? this.config.offerExpirationDays : this.config.paperworkExpirationDays;
        await tx.children.setExpiration(ch.childId, addDays(today(), days));
      }
      if (ch.clearChildExtra) await tx.survey.clearChildAnswers(ch.childId);
    }
  }

  async addNote(parentId: number, note: string): Promise<void> {
    if (!note.trim()) throw new AdminError('Note cannot be empty');
    await this.repos.notes.add(parentId, note.trim());
  }

  async waitlist(grade?: number): Promise<ChildRecord[]> {
    return this.repos.children.waitlist(grade);
  }
}
