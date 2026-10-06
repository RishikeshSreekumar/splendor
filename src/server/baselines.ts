/** Public bots seeded in every deployment, from easiest to strongest. */
export const BASELINES = [
  { file: 'random.js', name: 'Random' },
  { file: 'greedy.js', name: 'Greedy' },
  { file: 'strategist.js', name: 'Strategist' },
] as const;
/** Qualification always plays these fixed opponents, regardless of other public baselines. */
export const QUALIFICATION_BASELINES = ['Random', 'Greedy'] as const;
