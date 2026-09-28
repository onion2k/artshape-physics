import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // A test is timed out only so that one that never ends is caught. How fast the world steps is the bench's to
    // hold, not this. The heaps poured from seeds take two to four seconds each on a quiet machine, and beside the
    // rest of the files on a busy one, Vitest's own five seconds failed six of them on a run.
    testTimeout: 30_000,
  },
});
