import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { createOrigin } from "../origin/src/index";
import { createHandler, type Env } from "../src/handler";

/**
 * A fresh edge + origin pair per test: its own cache, its own origin counter
 * and a clock that only moves when the test says so.
 */
export function setup(options: { delayMs?: number; env?: Partial<Env> } = {}) {
  const origin = createOrigin({ delayMs: options.delayMs ?? 5 });
  const originRequests: Request[] = [];
  let clock = Date.UTC(2026, 0, 1);
  const cacheName = `test-${crypto.randomUUID()}`;

  const handler = createHandler({ now: () => clock, openCache: () => caches.open(cacheName) });
  const env: Env = {
    ORIGIN: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        originRequests.push(request.clone());
        return origin.fetch(request);
      },
    } as Fetcher,
    ALLOWED_ORIGINS: "https://shop.example, https://blog.example",
    ...options.env,
  };

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const ctx = createExecutionContext();
    const response = await handler(new Request(`https://edge.test${path}`, init), env, ctx);
    // Let background work (cache writes, revalidation) finish before asserting.
    await waitOnExecutionContext(ctx);
    return response;
  }

  return {
    origin,
    originRequests,
    request,
    env,
    advance(seconds: number) {
      clock += seconds * 1000;
    },
  };
}
