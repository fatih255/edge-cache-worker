import { normalizeCacheKey } from "./cache-key";
import { handleDemo } from "./demo";
import { parseAllowlist, preflight, withEdgeHeaders } from "./headers";
import { matchRoute, type RoutePolicy } from "./policy";

export interface Env {
  /** Service binding to the origin Worker. */
  ORIGIN: Fetcher;
  /** Comma-separated list of origins allowed to read cross-origin responses. */
  ALLOWED_ORIGINS?: string;
  /** "on" serves the demo page at /__demo. Leave unset in production. */
  DEMO_PAGE?: string;
}

export interface HandlerOptions {
  /** Clock in milliseconds. Tests pass a fake one. */
  now?: () => number;
  /** Cache used for stored responses. Defaults to a named Cache API cache. */
  openCache?: () => Promise<Cache>;
}

export type CacheStatus = "HIT" | "MISS" | "STALE" | "BYPASS";

interface OriginResult {
  status: number;
  headers: Headers;
  body: ArrayBuffer;
}

interface Inflight {
  /** Resolves when the origin answered. Every waiting request reads this. */
  result: Promise<OriginResult>;
  /** Resolves when the answer is in the cache. */
  stored: Promise<void>;
}

const STORED_AT = "x-edge-stored-at";

// Headers that would make one visitor's response leak into another's, or split
// the cache in ways the key doesn't account for.
const DROP_FROM_ORIGIN = ["set-cookie", "vary"];

export function createHandler(options: HandlerOptions = {}) {
  const now = options.now ?? Date.now;
  const openCache = options.openCache ?? (() => caches.open("edge-cache-worker"));

  // Requests for the same key that arrive while the origin is still answering
  // wait for that one origin fetch instead of starting their own. This map is
  // per isolate: two isolates (or two data centers) can each fetch once.
  const inflight = new Map<string, Inflight>();

  async function fetchOrigin(key: string, env: Env): Promise<OriginResult> {
    // Only the normalized URL goes to the origin. Cookies, auth, user agent and
    // language headers stay behind, so the origin can't vary a shared response on them.
    const response = await env.ORIGIN.fetch(new Request(key, { headers: { "user-agent": "edge-cache-worker" } }));
    const headers = new Headers(response.headers);
    for (const name of DROP_FROM_ORIGIN) headers.delete(name);
    return { status: response.status, headers, body: await response.arrayBuffer() };
  }

  function refresh(key: string, policy: RoutePolicy, env: Env, cache: Cache): Inflight {
    const existing = inflight.get(key);
    if (existing) return existing;

    const result = fetchOrigin(key, env);
    const stored = result
      .then(async (origin) => {
        if (origin.status !== 200) return;
        const headers = new Headers(origin.headers);
        headers.set(STORED_AT, String(now()));
        // The Cache API drops the copy once both windows have passed.
        headers.set("cache-control", `max-age=${policy.ttl + policy.staleWhileRevalidate}`);
        await cache.put(key, new Response(origin.body.slice(0), { status: 200, headers }));
      })
      .catch(() => {
        // A failed fetch or put leaves the old copy (if any) in place.
      })
      .finally(() => inflight.delete(key));

    const entry = { result, stored };
    inflight.set(key, entry);
    return entry;
  }

  function toClient(
    source: { status: number; headers: Headers; body: BodyInit | null },
    request: Request,
    status: CacheStatus,
    policy: RoutePolicy,
    key: string,
    ageSeconds: number,
  ): Response {
    const headers = new Headers(source.headers);
    headers.delete(STORED_AT);
    // Set by the local Cache API implementation; x-cache is the status this Worker reports.
    headers.delete("cf-cache-status");
    headers.set("cache-control", source.status === 200 ? policy.browserCacheControl : "no-store");
    headers.set("x-cache", status);
    headers.set("x-cache-route", policy.name);
    const keyUrl = new URL(key);
    headers.set("x-cache-key", keyUrl.pathname + keyUrl.search);
    headers.set("age", String(Math.max(0, Math.floor(ageSeconds))));
    const body = request.method === "HEAD" ? null : source.body;
    return new Response(body, { status: source.status, headers });
  }

  async function handleCached(request: Request, env: Env, ctx: ExecutionContext, policy: RoutePolicy) {
    const key = normalizeCacheKey(request.url, policy);
    const cache = await openCache();
    const cached = await cache.match(key);

    if (cached) {
      const storedAt = Number(cached.headers.get(STORED_AT));
      const age = (now() - storedAt) / 1000;
      if (age < policy.ttl) {
        return toClient(cached, request, "HIT", policy, key, age);
      }
      if (age < policy.ttl + policy.staleWhileRevalidate) {
        // Answer right away with the old copy and refetch after the response is sent.
        ctx.waitUntil(refresh(key, policy, env, cache).stored);
        return toClient(cached, request, "STALE", policy, key, age);
      }
      // Too old even for stale-while-revalidate: treat it as a miss.
    }

    const entry = refresh(key, policy, env, cache);
    ctx.waitUntil(entry.stored);
    try {
      const origin = await entry.result;
      return toClient({ ...origin, body: origin.body.slice(0) }, request, "MISS", policy, key, 0);
    } catch {
      return toClient(
        { status: 502, headers: new Headers({ "content-type": "text/plain" }), body: "Origin unavailable" },
        request,
        "MISS",
        policy,
        key,
        0,
      );
    }
  }

  return async function fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const allowlist = parseAllowlist(env.ALLOWED_ORIGINS);

    if (url.pathname === "/__demo" || url.pathname.startsWith("/__demo/")) {
      const response =
        env.DEMO_PAGE === "on"
          ? await handleDemo(request, env, openCache)
          : new Response("Not found", { status: 404 });
      return withEdgeHeaders(response, request, undefined, allowlist);
    }

    const policy = matchRoute(url.pathname);

    if (policy?.cors && request.method === "OPTIONS") {
      return withEdgeHeaders(preflight(request, allowlist), request, undefined, allowlist);
    }

    if (!policy || (request.method !== "GET" && request.method !== "HEAD")) {
      // Not a cached route: pass it through untouched apart from the edge headers.
      const upstream = await env.ORIGIN.fetch(request);
      const passthrough = new Response(upstream.body, upstream);
      passthrough.headers.set("x-cache", "BYPASS");
      return withEdgeHeaders(passthrough, request, policy, allowlist);
    }

    return withEdgeHeaders(await handleCached(request, env, ctx, policy), request, policy, allowlist);
  };
}
