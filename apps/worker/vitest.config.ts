import { defineConfig } from 'vitest/config'

// The Worker's tests run in workerd (vitest.workers.config.ts); environments.test.ts reads the Wrangler config in Node.
export default defineConfig({
  test: {
    projects: [
      // Two at a time on a developer's Mac, which other sessions share; CI keeps Vitest's default.
      { test: { name: 'worker-config', root: import.meta.dirname, environment: 'node', include: ['*.test.ts'], maxWorkers: process.env.CI ? undefined : 2 } },
      './vitest.workers.config.ts',
    ],
  },
})
