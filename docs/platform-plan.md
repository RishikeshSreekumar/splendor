# Platform status

Implemented: vanilla 2–4-player rules, abstract bot SDK, folder bundling, public baselines, independent configurable clocks, paired two-player Elo evaluations, assisted practice, reports and verified replay, eight architecture diagrams, Supabase authentication/ownership/atomic quotas, R2 artifacts, Modal resource isolation, bounded outbound HTTPS, and encrypted private bot API keys. The Next.js application deploys to Vercel at the requested domain.

Qualification requires four fault-free candidate games in 512 MiB. Strict evaluation uses 2048 MiB. Per-bot QuickJS heap limits remain enforced in both. This is a bounded compatibility check, not proof of future behavior. Reports are finalized as a whole; partial fixtures do not update ratings. Each report's cohort starts at Elo 1200; the global ladder carries ratings across evaluations and practice games.

Public email signup still requires a custom SMTP sender in Supabase. Email verification is retained. See [deployment notes](deployment.md).

Future work: a persistent global rating ladder, matchmaking, rating uncertainty, multiplayer rankings, platform-funded provider billing, and broader independent rules audits. LLM and other public HTTPS calls are supported and charged against each bot’s clock. Keyed bot versions are private and owner-run; keyless bots remain available publicly. Account quotas mitigate ordinary overuse; provider-level spend limits and monitoring are still operational responsibilities.

The implemented UML and failure model are in [architecture.md](architecture.md).
