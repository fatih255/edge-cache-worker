import { trackingParams, type RoutePolicy } from "./policy";

export function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    trackingParams.prefixes.some((prefix) => lower.startsWith(prefix)) ||
    trackingParams.names.includes(lower)
  );
}

/**
 * Builds the URL used as the cache key. Requests that differ only in tracking
 * params, param order, fragment or headers end up with the same key.
 */
export function normalizeCacheKey(input: string | URL, policy?: Pick<RoutePolicy, "keepParams">): string {
  const url = new URL(input);
  const keep = policy?.keepParams?.map((name) => name.toLowerCase());

  const params: [string, string][] = [];
  for (const [name, value] of url.searchParams) {
    if (isTrackingParam(name)) continue;
    if (keep && !keep.includes(name.toLowerCase())) continue;
    params.push([name, value]);
  }

  // Sort by name, then value, so `?b=1&a=2` and `?a=2&b=1` match.
  params.sort(([aName, aValue], [bName, bValue]) =>
    aName < bName ? -1 : aName > bName ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0,
  );

  // URL already lowercases the host and drops the default port.
  const query = new URLSearchParams(params).toString();
  return `${url.protocol}//${url.host}${url.pathname}${query ? `?${query}` : ""}`;
}
