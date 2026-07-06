import { defineConfig } from 'vitest/config';

// Default suite: fast, in-memory unit/integration tests. Excludes the functional
// suite (which needs Docker) — run that with `npm run test:functional`.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/functional/**', 'node_modules/**'],
  },
});
