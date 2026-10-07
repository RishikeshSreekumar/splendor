# Hosted deployment

The application uses Vercel for Next.js, Modal's JavaScript SDK for game execution, Supabase for authentication/PostgreSQL, and a small authenticated Cloudflare Worker in front of private R2 objects. All application and infrastructure code is TypeScript. Domain: `splendor.sudipmondal.co.in`.

## Configuration

Copy `.env.example` to ignored `.env.local` and provide the server credentials. Only the Supabase URL and anon key are returned by `/api/config`; every other key remains server-only. Do not prefix service credentials with `NEXT_PUBLIC_`. `PLATFORM_TOKEN` must match the R2 gateway's Worker secret. `CRON_SECRET` protects the recovery endpoint. `APP_ORIGIN` must be the browser-facing origin. `BOT_SECRETS_KEY` is a 32-byte key encoded as 64 hex characters for AES-256-GCM. Preserve it across deployments; rotation requires decrypting/re-encrypting existing bot keys. Apply migration 0004 before deploying the networking release.

**Multi-bot practice release order:** (1) apply `20261006202519_practice_seats.sql`; (2) run `scripts/seed-cloud.ts` to add the Strategist baseline; (3) rebuild the Modal image and commit `modal-image.json`, because the practice runner protocol changed; (4) deploy the web app. The new runner still accepts the old single-opponent payload, and sessions created before the migration keep playing Greedy.

**Global ladder release order:** (1) apply `20261007115110_global_ratings.sql`; (2) rebuild the Modal image and commit `modal-image.json`, because evaluations of four or more bots now play shared tables and games record placements; (3) deploy the web app. Until the image is rebuilt, old runners still produce 1v1 reports; the ladder rates them from their winners, but four-plus-bot jobs show a game count that does not match.

**MCP and rate-limit release order:** apply `20261007115054_mcp_tokens_rate_limits.sql` before deploying the web app. Every evaluation, bot and practice route calls the new `splendor_rate_limit` RPC and the new `splendor_create_practice` signature, so they fail until it is applied. No runner image change is needed.

## Automated release

Every push to `main` runs `.github/workflows/deploy.yml`, which performs the release orders above on its own:

1. **Checks**: the `Quality checks` workflow (types, lint, tests, formatting).
2. **Supabase migrations**: `supabase db push` applies new files in `supabase/migrations`. File versions match the project's migration history (`supabase_migrations.schema_migrations`), so name new files with a later `YYYYMMDDHHMMSS_` prefix and never edit an applied one.
3. **Modal runner image** (in parallel with 2): `scripts/build-modal-image.ts --if-changed` rebuilds only when the bundled runtime changed (its hash is stored in `modal-image.json`), then `scripts/verify-modal.ts` plays baseline games at 512 and 2048 MiB and a shared-table practice turn. A new image is committed back to `main` with `[skip ci]`.
4. **Vercel production**: once both succeed, the app is built and deployed with the verified `modal-image.json`. `vercel.json` disables Git auto-deploys for `main` so the site cannot go live ahead of its schema or runner; other branches still get preview deployments.

Runs queue and never cancel each other. Run the workflow manually with **Rebuild the Modal image** to force a fresh image. Required repository secrets, stored by `scripts/setup-github-secrets.sh` (it reads Modal credentials from `.env.local` and prompts for the rest without echoing):

| Secret                                 | Source                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `SUPABASE_DB_URL`                      | Supabase → Connect → Session pooler URI, with the database password |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | The Modal token in `.env.local`                                     |
| `VERCEL_TOKEN`                         | vercel.com/account/tokens, scoped to `sudip-mondals-projects`       |

Runtime secrets stay in the Vercel project settings; the workflow pulls them during the build.

Apply the SQL files in `supabase/migrations` in order. The tables have RLS enabled and no direct browser grants. Backend routes verify user tokens with Supabase and enforce ownership. RPCs reserve account quotas under a transaction advisory lock. Seed public versions with:

```sh
node --env-file=.env.local --import tsx scripts/seed-cloud.ts
```

