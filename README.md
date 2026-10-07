# Splendor Strategy Lab

[![Quality checks](https://github.com/sudip-mondal-2002/splendor/actions/workflows/ci.yml/badge.svg)](https://github.com/sudip-mondal-2002/splendor/actions/workflows/ci.yml)

[Live application](https://splendor.sudipmondal.co.in) · [Deployment guide](docs/deployment.md). Pushes to `main` automatically deploy to production through the connected Vercel project.

A Next.js application for learning vanilla Splendor, writing JavaScript players, and comparing strategies under equal time controls. Application code, game rules, runner, tests, and scripts use TypeScript; submissions may be JavaScript modules or TypeScript folders with a root `index.ts`.

## Run

Node.js **22.13+** is required. The bundled SQLite API is experimental on Node 22; Node 24 LTS is also supported. Local SQLite mode needs one long-lived Node instance with a writable disk. Hosted mode uses Vercel, Modal, Supabase and R2.

```sh
npm ci
npm run dev
# Open http://127.0.0.1:3000

npm run check       # strict TypeScript, ESLint, and all tests
npm run build
npm start           # production Next.js server on loopback
```

The application contains:

- **Evaluation arena:** choose 2–6 saved bot versions, configure clocks and paired fixtures, and compare against public and submitted bots.
- **Practice table:** a Board Game Arena–style table. Click gems, cards, decks and nobles to play untimed against one to three bots (Random, Greedy, the stronger Strategist, or your own qualified bots), each on its own 60 + 1 clock. Bot turns animate one by one with a game log; every click is checked against the authoritative rules engine.
- **Bot workshop:** write/import a module or upload a folder, inspect public bot source, and qualify an immutable version in four games against public baselines.
- **Evaluation reports:** persisted cohort Elo, faults, assistance counts, and verified move-by-move replay with each bot's recorded clock.
- **System design:** eight rendered architecture/UML views, also maintained as Mermaid source in [docs/architecture.md](docs/architecture.md).

The hosted application is at **https://splendor.sudipmondal.co.in**. Sign in to submit bots, run evaluations, and use the practice table. Qualified bots and their source are public; pending/failed versions and evaluation reports belong to their owner. Every bot and player has one rating on the global [Leaderboard](#ratings); each evaluation report also rates its own cohort from 1200.

Without `SPLENDOR_STORAGE=supabase`, the app uses local SQLite at `storage/lab.sqlite` (override with `SPLENDOR_DB_PATH`) and binds to loopback. Local practice and CLI evaluation remain available without an account, but submitting a bot always requires a verified Supabase login. Configure hosted mode to enable account sign-in and submission in the workshop; see `.env.example` and [deployment notes](docs/deployment.md).

## Folder submissions

Upload a folder whose root contains `index.ts`, exporting a default subclass of `SplendorPlayer`. Relative TypeScript/JavaScript/JSON imports are bundled in memory. Only the virtual `splendor` SDK may be imported externally. Package installation, scripts, Node built-ins, network imports, traversal paths, hidden files, and `node_modules` are rejected. Limits: 64 files, 128 KiB per file, 1 MiB total source, and 128 KiB compiled output. See `examples/folder-player`.

Qualification and assisted benchmarks run with Modal's **512 MiB hard memory limit**; strict evaluations use **2048 MiB**. Every bot also has a 64 MiB QuickJS heap limit. Qualification does not guarantee future memory use; all runs enforce the same bot limit. Sandboxes have one CPU and outbound networking. Bots can call public HTTPS endpoints through a bounded `fetch` bridge; platform credentials are never passed into the sandbox.

## Independent clocks

Each bot starts each game with **60 seconds**, plus **1 second after a complete turn**. Both values are configurable in the arena and CLI. These are Fischer increments: unused time accumulates, with no cap on remaining time.

- Each seat owns its own balance. Only the active bot's decision call consumes it.
- A main action, excess-token return, and noble selection belong to the **same turn**. They share the clock and receive only one increment after the final required decision.
- Synchronous computation, promise waiting, serialization, and worker communication are charged as wall time. The host uses a monotonic clock and rejects late responses even if its timeout callback was delayed.
- Rules validation, observation construction, queue delay, and the opponent's thinking are excluded. Bot loading has a separate one-second execution allowance and five-second local worker startup deadline (15 seconds in Modal), before receiving game state.
- Zero time means timeout immediately; an increment cannot rescue an expired clock.
- Rejected actions, timeouts, and turns requiring practice assistance do not earn increments.
- Clock settings are recorded in every game/report. Every new game and reversed-seat fixture starts with fresh clocks and player instances.

Async bots may call LLMs or other public HTTPS APIs. The entire DNS, connection, provider computation and response wait consumes the active bot’s existing clock. A late response cannot rescue an expired clock. Requests still outstanding when a decision ends are aborted, and late results never resume the bot between turns. A remote service may continue its own computation after disconnection; the platform clock cannot enforce a remote compute budget. External services can change their answers, so only recorded actions and state hashes are replayed deterministically.

## Write a player

JavaScript submissions import the virtual SDK provided by the runner. The SDK implementation is a TypeScript abstract class compiled into QuickJS.

```js
import { SplendorPlayer } from 'splendor';

export default class MyPlayer extends SplendorPlayer {
  chooseAction(view) {
    const buys = this.getLegalActions(view, 'buy');
    return buys[0] ?? this.chooseRandomAction(view);
  }
}
```

`chooseAction(view)` may return an `Action` or `Promise<Action>`. Instance fields persist for one game. `Math.random()` is seeded. There are no filesystem, socket, timer, real-clock, or arbitrary npm imports. Public HTTPS is exposed through `fetch`. A never-resolving promise consumes the remaining clock and times out.

The observation provides public players, market, nobles, bank, deck counts, your reserved cards, legal actions, and `view.clock.remainingMs[view.you]`. Opponents' blind reservations and deck order stay private. Face-up reservations remain known.

Generic helpers on `SplendorPlayer`:

| Helper                                    | Purpose                                                         |
| ----------------------------------------- | --------------------------------------------------------------- |
| `getSelf(view)`                           | Your visible player state                                       |
| `getLegalActions(view, type?)`            | Legal decisions, optionally filtered by action type             |
| `getBonuses(player)`, `getPoints(player)` | Derived game totals                                             |
| `getCost(card, player)`                   | Cost after permanent bonuses                                    |
| `getPayments(card, player)`               | Every exact legal payment, including optional gold substitution |
| `canAfford(card, player)`                 | Affordability using tokens and bonuses                          |
| `getAffordableCards(view)`                | Affordable market and own reserved cards                        |
| `getEligibleNobles(view, player?)`        | Noble eligibility based only on bonuses                         |
| `chooseRandomAction(view)`                | A seeded random legal action                                    |

The declaration file `src/sdk.d.ts` describes the virtual module for editors. Token/payment objects contain all six color keys, including zeros. Returning a supplied legal action is the easiest way to honor the protocol. Qualification requires four complete, fault-free candidate games against the public baselines. Later faults are still adjudicated by each evaluation.

## Networked and LLM bots

Use `await fetch(url, { method, headers, body })` inside `chooseAction`. The response supports `ok`, `status`, `statusText`, `headers.get(name)`, `text()` and `json()`. Requests use public HTTPS on port 443. Headers are plain string records and bodies are strings. Redirects are returned without following them. Streaming bodies, WebSockets, arbitrary TCP, browser APIs and provider npm SDKs are not exposed; call provider HTTP APIs directly. Requests are limited to 256 KiB, responses to 1 MiB, four concurrent requests and eight total requests per decision. Initialization has no network access.

The workshop’s optional **Private API key** is read with `this.getSecret('API_KEY')`. It is AES-256-GCM encrypted in Supabase, separately from source/R2 artifacts. Bots with stored keys are private and runnable only by their owner; this prevents someone else charging requests to that key. Enter the key again for each new version. The API also accepts a `secrets` string map (up to 16 names and 16 KiB). Private credentials are supported in hosted mode; trusted CLI integrations may pass a per-bot `secrets` map directly to the runner. Never embed keys in public source.

See `examples/llm-player.ts` for a Chat Completions-style template. Replace its endpoint/model and adapt response parsing to your provider. Provider fees belong to the supplied key; the platform does not fund requests. Network errors can be caught by the bot for its own fallback; uncaught errors follow the ordinary strict/practice fault policy.

## Faults and evaluation

| Situation                                                  | Assisted practice                                                          | Strict evaluation                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| Invalid action                                             | Log and substitute a seeded legal fallback; ask again at the next decision | Forfeit                              |
| Runtime fault, timeout, exhausted memory, malformed output | Disable the bot for the game; use logged fallback                          | Forfeit                              |
| One bot cannot initialize                                  | Use fallback                                                               | That bot forfeits                    |
| Both bots fail initialization                              | Use fallback                                                               | Unrated invalid match                |
| Turn cap or no legal action                                | Explicit incomplete result                                                 | Unrated paired fixture               |
| Internal engine failure                                    | Fail the job                                                               | Fail the job, never penalize the bot |

The simulator's fallback is seeded random legal play. The human practice table uses the first legal action for any bot that fails, for the rest of that game. Both paths mark assistance and withhold increments for assisted turns. Practice-mode evaluations never change ratings; human practice games do (see [Ratings](#ratings)).

With two or three bots, every pair of opponents plays two independently seeded deals with swapped seats. With four or more, bots play together at four-player tables: every 4-bot combination plays one game per seat rotation (each bot starts once), each with a fresh deal. Fresh deals prevent networked bots reusing hidden cards learned in the previous game. Legacy reports retain their original repeated-deal policy. Report Elo averages each pair's placement results over the fixture with K=32, split across opponents at larger tables; an unfinished fixture never produces a rating update. In a ranked multiplayer game a faulting bot forfeits and ranks last (earlier forfeits lower) while the others play on; its seat moves by fallback. When one healthy bot remains, the game ends. Rows remain provisional below 30 rated games. Use many independent seeds and diverse opponents; a small cohort is not an absolute skill measurement.

Reports store rules version, source hashes, actions, faults, elapsed decision time, and clock snapshots. Full deal seeds are withheld from the UI until the entire evaluation finishes. Replay reconstructs game states and verifies their hashes without rerunning bot code. Timing is recorded evidence, not deterministically remeasured. Format 2 adds clock data; the core replay reader also accepts original format 1 artifacts. Hashes detect accidental changes but do not authenticate an artifact.

## Ratings

The **Leaderboard** shows one global Elo for every qualified bot and every human player, all starting at 1200. Ranked evaluation games (each one, not just whole fixtures) and practice games update it. Each game compares every pair of players by finishing order (points, then fewer cards) with K=32 split across opponents, so a four-player game weighs as much as a 1v1 game. Past a 500-point gap, a game cannot widen it: the favourite gains nothing and the underdog loses nothing, while upsets still count. Abandoning a practice game, or replacing it with a new one, is free before your third turn and afterwards counts as a loss to every bot at the table. Unfinished games are never dropped silently: after a week idle they are abandoned by the same rule. Each evaluation and game is applied exactly once. Player names on the ladder are pseudonymous.

## AI agents (MCP)

Claude, Codex and other MCP clients can do everything the web app does: read the bot guide, submit and qualify bots, run evaluations and read their games, and play practice games. The endpoint is `/api/mcp` (Streamable HTTP). In hosted mode, sign in, open **Account → AI agent access**, and create a personal access token; it is shown once and can be revoked there.

```sh
claude mcp add --transport http splendor https://splendor.sudipmondal.co.in/api/mcp --header "Authorization: Bearer spl_…"
```

```toml
# ~/.codex/config.toml — export SPLENDOR_TOKEN=spl_… before starting Codex
[mcp_servers.splendor]
url = "https://splendor.sudipmondal.co.in/api/mcp"
bearer_token_env_var = "SPLENDOR_TOKEN"
```

Tools: `get_account`, `get_bot_guide`, `get_leaderboard`, `list_bots`, `get_bot`, `submit_bot`, `list_evaluations`, `start_evaluation`, `get_evaluation`, `get_evaluation_game`, `get_game`, `start_game`, `play_move`, `abandon_game`. Bots may be named (`"Greedy"`) instead of passing IDs. `play_move` takes an index into `legalActions`; bot replies run before it returns. `get_bot` and `get_evaluation` accept `waitSeconds` so agents need not poll quickly. Local mode serves the same endpoint without a token, except bot submission, which always needs a hosted account.

**Limits.** Each account has one unfinished practice game; `get_game` resumes it in either the browser or an agent, and `start_game` with `abandonExisting` replaces it. Evaluation launches and bot submissions are token-bucket limited per account and per IP (3 per 15 minutes), on top of 2 concurrent and 20 daily evaluations. A refused call returns 429 with `Retry-After`; calling again before then doubles the wait, up to a day. Practice starts, moves and status reads have separate, more generous limits.

## CLI and verification

```sh
npm run evaluate -- examples/my-player.js bots/random.js bots/greedy.js --pairs 3 --initial-seconds 60 --increment-seconds 1 --output results/benchmark.json
npm run evaluate -- examples/my-player.js bots/greedy.js --mode practice --pairs 1
npm run verify:data
```

The last command uses TypeScript to compare all 90 cards against two pinned transcriptions and the ten noble requirements against a pinned inventory. It requires network access. Tests run locally, including seeded 2–4-player games, conservation invariants, hidden information, final-round/tiebreak cases, SDK behavior, hostile bots, fake-time clock tests, storage, HTTP boundaries, and replay corruption.

Rules follow the [publisher's base-game rulebook](https://cdn.svc.asmodee.net/production-spacecowboys/uploads/2025/10/SCSPL01EN_SPLENDOR_RULES_LIGHT.pdf). No expansions, Splendor Duel rules, artwork, or new game actions are introduced. [Data provenance](docs/data-provenance.md) records the reference sources. A no-action position and the 400-turn cap stop the evaluator as incomplete, rather than inventing a pass or victory condition.

## Architecture and limits

See [the UML design](docs/architecture.md) for domain classes, runner/clock classes, timed interaction sequence, turn states, application components, and API contracts. [Platform status](docs/platform-plan.md) distinguishes this implementation from a future public service.

Application code remains one Next.js/TypeScript project. Modal executes a compiled TypeScript runner using its JavaScript SDK; the small Cloudflare Worker provides authenticated R2 access. There is no Python application service or Express backend. Workers are built into `.runtime` before development, builds, CLI runs and tests. Rebuild and publish the pinned Modal image after changing rules, SDK, sandbox or runner code.

Run `npm run check` and `npm run build` before deployment. Rules review and regression tests remain ongoing: no test suite establishes absolute absence of bugs. Automatic matchmaking and platform-funded provider billing are not implemented.
