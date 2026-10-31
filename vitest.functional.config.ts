import { defineConfig } from 'vitest/config';

// Functional suite: real disposable MySQL 8.4.11, Docker required (no silent skip).
// Single worker; each suite owns its unique container and localhost port.
export default defineConfig({
  test: {
    include: ['test/functional/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 200_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
