/** Date helpers. `addDays` returns YYYY-MM-DD (the format stored in the DB). */
export function addDays(base: Date, days: number): string {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const today = (): Date => new Date();
