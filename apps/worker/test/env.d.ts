// Types `env` and `exports` from cloudflare:workers for the tests, as `wrangler types` would.
declare namespace Cloudflare {
  type WorkerEnv = import('../src/env.ts').Env
  interface Env extends WorkerEnv {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
    /** Pairing starts allowed a minute from one address: production's (vitest.config.ts). */
    TEST_PAIR_LIMIT: number
  }
  interface GlobalProps {
    mainModule: typeof import('../src/index.ts')
  }
}
