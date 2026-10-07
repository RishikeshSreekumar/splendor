/** Evaluation fixture layout. Client-safe: no runner or engine imports. */
/** Splendor seats at most four. */
export const TABLE_SIZE = 4;
/** Evaluations of more than three bots play shared four-player tables instead of 1v1 pairs. */
export const SHARED_TABLE_MIN_BOTS = 4;
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return items.flatMap((item, i) =>
    combinations(items.slice(i + 1), size - 1).map((rest) => [item, ...rest]),
  );
}
export const tableSize = (bots: number) =>
  bots < SHARED_TABLE_MIN_BOTS ? 2 : Math.min(TABLE_SIZE, bots);
/** Every table of the cohort; each plays once per seat rotation per round. */
export function fixtureTables<T>(bots: T[]): T[][] {
  return combinations(bots, tableSize(bots.length));
}
export function evaluationGameCount(bots: number, pairs: number) {
  const size = tableSize(bots);
  return fixtureTables(Array.from({ length: bots }, (_, i) => i)).length * size * pairs;
}
