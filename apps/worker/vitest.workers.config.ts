import { join } from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
import { unstable_readConfig } from 'wrangler'

// The Worker in workerd with the dev environment's bindings (local D1, the relay, rate limits,
// dev sign-in) and the schema from migrations/, applied in test/setup.ts. The dev environment has
// no CodeFusion Console binding on purpose; wrangler would warn about that for every file.
process.env.WRANGLER_LOG ??= 'error'

const configPath = join(import.meta.dirname, 'wrangler.jsonc')
// Pairing starts are limited as in production rather than the dev environment's hundred a minute, so the test that
// hits the limit sends eleven, not a hundred and one (each one a pairing written to D1). Every other test pairs from
// an address of its own (test/client.ts freshIp).
const pairLimiter = unstable_readConfig({ config: configPath }).ratelimits.find(limiter => limiter.name === 'PAIR_LIMITER')!

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    wrangler: { configPath, environment: 'dev' },
    // Google sign-in is configured with the client id of the fake Google in test/auth.test.ts.
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations(join(import.meta.dirname, 'migrations')),
        TEST_PAIR_LIMIT: pairLimiter.simple.limit,
        GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
      },
      ratelimits: { PAIR_LIMITER: { namespace_id: pairLimiter.namespace_id, simple: pairLimiter.simple } },
    },
  })],
  test: {
    name: 'worker',
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    // Each test starts workerd sockets and D1 writes; Windows runners take seconds for the heavier ones.
    testTimeout: 30_000,
    // Two at a time on a developer's Mac, which other sessions share; CI keeps Vitest's default.
    maxWorkers: process.env.CI ? undefined : 2,
  },
}))
