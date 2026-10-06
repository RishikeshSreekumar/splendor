import type { QuickJSContext, QuickJSDeferredPromise } from 'quickjs-emscripten';
import { publicFetch, type NetworkRequest, type NetworkResponse } from './network';
export type NetworkTransport = (
  input: NetworkRequest,
  signal: AbortSignal,
) => Promise<NetworkResponse>;
/** One decision's capabilities. Completion never schedules bot code during an opponent's turn. */
export class NetworkBridge {
  private active = false;
  private count = 0;
  private inFlight = 0;
  private deadline = 0;
  private requests = new Map<QuickJSDeferredPromise, AbortController>();
  constructor(
    private vm: QuickJSContext,
    private pump: () => void,
    private fail: (error: unknown) => void,
    private transport: NetworkTransport = publicFetch,
  ) {
    vm.newFunction('__networkRequest', (input) => {
      if (!this.active)
        return { error: vm.newError('Network calls are available only during chooseAction') };
      if (++this.count > 8 || this.inFlight >= 4)
        return { error: vm.newError('Network request limit reached') };
      const text = vm.getString(input);
      if (text.length > 300000) return { error: vm.newError('Request is too large') };
      let request: NetworkRequest;
      try {
        request = JSON.parse(text);
      } catch {
        return { error: vm.newError('Invalid fetch request') };
      }
      const promise = vm.newPromise(),
        controller = new AbortController();
      this.requests.set(promise, controller);
      this.inFlight++;
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(1, Math.ceil(this.deadline - performance.now())),
      );
      void Promise.resolve()
        .then(() => this.transport(request, controller.signal))
        .then(
          (response) => this.settle(promise, JSON.stringify(response), false),
          () =>
            this.settle(
              promise,
              'Network request failed, was blocked, or exceeded its limit',
              true,
            ),
        )
        .catch((error) => this.fail(error))
        .finally(() => {
          clearTimeout(timer);
        });
      // The VM owns this duplicate; the host keeps the original until completion/cancellation.
      return promise.handle.dup();
    }).consume((handle) => vm.setProp(vm.global, '__networkRequest', handle));
    const result = vm.evalCode(`(() => {
      const request = __networkRequest, stringify = JSON.stringify, parse = JSON.parse;
      delete globalThis.__networkRequest;
      globalThis.fetch = async (url, init = {}) => {
        const result = parse(await request(stringify({url,method:init.method,headers:init.headers,body:init.body})));
        let used = false;
        const text = async () => {if(used) throw new Error('Body already consumed'); used=true; return result.body;};
        return {status:result.status,statusText:result.statusText,ok:result.status>=200&&result.status<300,
          headers:{get:name=>result.headers[String(name).toLowerCase()]??null},
          text,json:async()=>parse(await text())};
      };
    })()`);
    if (result.error) {
      result.error.dispose();
      throw new Error('Could not initialize networking');
    }
    result.value.dispose();
  }
  begin(deadline: number) {
    this.end();
    this.active = true;
    this.count = 0;
    this.deadline = deadline;
  }
  private settle(promise: QuickJSDeferredPromise, value: string, error: boolean) {
    this.inFlight--;
    if (!this.active || !this.requests.has(promise)) return;
    if (performance.now() >= this.deadline) {
      this.end();
      this.fail(new Error('TIMEOUT'));
      return;
    }
    this.requests.delete(promise);
    const handle = error ? this.vm.newError(value) : this.vm.newString(value);
    try {
      if (error) promise.reject(handle);
      else promise.resolve(handle);
    } finally {
      handle.dispose();
      promise.dispose();
    }
    try {
      this.pump();
    } catch (error) {
      this.fail(error);
    }
  }
  end() {
    this.active = false;
    for (const [promise, controller] of this.requests) {
      controller.abort();
      promise.dispose();
    }
    this.requests.clear();
  }
}
