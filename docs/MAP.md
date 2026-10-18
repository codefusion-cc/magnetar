# Repo map

Magnetar: a single-executable torrent/media downloader (Rust) with a React dashboard, usable locally or from any browser through an end-to-end encrypted relay on a Cloudflare Worker (magnetar.codefusion.cc).
Design and security are in [ARCHITECTURE.md](ARCHITECTURE.md), deploy and signing in [DEPLOY.md](DEPLOY.md), dev setup in [README.md](../README.md) "Development". Agent rules are in [CLAUDE.md](../CLAUDE.md).

## Layout

- `packages/protocol/src/` the wire contract in TypeScript: `rpc.ts` (methods), `model.ts` (types), `e2e.ts` (crypto), `relay.ts`, `device-names.json` (reserved site words), `scrub.ts` (error-report scrubbing), `linkCode.ts` (the typed link code), `e2e-vector.json`, `link-code-vector.json`, `webpush-vector.json` and `scrub-vector.json` (test vectors the Rust side shares).
- `apps/client/` the Rust app (crate `magnetar`). `src/rpc.rs` RPC handlers, `src/api/actions.rs` actions shared by REST, MCP and dashboard, `src/http/` local server (REST, MCP, assets, streaming), `src/downloads/` torrent engine and manager, `src/search/` providers, `src/series/` show monitoring (`episodes.rs`: each task's episodes and their state), `src/remote/` relay link, browser keys and push (`protocol/link_code.rs`: the typed link code), `src/system/folders.rs` the Files browser (only the download folder and folders added on the device; `api/save_folder.rs` confines folders agents and relayed browsers choose), `src/db.rs` SQLite and migrations, `src/settings.rs`, `src/updates/`. Tests in `apps/client/tests/`. `package.ts` builds the release executable.
- `apps/web/src/` the dashboard, one build for both transports: `LocalApp.tsx` (in the app), `cloud/` (website: login, devices, pairing), `device/` (pages of one device), `lib/` (`rpcClient.ts`, `localConnection.ts`, `relayConnection.ts`, `keyStore.ts`, `linkDevice.ts`, `linkInput.ts`, `qrScanner.ts`, `installedApp.ts`), `ui/`, `i18n/` (8 catalogs), `features/` (features page), `looks/infall.ts` (the look: colours, fonts, radii, the star's `--mg-*` tokens, as `@codefusion-cc/ui` roles), `fonts.css` (bundled woff2 faces, no font host).
- `apps/worker/src/` Cloudflare Worker: `index.ts` routes and `serveSinglePageApp`, `relay.ts` (`DeviceRelay` Durable Object), `auth.ts` (Google sign-in, sessions), `devices.ts`, `push.ts`, `releases.ts`, `console/`. `migrations/` D1 SQL, `test/` workerd tests, `wrangler.jsonc` (production at the top, the preview Worker and its branch Previews in `env.preview`, `env.dev` for tests), `scripts/preview-worker-config.ts` (the preview Worker's name and account for `codefusion-previews`), `environments.test.ts` (the config, in Node).
- `apps/e2e/` Playwright (`tests/*.e2e.ts`) and `features/screenshots.ts`. `scripts/` release signing and `release-version.ts`. `Cargo.toml` is the workspace root; `vendor/librqbit-bencode` patches librqbit's bencode parser (`[patch.crates-io]`) until upstream releases the fix (`docs/upstream/`).

## Main flows

- Local: browser -> `localhost:47820` (`apps/client/src/http/`) -> WebSocket `/ws` -> `apps/client/src/rpc.rs` -> `downloads/`, `search/`, SQLite.
- Remote: browser -> Worker `/api/*` and WebSocket -> `DeviceRelay` DO (`apps/worker/src/relay.ts`) -> device WebSocket from `apps/client/src/remote/`. Frames after the handshake are sealed; the Worker never sees plaintext.
- Saving a download: `device/useDownloadFlow.tsx` and `lib/downloadFlow.ts` open the folder browser (`device/components/folders.tsx`) when the `askDownloadFolder` setting is on; `downloads.start` and `downloads.addTorrentPath` take a `folder`. The Downloads page keeps its view in `?view=active|finished|all` (`lib/downloadViews.ts`) and its sort per device in the browser (`lib/downloadSort.ts`).
- Pairing and sign-in: `apps/web/src/cloud/` -> `apps/worker/src/auth.ts` and `devices.ts` -> D1 (`DB`).
- New RPC method: `packages/protocol/src/rpc.ts` -> `apps/client/src/rpc.rs` (+ `api/actions.rs` if agents can do it); the serde mirror is `apps/client/src/protocol/model.rs`.
- Website pages: any path -> Worker `serveSinglePageApp` -> the one dashboard page; device pages live at `/<device name>/...`.

## @codefusion-cc packages

`workers-http` (SPA serving, errors), `workers-crypto` (tokens), `base58` (readable ids), `google-sign-in`, `web-push`, `console` (telemetry, admin pages), `app-update`, `theme`, `ui` (the look's roles as Tailwind classes; daisyUI's colours read them until the redesign's sweep) and `i18n` (dashboard), `features-page` (`/features`).

## Tests and checks

- Everything: `pnpm run check` (lint + typecheck + tests). Parts: `pnpm run lint` (oxlint, clippy `-D warnings`, `cargo fmt --check`), `pnpm run typecheck` (every workspace).
- Unit (Node: `packages/*`, `apps/web`): `pnpm exec vitest run --project node --maxWorkers=2`. Worker (workerd, local D1 and real relay): `pnpm exec vitest run apps/worker`.
- CI runners: the jobs that move to the monorepo read `vars.CI_RUNNER_LIGHT` or `CI_RUNNER_HEAVY`; only the client's macOS, Windows and release jobs keep GitHub's labels (`docs/RUNNERS.md`, checked by `scripts/runners.test.ts`).
- `pnpm run build:web` ends with `scripts/guard-preview.ts` (tested by `scripts/guard-preview.test.ts`): link-preview tags in `apps/web/index.html`, `og-v1.jpg` and `robots.txt` in `dist/`. A new preview image gets a new file name.
- Rust: `export PATH="/opt/homebrew/opt/rustup/bin:$PATH" && cargo test --locked -j4`.
- E2E: `pnpm run e2e` (Playwright drives the real app; needs `cargo` on `PATH`, `pnpm run build:web` and `pnpm --filter @magnetar/e2e exec playwright install chromium`).

## Deploy and migrations

- Merge to `main`: after checks and e2e, `.github/workflows/ci.yml` deploys the preview Worker (`env.preview` of `apps/worker/wrangler.jsonc`, preview.magnetar.codefusion.cc), waits for the owner's approval (`approve-production`, environment `production-approval`, given in CodeFusion Console), then deploys production (its top level, magnetar.codefusion.cc); both through `deploy-worker.yml` (build, D1 migrations, `wrangler deploy`), each with its own D1, relay and secrets. `apps/worker/environments.test.ts` keeps them apart.
- Pull requests: the `preview` job uploads a Worker Preview at `https://<branch>.preview.magnetar.codefusion.cc` with a database of its own (`@codefusion-cc/previews`); `preview-cleanup.yml` deletes both when the pull request closes. Previews sign in through the preview Worker's Google callback. Locally: `pnpm run dev:worker`.
- A dev build of the app talks to the preview Worker or a Preview with `MAGNETAR_CLOUD_URL`; released builds only to production or loopback (`apps/client/src/config.rs`), and a link never sends its token to another Worker (`remote/service.rs` `device_token`).
- Worker D1 migrations: add `apps/worker/migrations/NNNN_name.sql`; the old Worker must keep working during the deploy. App-side SQLite migrations are in `apps/client/src/db.rs` (append only).
- App release: every merge to `main` that changes the app is released as the next patch (`release` job in `ci.yml` calls `.github/workflows/release.yml`; `scripts/release-version.ts` picks the version from the latest `v*` tag and skips docs/tests/CI-only merges, and the Worker deploy shows the same version). A minor or major is a hand-pushed `vX.Y.0` tag. No file holds the version: the tag is the version, and the website's build and `package.ts` read it through `release-version.ts display`. While `.github/release-hold` exists, merges are not released (the Worker still deploys); the merge that deletes it releases everything since the last tag. PR titles become the "What's new" notes.

## Gotchas

- The contract exists twice (zod in `packages/protocol`, serde in `apps/client/src/protocol`), the E2E handshake and the error scrubber twice; change both and keep the vector files passing.
- Never share one `CARGO_TARGET_DIR` between worktrees. Dev ports: app 47820, Vite 5173, Worker 8790.
- Test runs of the app need `MAGNETAR_DATA_DIRECTORY` and `MAGNETAR_DOWNLOAD_FOLDER`, or they touch the real folders.
- Never delete torrent files through librqbit; use `downloads::engine::delete_files`.
- Check torrent bytes from outside with `downloads::bencode::check` before anything parses them (the parser recurses per nesting level).
- New user strings go into all eight `apps/web/src/i18n/*.json`; visible features also into `apps/web/src/features/outline.ts` and `content/`.
- Scripts are TypeScript run by Node directly: erasable syntax only, relative imports with `.ts`.
- Keep `not_found_handling` out of `apps/worker/wrangler.jsonc`.
