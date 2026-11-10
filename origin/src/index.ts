// A stand-in origin for local development and tests. It serves a versioned
// embed script, a "latest" alias and a JSON config per site, and counts every
// request it receives so the demo can compare client and origin traffic.

const CURRENT_VERSION = "1.4.2";

function embedScript(version: string): string {
  return `/* demo embed script v${version} */
(function () {
  var script = document.currentScript;
  var site = script && script.dataset.site;
  fetch(new URL("/api/config/" + site, script.src))
    .then(function (r) { return r.json(); })
    .then(function (config) { console.log("embed config", config); });
})();
`;
}

export interface OriginStats {
  total: number;
  byPath: Record<string, number>;
}

export function createOrigin(options: { delayMs?: number } = {}) {
  const delayMs = options.delayMs ?? 40;
  let total = 0;
  let configVersion = 1;
  const byPath = new Map<string, number>();

  async function serve(url: URL): Promise<Response> {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const versioned = url.pathname.match(/^\/embed\/v(\d+\.\d+\.\d+)\/embed\.js$/);
    if (versioned || url.pathname === "/embed/latest.js") {
      return new Response(embedScript(versioned?.[1] ?? CURRENT_VERSION), {
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }

    const config = url.pathname.match(/^\/api\/config\/([\w-]+)$/);
    if (config) {
      const body = {
        site: config[1],
        locale: url.searchParams.get("locale") ?? "en",
        version: configVersion,
        popup: { headline: "Get 10% off your first order", delaySeconds: 5 },
        servedByOriginAt: new Date().toISOString(),
      };
      return new Response(JSON.stringify(body), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          // The edge strips this before storing, so one visitor's cookie never
          // ends up in a response shared with everyone.
          "set-cookie": "origin_session=demo; Path=/; HttpOnly",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/__stats") return Response.json(this.stats());
      if (url.pathname === "/__reset" && request.method === "POST") {
        this.reset();
        return Response.json(this.stats());
      }
      if (url.pathname === "/__publish" && request.method === "POST") {
        configVersion += 1;
        return Response.json({ version: configVersion });
      }
      total += 1;
      byPath.set(url.pathname, (byPath.get(url.pathname) ?? 0) + 1);
      return serve(url);
    },
    stats(): OriginStats {
      return { total, byPath: Object.fromEntries(byPath) };
    },
    reset() {
      total = 0;
      byPath.clear();
    },
  };
}

// One instance per isolate. `wrangler dev` runs a single isolate, so the
// counter covers every request in a local session.
const origin = createOrigin();

export default {
  fetch: (request: Request) => origin.fetch(request),
} satisfies ExportedHandler;
