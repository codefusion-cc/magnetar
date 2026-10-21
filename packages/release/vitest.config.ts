import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'release',
    root: import.meta.dirname,
    environment: 'node',
    include: ['*.test.ts'],
    // Two at a time on a developer's Mac, which other sessions share; CI keeps Vitest's default.
    maxWorkers: process.env.CI ? undefined : 2,
  },
})

