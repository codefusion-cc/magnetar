# Deploying magnetar.codefusion.cc

The Worker in `apps/worker` serves the website, sign-in, pairing and the relay. After the one-time setup below, every
merge to `main` goes to the preview Worker (preview.magnetar.codefusion.cc) once every check has passed, and to production
(magnetar.codefusion.cc) once the owner approves it in CodeFusion Console.

The commands below run from the repository root.

## 1. Google OAuth client

Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**:

- Application type: **Web application**, name `Magnetar`
- Authorized JavaScript origins: `https://magnetar.codefusion.cc`
- Authorized redirect URIs: `https://magnetar.codefusion.cc/api/auth/google/callback`

The consent screen needs only the `openid`, `email` and `profile` scopes. Put the client id in
`apps/worker/wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID`. It is public; no client secret is used.

## 2. D1 database

The production database `magnetar` exists and its id is in `wrangler.jsonc`. A new migration in
`apps/worker/migrations` goes out with the next deploy, which applies it before the new Worker starts. Migrations only
add: the Worker still running meanwhile must keep working on the new schema.

## 3. CodeFusion Console

The console (codefusion-cc/codefusion-console) lists Magnetar in `config/apps.json` and binds `MAGNETAR_ADMIN` to this
Worker's `ConsoleAdmin` entrypoint. Deploy this Worker first, so the console's deploy binds a service that exists.
Its Deployments page reads this repository with the console's GitHub token, which must include codefusion-cc/magnetar.

## 4. Deploy on approval

On every push to `main`, after the checks and the end-to-end tests pass, the CI workflow runs three jobs:

1. **Deploy preview** deploys the commit to the preview Worker (section 5), with the `staging` environment's token.
2. **Approve production** waits for the owner: the `production-approval` environment has the owner as its required
   reviewer. CodeFusion Console's Deployments page shows what the preview Worker runs that production doesn't, and
   approves this job once the preview Worker still serves that very commit (or approve it on GitHub). A newer merge
   replaces the one waiting, so at most one waits, always for the commit the preview Worker just got. A failed preview
   deploy leaves nothing to approve.
3. **Deploy production** deploys it to production, with the `production` environment's token.

Both deploys are `.github/workflows/deploy-worker.yml`: build the dashboard (its `version.json` names the full commit),
apply the D1 migrations, deploy the Worker, its assets and the `DeviceRelay` Durable Object, and wait until the
website serves the new commit. Each environment deploys one at a time and is never cancelled midway; merges that land
meanwhile wait, and only the newest of them deploys. The custom domain route creates the DNS record in the
`codefusion.cc` zone.

App releases still follow `main` (`release.yml`), whatever production runs: an app released before its Worker change
is approved meets the production Worker before it. The app must keep working with the Worker it may meet, as it must
already while a deploy runs.

CodeFusion Console's Deployments page shows the commit each environment serves, how far behind `main` it is, and the
outcome of the newest deploy (the job's GitHub deployment in the `staging` and `production` environments, linked to
its run).

