/**
 * Grade-scoping for survey questions (ExtraTitles.Grade, e.g. "-6-7-8-9-").
 * A null/empty scope means the question applies to all grades.
 */
export function gradeInScope(scope: string | null | undefined, grade: number): boolean {
  if (!scope) return true;
  return scope.includes(`-${grade}-`);
}
