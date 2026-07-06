/**
 * Parse the current-student roster CSV for the annual import (RULES_SPEC §2.1).
 * Fixes the two legacy importer bugs:
 *   - the header row is skipped (legacy `LOAD DATA` lacked IGNORE 1 LINES);
 *   - birth dates are parsed as M/D/YYYY (legacy used STR_TO_DATE %y, a 2-digit
 *     year, against 4-digit-year data — silent corruption).
 *
 * Expected columns (header names are ignored; order matters):
 *   Last, First, Middle, Sex, Birth Date (M/D/YYYY), Grade Next Year
 */
export interface RosterRow {
  lastName: string;
  firstName: string;
  middleName: string | null;
  gender: string;
  dob: string; // YYYY-MM-DD
  grade: number; // NEXT-YEAR grade (1..9 for a returning student)
}

export interface RosterParseResult {
  rows: RosterRow[];
  errors: { line: number; message: string }[];
}

/** Split one CSV line, honoring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parse M/D/YYYY (or M/D/YY with a 30-pivot) -> YYYY-MM-DD, or null. */
export function parseRosterDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  let [, mo, d, y] = m as unknown as [string, string, string, string];
  let year = Number(y);
  if (y.length === 2) year = year < 30 ? 2000 + year : 1900 + year;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseRoster(csv: string): RosterParseResult {
  const rows: RosterRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);

  // Skip the header row (the legacy importer bug was NOT skipping it).
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const lineNo = i + 1;
    if (cols.length < 6) { errors.push({ line: lineNo, message: 'expected 6 columns' }); continue; }
    const [lastName, firstName, middleName, gender, birth, gradeRaw] = cols;
    const dob = parseRosterDate(birth!);
    if (!dob) { errors.push({ line: lineNo, message: `invalid birth date '${birth}'` }); continue; }
    const grade = Number(gradeRaw);
    if (!Number.isInteger(grade) || grade < 1 || grade > 9) {
      errors.push({ line: lineNo, message: `invalid next-year grade '${gradeRaw}' (must be 1-9)` });
      continue;
    }
    if (!lastName || !firstName) { errors.push({ line: lineNo, message: 'missing name' }); continue; }
    rows.push({ lastName, firstName, middleName: middleName || null, gender: gender || '', dob, grade });
  }
  return { rows, errors };
}
