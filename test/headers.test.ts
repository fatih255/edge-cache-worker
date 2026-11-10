import { describe, expect, it } from "vitest";
import { parseAllowlist } from "../src/headers";
import { setup } from "./helpers";

describe("security headers", () => {
  it.each(["/api/config/shop", "/embed/v1.4.2/embed.js", "/embed/latest.js", "/health"])(
    "adds HSTS, nosniff and Referrer-Policy to %s",
    async (path) => {
      const response = await setup().request(path);
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    },
  );

  it("sends a locked-down CSP with the config JSON", async () => {
    const response = await setup().request("/api/config/shop");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("adds the headers on HITs too, not only on the first response", async () => {
    const edge = setup();
    await edge.request("/api/config/shop");
    const hit = await edge.request("/api/config/shop");
    expect(hit.headers.get("x-cache")).toBe("HIT");
    expect(hit.headers.get("content-security-policy")).not.toBeNull();
    expect(hit.headers.get("strict-transport-security")).not.toBeNull();
  });
});

describe("CORS allowlist", () => {
  it("allows a listed origin and varies on Origin", async () => {
    const response = await setup().request("/embed/latest.js", { headers: { Origin: "https://shop.example" } });
    expect(response.headers.get("access-control-allow-origin")).toBe("https://shop.example");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-cache");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("gives no CORS header to an unlisted origin", async () => {
    const response = await setup().request("/embed/latest.js", { headers: { Origin: "https://evil.example" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("doesn't let one origin's CORS header stick to the cached copy", async () => {
    const edge = setup();
    await edge.request("/embed/latest.js", { headers: { Origin: "https://shop.example" } });
    const other = await edge.request("/embed/latest.js", { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("x-cache")).toBe("HIT");
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    const blog = await edge.request("/embed/latest.js", { headers: { Origin: "https://blog.example" } });
    expect(blog.headers.get("access-control-allow-origin")).toBe("https://blog.example");
  });

  it("answers an allowed preflight with 204", async () => {
    const edge = setup();
    const response = await edge.request("/api/config/shop", {
      method: "OPTIONS",
      headers: { Origin: "https://blog.example", "Access-Control-Request-Method": "GET" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://blog.example");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect(edge.origin.stats().total).toBe(0);
  });

  it("rejects a preflight from an unlisted origin", async () => {
    const response = await setup().request("/api/config/shop", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("parses the allowlist loosely but matches origins exactly", () => {
    expect(parseAllowlist(" https://A.example/ ,, https://b.example")).toEqual(["https://a.example", "https://b.example"]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("doesn't treat a lookalike origin as listed", async () => {
    const response = await setup().request("/embed/latest.js", {
      headers: { Origin: "https://shop.example.evil.test" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("demo page", () => {
  it("is off unless DEMO_PAGE is on", async () => {
    expect((await setup().request("/__demo")).status).toBe(404);
  });

  it("serves the page with its own CSP when enabled", async () => {
    const response = await setup({ env: { DEMO_PAGE: "on" } }).request("/__demo");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await response.text()).toContain("edge-cache-worker demo page");
  });

  it("reports the origin counter and resets it", async () => {
    const edge = setup({ env: { DEMO_PAGE: "on" } });
    await edge.request("/api/config/demo-shop?utm_source=a");
    expect(await (await edge.request("/__demo/stats")).json()).toMatchObject({ total: 1 });

    await edge.request("/__demo/reset", { method: "POST" });
    expect(edge.origin.stats().total).toBe(0);
    // The reset also deleted the cache entry, so the next request goes to the origin.
    expect((await edge.request("/api/config/demo-shop")).headers.get("x-cache")).toBe("MISS");
  });
});
