import { describe, expect, it } from "vitest";
import { isTrackingParam, normalizeCacheKey } from "../src/cache-key";
import { matchRoute } from "../src/policy";

const config = matchRoute("/api/config/shop")!;
const embed = matchRoute("/embed/v1.4.2/embed.js")!;

describe("normalizeCacheKey", () => {
  it("strips utm_* and click ids", () => {
    expect(
      normalizeCacheKey(
        "https://edge.test/api/config/shop?utm_source=x&utm_medium=email&fbclid=abc&gclid=1&msclkid=2&_ga=3",
        config,
      ),
    ).toBe("https://edge.test/api/config/shop");
  });

  it("treats tracking param names case-insensitively", () => {
    expect(normalizeCacheKey("https://edge.test/api/config/shop?UTM_Source=x&FBCLID=y", config)).toBe(
      "https://edge.test/api/config/shop",
    );
  });

  it("sorts the params that are left", () => {
    const a = normalizeCacheKey("https://edge.test/api/config/shop?preview=1&locale=tr", config);
    const b = normalizeCacheKey("https://edge.test/api/config/shop?locale=tr&utm_campaign=z&preview=1", config);
    expect(a).toBe("https://edge.test/api/config/shop?locale=tr&preview=1");
    expect(b).toBe(a);
  });

  it("sorts repeated params by value", () => {
    expect(normalizeCacheKey("https://edge.test/x?tag=b&tag=a")).toBe("https://edge.test/x?tag=a&tag=b");
  });

  it("drops params the route doesn't list in keepParams", () => {
    expect(normalizeCacheKey("https://edge.test/api/config/shop?locale=de&cachebust=123", config)).toBe(
      "https://edge.test/api/config/shop?locale=de",
    );
    expect(normalizeCacheKey("https://edge.test/embed/v1.4.2/embed.js?v=99&site=a", embed)).toBe(
      "https://edge.test/embed/v1.4.2/embed.js",
    );
  });

  it("keeps non-tracking params when the route has no keepParams", () => {
    expect(normalizeCacheKey("https://edge.test/x?page=2&utm_source=a")).toBe("https://edge.test/x?page=2");
  });

  it("ignores the fragment, host case and default port", () => {
    expect(normalizeCacheKey("https://EDGE.test:443/api/config/shop?locale=en#top", config)).toBe(
      "https://edge.test/api/config/shop?locale=en",
    );
  });

  it("encodes values the same way however they arrived", () => {
    const plus = normalizeCacheKey("https://edge.test/api/config/shop?locale=en+GB", config);
    const percent = normalizeCacheKey("https://edge.test/api/config/shop?locale=en%20GB", config);
    expect(plus).toBe(percent);
  });

  it("keeps the path as is, since paths are case-sensitive", () => {
    expect(normalizeCacheKey("https://edge.test/API/config/shop")).toBe("https://edge.test/API/config/shop");
  });
});

describe("isTrackingParam", () => {
  it("doesn't catch ordinary params", () => {
    for (const name of ["locale", "page", "id", "u", "utm"]) expect(isTrackingParam(name)).toBe(false);
  });
});
