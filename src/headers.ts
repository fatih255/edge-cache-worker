import { securityHeaders, type RoutePolicy } from "./policy";

export function parseAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim().toLowerCase().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null, allowlist: string[]): origin is string {
  return origin !== null && allowlist.includes(origin.toLowerCase());
}

const EXPOSED = "x-cache, x-cache-route, x-cache-key, age";

/** Adds security headers, the route's CSP and CORS headers to a response. */
export function withEdgeHeaders(
  response: Response,
  request: Request,
  policy: RoutePolicy | undefined,
  allowlist: string[],
): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) out.headers.set(name, value);
  if (policy?.csp) out.headers.set("Content-Security-Policy", policy.csp);

  if (policy?.cors) {
    // The cached copy is shared by every caller, so CORS is decided per request
    // after the cache lookup and never stored.
    out.headers.append("Vary", "Origin");
    const origin = request.headers.get("Origin");
    if (isAllowedOrigin(origin, allowlist)) {
      out.headers.set("Access-Control-Allow-Origin", origin);
      out.headers.set("Access-Control-Expose-Headers", EXPOSED);
    }
  }
  return out;
}

/** Answers a CORS preflight. Unknown origins get a 403 with no CORS headers. */
export function preflight(request: Request, allowlist: string[]): Response {
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin, allowlist)) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
