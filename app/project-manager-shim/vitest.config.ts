import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The `watch` tests in `src/__tests__/fs.test.ts` drive real filesystem events and real timers,
    // which stay a little timing-sensitive on shared CI runners even with `watcher.ready`. Retry a
    // couple of times before failing the run.
    retry: 2,
  },
})
