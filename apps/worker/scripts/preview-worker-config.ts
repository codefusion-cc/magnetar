import { join } from 'node:path'
import { experimental_readRawConfig } from 'wrangler'

// Prints the preview Worker's name and account as a config of their own, for `codefusion-previews url` and `down`,
// which read only a config's top-level `name` and `account_id` and know no Wrangler environments.
const { rawConfig } = experimental_readRawConfig({ config: join(import.meta.dirname, '../wrangler.jsonc') })
const name = rawConfig.env?.preview?.name
if (!name || !rawConfig.account_id) throw new Error('wrangler.jsonc names no preview Worker or account')
console.log(JSON.stringify({ name, account_id: rawConfig.account_id }, null, 2))
