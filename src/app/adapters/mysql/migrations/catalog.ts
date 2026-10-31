import type { Connection } from 'mysql2/promise';

export type Queryable = Pick<Connection, 'query'>;
export interface CatalogQuestion {
  id: number;
  brief: string;
  lottery: number;
  inputType: string;
  sortOrder: number;
  legacyChoices?: string[];
}
export interface Catalog { questions: CatalogQuestion[] }
type Row = Record<string, unknown>;

export async function rows(db: Queryable, sql: string, values: unknown[] = []): Promise<Row[]> {
  const [result] = await db.query(sql, values);
  return result as Row[];
}

export function parseCatalog(raw: string): Catalog {
  const value = JSON.parse(raw) as Catalog;
  const types = new Set(['single_select', 'multi_select', 'text', 'textarea', 'date']);
  if (!Array.isArray(value.questions) || !value.questions.length) throw new Error('Invalid survey manifest');
  const ids = new Set<number>();
  for (const q of value.questions) {
    if (!Number.isInteger(q.id) || q.id < 1 || ids.has(q.id) || typeof q.brief !== 'string' ||
        ![0, 1].includes(q.lottery) || !types.has(q.inputType) || !Number.isInteger(q.sortOrder) ||
        q.sortOrder < 0 || (q.legacyChoices !== undefined && (!Array.isArray(q.legacyChoices) ||
          !q.legacyChoices.length || q.legacyChoices.some((c) => typeof c !== 'string' || !c || c.length > 255) ||
          new Set(q.legacyChoices).size !== q.legacyChoices.length))) throw new Error('Invalid survey manifest');
    ids.add(q.id);
  }
  return value;
}

/** Read metadata/reference definitions only; never student/parent answers. */
export async function catalogConflicts(db: Queryable, catalog: Catalog, forUpdate = false): Promise<string[]> {
  const columns = await rows(db, "SELECT COLUMN_NAME AS n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='ExtraTitles'");
  const hasMetadata = ['input_type', 'sort_order'].every((name) => columns.some((c) => c.n === name));
  const suffix = forUpdate ? ' FOR UPDATE' : '';
  const questions = await rows(db, `SELECT Title_ID, Brief, Lottery_question${hasMetadata ? ', input_type, sort_order' : ''} FROM ExtraTitles${suffix}`);
  const options = await rows(db, `SELECT Title_ID, Value FROM Extra${suffix}`);
  const issues: string[] = [];
  const tables = await rows(db, "SELECT TABLE_NAME AS n, ENGINE AS e FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('Extra','ExtraTitles')");
  if (tables.length !== 2 || tables.some((t) => t.e !== 'InnoDB')) issues.push('Survey backfill requires InnoDB reference tables.');
  const storage = (await rows(db, "SELECT DATA_TYPE AS t, CHARACTER_MAXIMUM_LENGTH AS n, CHARACTER_SET_NAME AS c, COLLATION_NAME AS collation_name, IS_NULLABLE AS nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='Extra' AND column_name='Value'"))[0];
  if (!storage || storage.t !== 'varchar' || Number(storage.n) > 255 ||
      !['utf8', 'utf8mb3'].includes(String(storage.c)) ||
      !['utf8_unicode_ci', 'utf8mb3_unicode_ci'].includes(String(storage.collation_name)) || storage.nullable !== 'YES') {
    issues.push('Extra.Value storage differs from the reviewed widening; refusing possible shrink/charset/constraint conversion');
  }
  const expected = new Map(catalog.questions.map((q) => [q.id, q]));
  for (const actual of questions) {
    const id = Number(actual.Title_ID);
    const q = expected.get(id);
    if (!q) { issues.push(`Unreviewed survey title ID ${id}`); continue; }
    if (actual.Brief !== q.brief || Number(actual.Lottery_question) !== q.lottery) issues.push(`Survey mapping conflict at title ID ${id}`);
    if (hasMetadata && (!['text', q.inputType].includes(String(actual.input_type)) ||
        actual.sort_order == null || ![0, q.sortOrder].includes(Number(actual.sort_order)))) issues.push(`Existing rendering metadata differs at title ID ${id}`);
    if (q.legacyChoices && options.some((o) => Number(o.Title_ID) === id && !q.legacyChoices!.includes(String(o.Value)))) {
      issues.push(`Unreviewed stored legacy choices at title ID ${id}`);
    }
    expected.delete(id);
  }
  for (const id of expected.keys()) issues.push(`Missing reviewed survey title ID ${id}`);
  return issues;
}

/** Caller owns a DML transaction and holds the migration lock. */
export async function backfillCatalog(db: Queryable, catalog: Catalog): Promise<void> {
  const issues = await catalogConflicts(db, catalog, true);
  if (issues.length) throw new Error('Survey changed after preflight');
  for (const q of catalog.questions) {
    const [result] = await db.query(
      "UPDATE ExtraTitles SET input_type=?, sort_order=? WHERE Title_ID=? AND input_type IN ('text',?) AND sort_order IN (0,?) AND BINARY Brief=BINARY ? AND Lottery_question=?",
      [q.inputType, q.sortOrder, q.id, q.inputType, q.sortOrder, q.brief, q.lottery],
    );
    if ((result as { affectedRows: number }).affectedRows !== 1) throw new Error('Survey changed during backfill');
    for (const choice of q.legacyChoices ?? []) {
      const existing = await rows(db, 'SELECT Extra_ID FROM Extra WHERE Title_ID=? AND BINARY Value=BINARY ?', [q.id, choice]);
      if (!existing.length) await db.query('INSERT INTO Extra (Title_ID, Value) VALUES (?,?)', [q.id, choice]);
    }
  }
}
