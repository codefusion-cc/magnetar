import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The build's commit (vite.config.ts), so tests import the app at the top of the file, outside their time limit.
  define: { __APP_COMMIT__: JSON.stringify('') },
  test: {
    name: 'web',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/*.test.ts'],
    // Two at a time on a developer's Mac, which other sessions share; CI keeps Vitest's default.
    maxWorkers: process.env.CI ? undefined : 2,
  },
})

