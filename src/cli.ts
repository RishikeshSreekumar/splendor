import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';
import type { Mode } from './types';
import { evaluate } from './evaluation';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pairs: { type: 'string', default: '3' },
    seed: { type: 'string', default: 'demo' },
    mode: { type: 'string', default: 'ranked' },
    output: { type: 'string' },
    'max-turns': { type: 'string', default: '400' },
    'initial-seconds': { type: 'string', default: '60' },
    'increment-seconds': { type: 'string', default: '1' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'npm run evaluate -- [bot.js ...] [--pairs 10] [--mode ranked|practice] [--seed demo] [--initial-seconds 60] [--increment-seconds 1] [--output results.json]',
  );
  process.exit(0);
}
try {
  const paths = positionals.length ? positionals : ['bots/random', 'bots/greedy'];
  const bots = await Promise.all(
    paths.map(async (path) => ({
      id: basename(path, ''),
      source: await readFile(resolve(path), 'utf8'),
    })),
  );
  const report = await evaluate({
    bots,
    pairs: Number(values.pairs),
    seed: values.seed,
    mode: values.mode as Mode,
    clockConfig: {
      initialMs: Number(values['initial-seconds']) * 1000,
      incrementMs: Number(values['increment-seconds']) * 1000,
    },
    maxTurns: Number(values['max-turns']),
    onGame: (g, n) => {
      process.stderr.write(
        `Game ${n}: ${g.bots.map((b) => b.id).join(' vs ')} — ${g.result.reason}, ${g.scores.join(':')}, ${g.turns} turns\n`,
      );
    },
  });
  console.table(
    report.leaderboard.map((r) => ({
      bot: r.id,
      elo: Math.round(r.elo),
      rated: r.ratedGames,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      faults: r.faults,
      assisted: r.assistedDecisions,
      unrated: r.unratedGames,
      provisional: r.provisional,
    })),
  );
  if (values.output) {
    const path = resolve(values.output);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    console.log(`Saved report and replay logs: ${path}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Evaluation failed');
  process.exitCode = 1;
}
