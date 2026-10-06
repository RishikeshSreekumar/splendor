import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, COLORS, NOBLES } from '../src/catalog';
import type { Card, Color } from '../src/types';
const urls = [
  'https://raw.githubusercontent.com/bouk/splendimax/5ffcb148ee0093e3b47f612b04a1927301ff13ee/Splendor%20Cards.csv',
  'https://raw.githubusercontent.com/seal256/splendor/263abc066c563a1c89dba4bdc408446a20ad9d1d/assets/cards.csv',
];
async function csv(url: string): Promise<Record<string, string>[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Source request failed: ${response.status}`);
  const [head, ...lines] = (await response.text()).trim().split(/\r?\n/),
    keys = head.split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
}
const [a, b] = await Promise.all(urls.map(csv));
const codes: Record<Color, string> = { white: 'w', blue: 'b', green: 'g', red: 'r', black: 'k' };
const first = a.map((r) => ({
  tier: Number(r.Level),
  bonus: r.Color.toLowerCase(),
  points: Number(r.PV),
  cost: Object.fromEntries(COLORS.map((c) => [c, Number(r[c[0].toUpperCase() + c.slice(1)])])),
}));
const second = b.map((r) => ({
  tier: Number(r.level),
  bonus: COLORS.find((c) => codes[c] === r.gem),
  points: Number(r.points),
  cost: Object.fromEntries(COLORS.map((c) => [c, Number(r[codes[c]])])),
}));
const canonical = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).sort();
assert.deepEqual(canonical(first), canonical(second));
assert.deepEqual(
  CARDS,
  first.map((r, i) => ({ id: `c${String(i + 1).padStart(2, '0')}`, ...r })),
);
const nobleResponse = await fetch(
  'https://raw.githubusercontent.com/seal256/splendor/263abc066c563a1c89dba4bdc408446a20ad9d1d/pysplendor/splendor.py',
  { signal: AbortSignal.timeout(30000) },
);
assert.ok(nobleResponse.ok);
const line = (await nobleResponse.text()).split('\n').find((l) => l.startsWith('NOBLES ='))!;
const costs = [...line.matchAll(/\[3\|([^\]]+)\]/g)].map((m) =>
  Object.fromEntries(
    COLORS.map((c) => [c, Number(m[1].match(new RegExp(`${codes[c]}(\\d+)`))?.[1] ?? 0)]),
  ),
);
assert.deepEqual(canonical(costs), canonical(NOBLES.map((n) => n.cost)));
assert.equal((JSON.parse(await readFile('data/cards.json', 'utf8')) as Card[]).length, 90);
console.log(
  'Verified all 90 cards against two pinned sources and all 10 nobles against the pinned noble inventory.',
);