Supabase Auth's Site URL is `https://splendor.sudipmondal.co.in/account`. Configure custom SMTP under Authentication → Emails → SMTP Settings before opening registration to the general public. The default email service permits only project-team recipients; email confirmation remains enabled. No email-provider credentials are included in this repository.

## Runner release

Authenticate Modal using the intended personal/workspace profile. Build from the same checkout as the frontend:

```sh
npm run build:runtime
MODAL_PROFILE=sudip-mondal-2002 npx tsx scripts/build-modal-image.ts
MODAL_PROFILE=sudip-mondal-2002 npx tsx scripts/verify-modal.ts
```

The image ID is written to `modal-image.json`. Deploy that file with the frontend. An optional `MODAL_IMAGE_ID` environment value overrides it. Every sandbox requests and caps one CPU, allows outbound networking, and enforces `memoryLimitMiB` equal to its reservation: 512 for practice/qualification, 2048 for strict evaluations. The trusted Node coordinator has a 192 MiB old-space cap; each QuickJS bot has a separate 64 MiB heap limit. Code, inputs and outputs are bounded. Platform credentials are never passed into game sandboxes. Each private bot receives only its own configured provider keys. Public HTTPS is gated by the trusted bridge inside its worker.

An allocation probe is available in `scripts/verify-modal-limit.ts`; its observed timeout is not evidence of an OOM kill. The production memory limit is enforced through Modal's sandbox API. Normal full games were verified on both profiles.

## Storage and web release

The GitHub repository is `sudip-mondal-2002/splendor`, connected to the existing Vercel project `splendor-strategy-lab` in `sudip-mondals-projects`. Production deploys come from the Deploy workflow (see Automated release); other branches receive Vercel preview deployments. The `Quality checks` workflow runs on pull requests and non-`main` pushes, and gates the production release. Preview environments need their own service configuration before cloud features can be used. The R2 gateway keeps its separate release step.

`cloudflare/wrangler.jsonc` binds the private `splendor-artifacts` R2 bucket. Set the Worker secret without committing it, then deploy the gateway:

```sh
npx wrangler secret put PLATFORM_TOKEN --config cloudflare/wrangler.jsonc
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

Set the environment variables from `.env.example` in the Vercel production project. `scripts/configure-vercel.ts` copies the recognized values from local process environment through stdin to the authenticated CLI. It does not print values. Then:

```sh
npm run check
npm run build
npx vercel deploy --prod --yes
```

DNS uses the Vercel-provided CNAME for the subdomain. `.vercelignore` excludes local credentials, SQLite storage and QA artifacts. Keep the Modal image and web deployment version in sync after engine changes.

## Operations and verification

Normal UI polling reconciles persisted sandbox IDs into complete R2 reports. Vercel's daily authenticated cron performs abandoned-run recovery and temporary-board cleanup. Jobs have a 30-minute hard execution deadline. A launch interrupted before its sandbox ID is saved fails after two minutes; any orphan execution still has the platform deadline. Failed and incomplete evaluations never partially update Elo.

Per account: 20 submissions/day, 20 evaluations/day, two pending qualifications, two active evaluations, and two practice boards. Practice-board creation is transactional. These limits do not provide a global spending ceiling; configure provider budgets and monitor usage for public rollout.

`scripts/verify-cloud.ts` creates a disposable confirmed QA account and writes ignored `.env.qa` with mode 0600. `scripts/verify-cloud-flow.ts` has `submit`, `evaluate`, `result`, `practice`, and `boundaries` phases; set `QA_BASE_URL` to target a deployment. Never upload or commit `.env.qa`. Public signup delivery needs a real configured SMTP provider and is a separate check.

Current checks cover folder bundling/import boundaries, seeded game invariants, clocks and faults, real 512/2048 MiB games, full cloud qualification, cloud evaluation/replay, a Modal practice response, and unauthenticated API/storage rejection. See the UML and ownership contracts in [architecture.md](architecture.md).

Verify outbound networking with `node --env-file=.env.local --import tsx scripts/verify-network.ts`. It plays two full games at each memory profile, with a bot that calls a public HTTPS endpoint before choosing its first action and checks an isolated test-only credential. Provider calls require owner-supplied API keys and are not charged to a platform account.
