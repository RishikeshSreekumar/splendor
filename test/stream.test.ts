import test from 'node:test';
import assert from 'node:assert/strict';
import { streamJson } from '../src/server/http';
test('streamed report JSON preserves Unicode across large chunk boundaries', async () => {
  const report = { value: '💎'.repeat(200000) };
  assert.deepEqual(await streamJson(report).json(), report);
});
