// Every caching and header decision the edge makes lives in this file.

export interface RoutePolicy {
  /** Short name, shown in the `x-cache-route` response header. */
  name: string;
  /** Matched against the request path. First match wins. */
  match: RegExp;
  /** Seconds a stored copy is served as fresh (`x-cache: HIT`). */
  ttl: number;
  /**
   * Seconds after `ttl` during which the stored copy is still served
   * (`x-cache: STALE`) while the Worker refetches it in the background.
   */
  staleWhileRevalidate: number;
  /** Cache-Control sent to browsers. Independent of the edge TTL. */
  browserCacheControl: string;
  /**
   * Query params that change the response. When set, every other param is
   * dropped from the cache key. When unset, only tracking params are dropped.
   */
  keepParams?: string[];
  /** Content-Security-Policy for this route, if any. */
  csp?: string;
  /** Apply the CORS allowlist from `ALLOWED_ORIGINS`. */
  cors?: boolean;
}

const YEAR = 365 * 24 * 60 * 60;

export const routes: RoutePolicy[] = [
  {
    // /embed/v1.4.2/embed.js: the version is in the path, so the file never changes.
    name: "embed-versioned",
    match: /^\/embed\/v\d+\.\d+\.\d+\/[\w.-]+\.js$/,
    ttl: YEAR,
    staleWhileRevalidate: 0,
    browserCacheControl: `public, max-age=${YEAR}, immutable`,
    keepParams: [],
    cors: true,
  },
  {
    // /embed/latest.js points at whatever version is current.
    name: "embed-latest",
    match: /^\/embed\/latest\.js$/,
    ttl: 300,
    staleWhileRevalidate: 3600,
    browserCacheControl: "public, max-age=300",
    keepParams: [],
    cors: true,
  },
  {
    // /api/config/<site>: small JSON that changes when a site owner edits settings.
    name: "config",
    match: /^\/api\/config\/[\w-]+$/,
    ttl: 60,
    staleWhileRevalidate: 300,
    browserCacheControl: "public, max-age=30",
    keepParams: ["locale", "preview"],
    csp: "default-src 'none'; frame-ancestors 'none'",
    cors: true,
  },
];

export function matchRoute(pathname: string): RoutePolicy | undefined {
  return routes.find((route) => route.match.test(pathname));
}

/** Query params that only carry attribution data and never change a response. */
export const trackingParams = {
  prefixes: ["utm_"],
  names: [
    "fbclid",
    "gclid",
    "gclsrc",
    "dclid",
    "gbraid",
    "wbraid",
    "msclkid",
    "yclid",
    "ttclid",
    "twclid",
    "igshid",
    "li_fat_id",
    "mc_cid",
    "mc_eid",
    "_ga",
    "_gl",
    "_hsenc",
    "_hsmi",
  ],
};

/** Added to every response the Worker returns. */
export const securityHeaders: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};
