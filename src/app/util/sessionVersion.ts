export const MAX_SESSION_VERSION = 0xffffffff;

export function validSessionVersion(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SESSION_VERSION;
}

export function nextSessionVersion(value: number): number {
  if (!validSessionVersion(value) || value === MAX_SESSION_VERSION) {
    throw new Error('Session version exhausted or invalid; operator review required.');
  }
  return value + 1;
}
