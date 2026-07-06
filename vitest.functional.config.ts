import { defineConfig } from 'vitest/config';

// Functional suite: full stack against a real MySQL in Docker. Auto-skips if
// Docker isn't available. Single worker (shared DB container) + long timeouts.
export default defineConfig({
  test: {
    include: ['test/functional/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 200_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
