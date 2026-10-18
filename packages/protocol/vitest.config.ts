import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'protocol',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Two at a time on a developer's Mac, which other sessions share; CI keeps Vitest's default.
    maxWorkers: process.env.CI ? undefined : 2,
  },
})