It needs a Cloudflare API token, once. On dash.cloudflare.com, **My Profile → API Tokens → Create Token**, template
**Edit Cloudflare Workers**, then add **Account · Workers · Editor** (the template's older "Workers Scripts: Edit" alone
is refused) and **Account · D1 · Edit**. Keep the template's zone permissions (the custom domain needs nothing more) and
limit the token to your account. Store it in the `production` environment, which only `main` may deploy to (CodeFusion
Console's Infrastructure → Deploy tokens makes one for each environment instead):

```bash
gh api -X PUT repos/codefusion-cc/magnetar/environments/production --input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' && gh api -X POST repos/codefusion-cc/magnetar/environments/production/deployment-branch-policies -f name=main -f type=branch && gh secret set CLOUDFLARE_API_TOKEN --env production --repo codefusion-cc/magnetar
```

The `production-approval` environment, once: the owner as required reviewer, self-review allowed, `main` only.

```bash
gh api -X PUT repos/codefusion-cc/magnetar/environments/production-approval --input - <<<'{"reviewers":[{"type":"User","id":8079877}],"prevent_self_review":false,"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' && gh api -X POST repos/codefusion-cc/magnetar/environments/production-approval/deployment-branch-policies -f name=main -f type=branch
```

A failed deploy leaves the website on the previous build: fix the cause and merge again, or re-run the job. In an
emergency, deploy the checkout from this Mac, applying a new migration first:

```bash
codefusion-console cloudflare workers:edit,d1:edit,domains:edit -- sh -c 'pnpm --filter @magnetar/worker run migrate:remote && pnpm --filter @magnetar/worker run deploy'
```

## 5. The preview Worker and branch Previews

The preview Worker is `magnetar-preview` at https://preview.magnetar.codefusion.cc, `env.preview` of
`apps/worker/wrangler.jsonc` (`APP_ENV` `preview`): its own D1 database (`magnetar-preview`), DeviceRelay objects, rate
limits, secrets and Google OAuth client. The same `deploy` job deploys every merge to `main` there, migrations first,
before production. The console's Deployments page lists it as Preview and each open pull request's Preview under it.

Every pull request from this repository gets a Worker Preview of the preview Worker at
`https://<branch>.preview.magnetar.codefusion.cc` (the name as `@codefusion-cc/previews` makes it: `feat/Login` →
`feat-login`): the `preview` job in `ci.yml` makes the branch's own database `magnetar-previews-<name>` on its first
push, applies the migrations and uploads the Preview on every push. Each Preview has its own DeviceRelay objects
too. When the pull request closes, `preview-cleanup.yml` deletes the Preview and its database. Neither is indexed:
outside production the Worker marks every page `noindex`.

### Sign-in

The preview Worker and its Previews use their own OAuth client, `Magnetar staging`, never production's: a page holding a token for
production's client could sign its holder in to magnetar.codefusion.cc, and Previews run code nobody merged. It was
made like production's (section 1):

- Authorized JavaScript origins: `https://preview.magnetar.codefusion.cc`
- Authorized redirect URIs: `https://preview.magnetar.codefusion.cc/api/auth/google/callback`

Its client id is `GOOGLE_CLIENT_ID` in `env.preview` of `wrangler.jsonc`, both in `vars` and in `previews.vars`
(`apps/worker/environments.test.ts` keeps them equal and unlike production's). Google takes no wildcard addresses, so a
Preview signs in through the preview Worker's callback (`GOOGLE_CALLBACK_ORIGIN`), which returns the token to
`https://<branch>.preview.magnetar.codefusion.cc/login` only because the preview Worker sets `AUTH_PREVIEW_PARENTS`.
Production never does. A Preview's own API takes calls only from its own address.

### Tokens and secrets

Each environment deploys with a Cloudflare token of its own, made by CodeFusion Console (Infrastructure → Deploy
tokens, or `deploy_token_provision` with config `apps/worker/wrangler.jsonc`) for the GitHub environments `staging` (the
preview Worker) and `preview` (branch Previews). The preview token also makes and deletes the branch databases (D1
edit).

The preview Worker's secrets (`VAPID_PRIVATE_KEY` for browser notifications, optionally `GITHUB_TOKEN`) are set on the
console's Secrets page or with its `set_secrets` tool, never in a chat. Previews take theirs from the Preview base
config:

```bash
cd apps/worker && codefusion-console cloudflare workers:edit -- sh -c 'pnpm exec codefusion-vapid | pnpm exec wrangler preview base-config secret put VAPID_PRIVATE_KEY --env preview'
```

### The app on the preview Worker

A dev build pairs with the preview Worker when run with its address, and a data folder of its own, so its link never mixes with
the one your installed app has:

```bash
MAGNETAR_CLOUD_URL=https://preview.magnetar.codefusion.cc MAGNETAR_DATA_DIRECTORY="$HOME/.magnetar-staging" MAGNETAR_DOWNLOAD_FOLDER="$HOME/Downloads/magnetar-staging" pnpm run dev:client
```

A branch Preview's address works the same way. The app remembers which Worker it paired with and sends that link's
device token to no other: started against another Worker, it stays offline and says so. A released build ignores
`MAGNETAR_CLOUD_URL` unless it names a Worker on this computer (`apps/client/src/config.rs`), so the released app only
ever talks to magnetar.codefusion.cc.

## Cloudflare from this Mac

This Mac has no `wrangler login`: its token reaches the whole account. Every local Cloudflare command runs through the
CodeFusion Console CLI instead, `codefusion-console cloudflare <scope>[,<scope>…] [--ttl 30m] -- <command>`, which mints
a token with exactly those scopes for that one command (two hours unless `--ttl` says otherwise), gives it to the
command as `CLOUDFLARE_API_TOKEN` with `CLOUDFLARE_ACCOUNT_ID`, and deletes it when the command exits. A token with an
`:edit` scope waits for the owner's passkey tap on Dispatch before the command starts. A command with a pipe goes
through `sh -c '…'`. Once on the Mac: `pnpm add -g @codefusion-cc/console && codefusion-console relay install`.

| Command | Scopes |
|---|---|
| `pnpm --filter @magnetar/worker run migrate:remote` | `d1:edit` |
| `pnpm --filter @magnetar/worker run deploy` | `workers:edit,d1:edit,domains:edit` (the `DB` binding, the custom domain) |
| `pnpm --filter @magnetar/worker run migrate:preview`, `pnpm --filter @magnetar/worker run deploy:preview` | as for production |
| `pnpm exec wrangler preview delete --env preview --name <name>` | `workers:edit` |
| `pnpm exec wrangler secret put …` | `workers:edit` |
| `pnpm exec wrangler tail` | `tail:read` |

## Release signing

Installed apps only take an update whose `SHA256SUMS.txt` is signed by the key their build compiled in. Each flavour
has its own pair: Magnetar `apps/client/release-public-key.txt`, Magnetar Preview `apps/client/preview-public-key.txt`.
Each build refuses to compile in the other's key, and `sign-release.ts` refuses a secret that is not the private half
of the key the app trusts. A new pair comes from CodeFusion Console: `key.make` (an `infra_change`, kind `ed25519`,
target this repository's `release-signing` or `preview-signing` environment, `rotate` to replace a key) makes it on the
owner's tap, writes the private key as `RELEASE_SIGNING_KEY` or `PREVIEW_SIGNING_KEY`, and answers with only the public
key, which goes into the public key file in a pull request. Nobody sees or pastes the private key. Only `main` deploys
to either environment, and the Sign jobs install nothing, so a pull request's own workflow never reads a signing key
(`packages/release/signing.test.ts` holds every workflow to this). The secret belongs to the environment only: a
repository secret of the same name would be readable everywhere, so delete it if one exists (Settings, Secrets and
variables, Actions).

Keep no other copy: a new pair means installs of the builds before it don't install the next update by themselves
(they open the release page instead), so each of them is downloaded once by hand. Merge the new public key only once
the secret is set: a release signs before it tags, so a missing or wrong key fails the run without using up the
version.

## Code signing

Optional: without these secrets releases are ad-hoc signed (macOS asks users to confirm the first launch, Windows
SmartScreen warns). They are secrets of the `code-signing` environment, which only `main` may use and only the Build
jobs of `release.yml` and `preview-app.yml` read (`signing.test.ts` checks that too). Set them through CodeFusion
Console, never as repository secrets. The six macOS ones go in together: with only some of them set, the build stops
rather than ship an app that is signed but not notarized.

| Secret | What it is |
|---|---|
| `MACOS_CERTIFICATE` | The Developer ID Application certificate and key, exported as .p12, base64 |
| `MACOS_CERTIFICATE_PASSWORD` | The .p12's password |
| `MACOS_SIGNING_IDENTITY` | Its name, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | For notarization; the password is an app-specific password from appleid.apple.com |
| `WINDOWS_CERTIFICATE` | A code-signing certificate as .pfx, base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | The .pfx's password |

The macOS bundle is signed with the hardened runtime, notarized, stapled and checked with `spctl` before it is
zipped. Changing from ad-hoc to Developer ID signing is fine for updates: an ad-hoc installation checks the bundle
identifier. Once the installed app is certificate-signed, it takes only a replacement signed with a Developer ID
Application certificate Apple issued to the same team (read from the installed app's own signature) and that Gatekeeper
accepts, never an ad-hoc one or one signed for development; a new team means installing once by hand.

## Browser notifications (Web Push)

Once:

```bash
cd apps/worker && codefusion-console cloudflare workers:edit -- sh -c 'pnpm exec codefusion-vapid | pnpm exec wrangler secret put VAPID_PRIVATE_KEY'
```

The Worker derives the public key browsers subscribe with. For `wrangler dev`, put the printed key in
`apps/worker/.dev.vars` as `VAPID_PRIVATE_KEY='…'`. Without it the website doesn't offer browser notifications. A new
key makes every browser subscribe again.

## Downloads on the website

The first page, an account without computers and `/about` offer the app for the visitor's system, from the latest GitHub release of
`RELEASES_REPO` (a Worker var, `codefusion-cc/magnetar` by default). Asset names must stay
`Magnetar-<version>-<macos|windows|linux>-<arm64|x64>[.zip|.exe]`. The same list answers `/about`'s changelog and the
"an update is waiting" line under a computer on Your computers; GitHub is asked at most every ten minutes per data centre.

GitHub allows 60 anonymous API calls an hour per address, which Cloudflare's addresses share with other Workers. A
token raises that to 5,000: a fine-grained GitHub token with no permissions (public repositories only), stored once
with `codefusion-console cloudflare workers:edit -- pnpm exec wrangler secret put GITHUB_TOKEN` from `apps/worker`. Without
it, a rate-limited lookup shows "GitHub's limit is reached" and is asked again on the next visit.
