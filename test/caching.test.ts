import { describe, expect, it } from "vitest";
import { setup } from "./helpers";

describe("HIT / MISS / STALE", () => {
  it("misses once, then hits until the TTL runs out", async () => {
    const edge = setup();
    const first = await edge.request("/api/config/shop");
    expect(first.headers.get("x-cache")).toBe("MISS");
    expect(first.status).toBe(200);

    edge.advance(59);
    const second = await edge.request("/api/config/shop");
    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(second.headers.get("age")).toBe("59");
    expect(await second.json()).toEqual(await first.json());
    expect(edge.origin.stats().total).toBe(1);
  });

  it("serves the old copy as STALE after the TTL and refetches in the background", async () => {
    const edge = setup();
    await edge.request("/api/config/shop");
    await edge.origin.fetch(new Request("https://origin/__publish", { method: "POST" }));

    edge.advance(61);
    const stale = await edge.request("/api/config/shop");
    expect(stale.headers.get("x-cache")).toBe("STALE");
    expect(stale.headers.get("age")).toBe("61");
    expect(((await stale.json()) as { version: number }).version).toBe(1);
    // The refresh ran in ctx.waitUntil, after the response was ready.
    expect(edge.origin.stats().total).toBe(2);

    const fresh = await edge.request("/api/config/shop");
    expect(fresh.headers.get("x-cache")).toBe("HIT");
    expect(fresh.headers.get("age")).toBe("0");
    expect(((await fresh.json()) as { version: number }).version).toBe(2);
    expect(edge.origin.stats().total).toBe(2);
  });

  it("starts only one background refresh for many stale requests", async () => {
    const edge = setup({ delayMs: 30 });
    await edge.request("/api/config/shop");
    edge.advance(120);

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => edge.request(`/api/config/shop?utm_source=s${i}`)),
    );
    expect(responses.map((r) => r.headers.get("x-cache"))).toEqual(Array(20).fill("STALE"));
    expect(edge.origin.stats().total).toBe(2);
  });

  it("misses again once the stale window is over too", async () => {
    const edge = setup();
    await edge.request("/api/config/shop");
    edge.advance(60 + 300);
    const response = await edge.request("/api/config/shop");
    expect(response.headers.get("x-cache")).toBe("MISS");
    expect(edge.origin.stats().total).toBe(2);
  });

  it("keeps a versioned embed script for a year", async () => {
    const edge = setup();
    expect((await edge.request("/embed/v1.4.2/embed.js")).headers.get("x-cache")).toBe("MISS");
    edge.advance(180 * 24 * 60 * 60);
    const later = await edge.request("/embed/v1.4.2/embed.js");
    expect(later.headers.get("x-cache")).toBe("HIT");
    expect(later.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(edge.origin.stats().total).toBe(1);
  });

  it("uses the route's browser Cache-Control, not the origin's", async () => {
    const edge = setup();
    const response = await edge.request("/embed/latest.js");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("x-cache-route")).toBe("embed-latest");
  });
});

describe("origin request counting", () => {
  it("turns 200 concurrent requests with random tracking params into 1 origin request", async () => {
    const edge = setup({ delayMs: 20 });
    const tracking = ["utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid", "msclkid"];
    const paths = Array.from({ length: 200 }, (_, i) => {
      const params = new URLSearchParams();
      for (const name of tracking) if ((i + name.length) % 2) params.set(name, crypto.randomUUID());
      params.set("utm_content", String(i));
      return `/api/config/shop?${params}`;
    });

    const responses = await Promise.all(paths.map((path) => edge.request(path)));
    expect(new Set(responses.map((r) => r.headers.get("x-cache-key")))).toEqual(new Set(["/api/config/shop"]));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(edge.origin.stats().total).toBe(1);
  });

  it("turns 200 sequential requests into 1 MISS and 199 HITs", async () => {
    const edge = setup();
    const statuses: string[] = [];
    for (let i = 0; i < 200; i++) {
      const response = await edge.request(`/embed/latest.js?utm_source=r${i}&fbclid=${crypto.randomUUID()}`);
      statuses.push(response.headers.get("x-cache")!);
    }
    expect(statuses.filter((s) => s === "MISS")).toHaveLength(1);
    expect(statuses.filter((s) => s === "HIT")).toHaveLength(199);
    expect(edge.origin.stats().total).toBe(1);
  });

  it("keeps separate entries for params that change the response", async () => {
    const edge = setup();
    await edge.request("/api/config/shop?locale=en");
    await edge.request("/api/config/shop?locale=tr");
    const again = await edge.request("/api/config/shop?utm_source=x&locale=tr");
    expect(again.headers.get("x-cache")).toBe("HIT");
    expect(((await again.json()) as { locale: string }).locale).toBe("tr");
    expect(edge.origin.stats().total).toBe(2);
  });

  it("ignores cookies and other request headers for the key and doesn't forward them", async () => {
    const edge = setup();
    await edge.request("/api/config/shop", { headers: { cookie: "a=1", "accept-language": "de", "user-agent": "A" } });
    const second = await edge.request("/api/config/shop", {
      headers: { cookie: "b=2", "accept-language": "tr", "user-agent": "B", authorization: "Bearer x" },
    });
    expect(second.headers.get("x-cache")).toBe("HIT");
    expect(edge.originRequests).toHaveLength(1);
    const sent = edge.originRequests[0]!;
    expect(sent.headers.get("cookie")).toBeNull();
    expect(sent.headers.get("accept-language")).toBeNull();
    expect(sent.headers.get("authorization")).toBeNull();
  });

  it("never passes the origin's Set-Cookie to clients of a cached route", async () => {
    const edge = setup();
    expect((await edge.request("/api/config/shop")).headers.get("set-cookie")).toBeNull();
    expect((await edge.request("/api/config/shop")).headers.get("set-cookie")).toBeNull();
  });

  it("answers HEAD from the same entry with no body", async () => {
    const edge = setup();
    await edge.request("/api/config/shop");
    const head = await edge.request("/api/config/shop", { method: "HEAD" });
    expect(head.headers.get("x-cache")).toBe("HIT");
    expect(await head.text()).toBe("");
    expect(edge.origin.stats().total).toBe(1);
  });

  it("bypasses the cache for other methods and unknown routes", async () => {
    const edge = setup();
    const post = await edge.request("/api/config/shop", { method: "POST" });
    const unknown = await edge.request("/health");
    expect(post.headers.get("x-cache")).toBe("BYPASS");
    expect(unknown.headers.get("x-cache")).toBe("BYPASS");
    expect(unknown.status).toBe(404);
    expect(edge.origin.stats().total).toBe(2);
  });

  it("returns 502 and caches nothing when the origin is down", async () => {
    const edge = setup({
      env: { ORIGIN: { fetch: () => Promise.reject(new Error("connection refused")) } as unknown as Fetcher },
    });
    const response = await edge.request("/api/config/shop");
    expect(response.status).toBe(502);
    expect(response.headers.get("x-cache")).toBe("MISS");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await edge.request("/api/config/shop")).headers.get("x-cache")).toBe("MISS");
  });
});
