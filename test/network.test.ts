import test from 'node:test';
import assert from 'node:assert/strict';
import { getQuickJS } from 'quickjs-emscripten';
import { NetworkBridge, type NetworkTransport } from '../src/network-bridge';
import { isPublicAddress, validateNetworkRequest, publicFetch } from '../src/network';
import { BotRunner } from '../src/sandbox';
import { createGame, observe } from '../src/engine';

test('public egress rejects private, mapped, reserved and metadata addresses', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '224.1.2.3',
    '198.18.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
    assert.equal(isPublicAddress(ip), true, ip);
  await assert.rejects(
    publicFetch({ url: 'https://localhost' }, new AbortController().signal),
    /Private/,
  );
});
test('request validation prevents alternate protocols, credentials, ports, header injection and oversized data', () => {
  for (const url of [
    'http://example.com',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'https://example.com:8080',
    'https://2130706433',
    'https://[::1]',
  ])
    assert.throws(() => validateNetworkRequest({ url }));
  for (const headers of [
    { host: 'localhost' },
    { 'content-length': '1' },
    { authorization: 'x\r\nHost: localhost' },
    { 'proxy-authorization': 'x' },
  ])
    assert.throws(() => validateNetworkRequest({ url: 'https://example.com', headers }));
  assert.throws(() =>
    validateNetworkRequest({
      url: 'https://example.com',
      method: 'POST',
      body: '💎'.repeat(70000),
    }),
  );
  assert.equal(
    validateNetworkRequest({
      url: 'https://example.com',
      method: 'POST',
      headers: { Authorization: 'Bearer owner-key' },
      body: '{}',
    }).method,
    'POST',
  );
});
async function bridgeRun(
  transport: NetworkTransport,
  exercise: (
    vm: ReturnType<Awaited<ReturnType<typeof getQuickJS>>['newContext']>,
    bridge: NetworkBridge,
  ) => Promise<void>,
) {
  const vm = (await getQuickJS()).newContext();
  const bridge = new NetworkBridge(
    vm,
    () => {
      const r = vm.runtime.executePendingJobs();
      if (r.error) {
        r.error.dispose();
        throw new Error('Jobs failed');
      }
    },
    (error) => {
      throw error;
    },
    transport,
  );
  try {
    await exercise(vm, bridge);
  } finally {
    bridge.end();
    vm.dispose();
  }
}
test('fetch resumes async bot code and supports LLM-style POST, status, headers and JSON', async () => {
  await bridgeRun(
    async (input) => {
      assert.equal(input.method, 'POST');
      assert.equal(input.headers?.Authorization, 'Bearer test');
      return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"index":2}',
      };
    },
    async (vm, bridge) => {
      bridge.begin(performance.now() + 1000);
      const evaluated = vm.unwrapResult(
        vm.evalCode(
          `(async()=>{const r=await fetch('https://example.com',{method:'POST',headers:{Authorization:'Bearer test'},body:'{}'});return [r.ok,r.status,r.headers.get('Content-Type'),(await r.json()).index]})()`,
        ),
      );
      const result = await vm.resolvePromise(evaluated);
      const value = vm.unwrapResult(result);
      try {
        assert.deepEqual(vm.dump(value), [true, 200, 'application/json', 2]);
      } finally {
        value.dispose();
        evaluated.dispose();
      }
    },
  );
});
test('networking cannot run during initialization or continue after a completed decision', async () => {
  let calls = 0,
    aborted = false;
  await bridgeRun(
    async (_input, signal) => {
      calls++;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        }),
      );
    },
    async (vm, bridge) => {
      const initial = vm.unwrapResult(vm.evalCode("fetch('https://example.com').catch(()=>true)"));
      const pending = vm.resolvePromise(initial);
      vm.runtime.executePendingJobs();
      const v = vm.unwrapResult(await pending);
      assert.equal(vm.dump(v), true);
      v.dispose();
      initial.dispose();
      assert.equal(calls, 0);
      bridge.begin(performance.now() + 1000);
      vm.unwrapResult(vm.evalCode("fetch('https://example.com')")).dispose();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 1);
      bridge.end();
      assert.equal(aborted, true);
      await new Promise((resolve) => setImmediate(resolve));
    },
  );
});
test('sandbox fetch blocks private addresses and exposes only its own configured secret', async () => {
  const code =
    "import {SplendorPlayer} from 'splendor';export default class B extends SplendorPlayer{async chooseAction(){let blocked=false;try{await fetch('https://127.0.0.1')}catch{blocked=true}return {blocked,key:this.getSecret('API_KEY'),platform:this.getSecret('SUPABASE_SERVICE_ROLE_KEY')??null}}}";
  const runner = new BotRunner(code, {}, { API_KEY: 'own-test-key' });
  try {
    assert.deepEqual(await runner.chooseAction(observe(createGame())), {
      blocked: true,
      key: 'own-test-key',
      platform: null,
    });
  } finally {
    await runner.close();
  }
});

test('late network replies fail at the decision deadline without resuming bot code', async () => {
  const vm = (await getQuickJS()).newContext();
  let timeout: unknown;
  const bridge = new NetworkBridge(
    vm,
    () => {
      vm.runtime.executePendingJobs();
    },
    (error) => {
      timeout = error;
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: 200, statusText: 'OK', headers: {}, body: 'ok' };
    },
  );
  try {
    bridge.begin(performance.now() + 5);
    vm.unwrapResult(
      vm.evalCode(
        "globalThis.resumed=false; fetch('https://example.com').then(()=>{resumed=true})",
      ),
    ).dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.match(String(timeout), /TIMEOUT/);
    const value = vm.unwrapResult(vm.evalCode('resumed'));
    assert.equal(vm.dump(value), false);
    value.dispose();
  } finally {
    bridge.end();
    vm.dispose();
  }
});

test('parallel network requests are capped per decision', async () => {
  let calls = 0;
  await bridgeRun(
    async () => {
      calls++;
      return new Promise(() => {});
    },
    async (vm, bridge) => {
      bridge.begin(performance.now() + 1000);
      vm.unwrapResult(
        vm.evalCode("for(let i=0;i<10;i++) fetch('https://example.com').catch(()=>{});"),
      ).dispose();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 4);
      bridge.end();
      bridge.begin(performance.now() + 1000);
      vm.unwrapResult(vm.evalCode("fetch('https://example.com').catch(()=>{})")).dispose();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 4, 'canceling a turn must not permit an unbounded host request backlog');
    },
  );
});

test('a completed request releases its slot before resuming a bot that starts another', async () => {
  const responses: ((value: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  }) => void)[] = [];
  await bridgeRun(
    async () => new Promise((resolve) => responses.push(resolve)),
    async (vm, bridge) => {
      bridge.begin(performance.now() + 1000);
      vm.unwrapResult(
        vm.evalCode(
          "fetch('https://example.com').then(()=>fetch('https://example.com/next')).catch(()=>{});for(let i=0;i<3;i++)fetch('https://example.com').catch(()=>{});",
        ),
      ).dispose();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(responses.length, 4);
      responses[0]({ status: 200, statusText: 'OK', headers: {}, body: 'ok' });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(responses.length, 5);
      vm.unwrapResult(vm.evalCode("fetch('https://example.com/extra').catch(()=>{})")).dispose();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(responses.length, 5, 'only one slot was released');
    },
  );
});
