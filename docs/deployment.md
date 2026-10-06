# Hosted deployment

The application uses Vercel for Next.js, Modal's JavaScript SDK for game execution, Supabase for authentication/PostgreSQL, and a small authenticated Cloudflare Worker in front of private R2 objects. All application and infrastructure code is TypeScript. Domain: `splendor.sudipmondal.co.in`.

## Configuration

Copy `.env.example` to ignored `.env.local` and provide the server credentials. Only the Supabase URL and anon key are returned by `/api/config`; every other key remains server-only. Do not prefix service credentials with `NEXT_PUBLIC_`. `PLATFORM_TOKEN` must match the R2 gateway's Worker secret. `CRON_SECRET` protects the recovery endpoint. `APP_ORIGIN` must be the browser-facing origin. `BOT_SECRETS_KEY` is a 32-byte key encoded as 64 hex characters for AES-256-GCM. Preserve it across deployments; rotation requires decrypting/re-encrypting existing bot keys. Apply migration 0004 before deploying the networking release.

**Multi-bot practice release order:** (1) apply `202610070001_practice_seats.sql`; (2) run `scripts/seed-cloud.ts` to add the Strategist baseline; (3) rebuild the Modal image and commit `modal-image.json`, because the practice runner protocol changed; (4) deploy the web app. The new runner still accepts the old single-opponent payload, and sessions created before the migration keep playing Greedy.

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

The GitHub repository is `sudip-mondal-2002/splendor`, connected to the existing Vercel project `splendor-strategy-lab` in `sudip-mondals-projects`. Pushes to `main` automatically build and publish the Next.js site at `splendor.sudipmondal.co.in`. Other branches receive Vercel preview deployments. Git deployments are explicitly enabled in `vercel.json`; no deployment token is stored in GitHub.

The `Quality checks` GitHub Actions workflow runs types, lint, tests, and formatting on pushes and pull requests. These checks run alongside Vercel builds; they are not a deployment approval gate. Production secrets remain in the existing Vercel project settings. Preview environments need their own service configuration before cloud features can be used.

This automation deploys the Next.js application. Changes to the Modal runner still require building and committing a new `modal-image.json` as described above before pushing the web release; SQL migrations and the R2 gateway retain their separate release steps.

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
