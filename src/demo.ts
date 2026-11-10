// Local demo page at /__demo. Only served when DEMO_PAGE is "on" (npm run dev).

import { normalizeCacheKey } from "./cache-key";
import type { Env } from "./handler";
import { matchRoute } from "./policy";

export const DEMO_TARGETS = ["/api/config/demo-shop", "/embed/v1.4.2/embed.js", "/embed/latest.js"];

const DEMO_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'";

export async function handleDemo(request: Request, env: Env, openCache: () => Promise<Cache>): Promise<Response> {
  const url = new URL(request.url);

  switch (url.pathname) {
    case "/__demo":
    case "/__demo/":
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": DEMO_CSP },
      });
    case "/__demo/app.js":
      return new Response(APP, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    case "/__demo/stats":
      return env.ORIGIN.fetch(new Request(new URL("/__stats", url)));
    case "/__demo/reset": {
      if (request.method !== "POST") return new Response("Use POST", { status: 405 });
      const cache = await openCache();
      for (const path of DEMO_TARGETS) {
        await cache.delete(normalizeCacheKey(new URL(path, url), matchRoute(path)));
      }
      return env.ORIGIN.fetch(new Request(new URL("/__reset", url), { method: "POST" }));
    }
    default:
      return new Response("Not found", { status: 404 });
  }
}

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>edge-cache-worker demo</title>
<style>
  :root { color-scheme: light; --ink: #1d2433; --muted: #5b6474; --line: #dde2ea; --bg: #f6f7f9;
    --hit: #1f7a4d; --miss: #b5471b; --stale: #8a6d00; --bypass: #5b6474; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding: 28px 24px 40px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 0 0 12px; }
  p.lead { margin: 0 0 20px; color: var(--muted); max-width: 820px; }
  code, .mono { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 13px; }
  section { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; margin-bottom: 18px; }
  .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
  label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
  select, input { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--ink); }
  input[type=number] { width: 90px; }
  button { font: inherit; padding: 7px 14px; border-radius: 6px; border: 1px solid #2b4c9b; background: #2b4c9b; color: #fff; cursor: pointer; }
  button.secondary { background: #fff; color: #2b4c9b; }
  button:disabled { opacity: .5; cursor: default; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 16px; }
  .stat { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; }
  .stat b { display: block; font-size: 26px; line-height: 1.2; }
  .stat span { font-size: 13px; color: var(--muted); }
  .summary { margin: 14px 0 0; font-weight: 600; }
  .scroll { max-height: 380px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 5px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { position: sticky; top: 0; background: #eef1f5; font-size: 13px; white-space: nowrap; }
  td.nowrap { white-space: nowrap; }
  td.url { word-break: break-all; }
  .HIT { color: var(--hit); font-weight: 600; } .MISS { color: var(--miss); font-weight: 600; }
  .STALE { color: var(--stale); font-weight: 600; } .BYPASS { color: var(--bypass); font-weight: 600; }
  .note { font-size: 13px; color: var(--muted); margin: 10px 0 0; }
  tr.edge td:first-child { font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>edge-cache-worker demo page</h1>
  <p class="lead">A local demo. This page sends requests through the Worker running in <code>wrangler dev</code>.
  The Worker talks to a local origin Worker that counts every request it gets, so you can compare
  client requests with origin requests. Each request gets random <code>utm_*</code>, <code>fbclid</code>
  or <code>gclid</code> values, which the cache key ignores.</p>

  <section id="burst">
    <h2>Burst of requests</h2>
    <div class="controls">
      <label>Target
        <select id="target">
          <option value="/api/config/demo-shop">/api/config/demo-shop (JSON, 60s TTL + 300s stale)</option>
          <option value="/embed/v1.4.2/embed.js">/embed/v1.4.2/embed.js (versioned, immutable)</option>
          <option value="/embed/latest.js">/embed/latest.js (300s TTL + 1h stale)</option>
        </select>
      </label>
      <label>Requests <input id="count" type="number" min="1" max="1000" value="200"></label>
      <label>In parallel <input id="parallel" type="number" min="1" max="50" value="10"></label>
      <button id="run">Send burst</button>
      <button id="reset" class="secondary">Reset cache and origin counter</button>
    </div>
    <div class="stats">
      <div class="stat"><b id="s-client">0</b><span>client requests</span></div>
      <div class="stat"><b id="s-origin">0</b><span>origin requests (counted by the origin)</span></div>
      <div class="stat"><b id="s-hit" class="HIT">0</b><span>x-cache: HIT</span></div>
      <div class="stat"><b id="s-miss" class="MISS">0</b><span>x-cache: MISS</span></div>
      <div class="stat"><b id="s-stale" class="STALE">0</b><span>x-cache: STALE</span></div>
    </div>
    <p class="summary" id="summary">Press "Send burst" to start.</p>
  </section>

  <section>
    <h2>Requests</h2>
    <div class="scroll">
      <table>
        <thead><tr><th>#</th><th>Request</th><th>Status</th><th>x-cache</th><th>Cache key</th><th>age</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </section>

  <section id="headers">
    <h2>Response headers of one request</h2>
    <div class="controls"><button id="inspect" class="secondary">Inspect one request</button></div>
    <p class="note" id="inspect-url">Sends one request to the selected target and lists every response header the browser can see.</p>
    <table id="header-table" hidden>
      <thead><tr><th>Header</th><th>Value</th></tr></thead>
      <tbody id="header-rows"></tbody>
    </table>
    <p class="note">HSTS only takes effect over HTTPS; browsers ignore it on <code>http://localhost</code>.</p>
  </section>
</main>
<script src="/__demo/app.js"></script>
</body>
</html>`;

const APP = /* js */ `
const $ = (id) => document.getElementById(id);
const TRACKING = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid", "gclid", "msclkid"];
const SOURCES = ["newsletter", "instagram", "google", "partner", "x"];
const EDGE_HEADERS = ["x-cache", "x-cache-route", "x-cache-key", "age", "cache-control",
  "strict-transport-security", "x-content-type-options", "referrer-policy", "content-security-policy"];

function randomId() { return Math.random().toString(36).slice(2, 10); }

function trackedUrl(path) {
  const params = new URLSearchParams();
  for (const name of TRACKING) {
    if (Math.random() < 0.5) continue;
    params.set(name, name.startsWith("utm_") ? SOURCES[Math.floor(Math.random() * SOURCES.length)] + "-" + randomId().slice(0, 3) : randomId());
  }
  if (![...params.keys()].length) params.set("utm_source", "direct-" + randomId().slice(0, 3));
  return path + "?" + params.toString();
}

async function originCount() {
  const res = await fetch("/__demo/stats", { cache: "no-store" });
  return (await res.json()).total;
}

let originBase = 0;
async function refreshOrigin() { $("s-origin").textContent = await originCount() - originBase; }

function cell(text, className) {
  const td = document.createElement("td");
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

$("run").addEventListener("click", async () => {
  const path = $("target").value;
  const total = Math.max(1, Math.min(1000, Number($("count").value) || 200));
  const parallel = Math.max(1, Math.min(50, Number($("parallel").value) || 10));
  $("run").disabled = $("reset").disabled = true;
  $("rows").textContent = "";
  originBase = await originCount();
  const counts = { HIT: 0, MISS: 0, STALE: 0, BYPASS: 0 };
  let done = 0;
  for (const id of ["s-client", "s-origin", "s-hit", "s-miss", "s-stale"]) $(id).textContent = "0";
  $("summary").textContent = "Sending...";

  const rows = [];
  for (let i = 0; i < total; i++) {
    const tr = document.createElement("tr");
    const url = trackedUrl(path);
    tr.append(cell(String(i + 1)), cell(url, "url mono"), cell("..."), cell("..."), cell(""), cell(""));
    $("rows").append(tr);
    rows.push({ tr, url });
  }

  let next = 0;
  const poll = setInterval(refreshOrigin, 250);
  async function worker() {
    while (next < rows.length) {
      const row = rows[next++];
      const res = await fetch(row.url, { cache: "no-store" });
      await res.arrayBuffer();
      const status = res.headers.get("x-cache") || "?";
      counts[status] = (counts[status] || 0) + 1;
      const tds = row.tr.children;
      tds[2].textContent = String(res.status);
      tds[3].textContent = status; tds[3].className = status;
      tds[4].textContent = res.headers.get("x-cache-key") || ""; tds[4].className = "mono nowrap";
      tds[5].textContent = res.headers.get("age") || "";
      done++;
      $("s-client").textContent = done;
      $("s-hit").textContent = counts.HIT; $("s-miss").textContent = counts.MISS; $("s-stale").textContent = counts.STALE;
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker));
  clearInterval(poll);
  await refreshOrigin();
  const origin = Number($("s-origin").textContent);
  $("summary").textContent = done + " client requests with random tracking params \\u2192 " + origin +
    " origin request" + (origin === 1 ? "" : "s") + "." +
    (counts.MISS > origin ? " The first requests arrived together, so " + counts.MISS +
      " MISS responses shared " + origin + " origin fetch" + (origin === 1 ? "" : "es") + " instead of each starting one." : "");
  $("run").disabled = $("reset").disabled = false;
});

$("reset").addEventListener("click", async () => {
  await fetch("/__demo/reset", { method: "POST" });
  originBase = 0;
  $("rows").textContent = "";
  for (const id of ["s-client", "s-origin", "s-hit", "s-miss", "s-stale"]) $(id).textContent = "0";
  $("summary").textContent = "Cache entries for the demo targets deleted and origin counter reset.";
});

$("inspect").addEventListener("click", async () => {
  const url = trackedUrl($("target").value);
  const res = await fetch(url, { cache: "no-store" });
  await res.arrayBuffer();
  $("inspect-url").textContent = "GET " + url + " \\u2192 " + res.status;
  const body = $("header-rows");
  body.textContent = "";
  const entries = [...res.headers.entries()].sort(([a], [b]) => {
    const ia = EDGE_HEADERS.indexOf(a), ib = EDGE_HEADERS.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  for (const [name, value] of entries) {
    const tr = document.createElement("tr");
    if (EDGE_HEADERS.includes(name)) tr.className = "edge";
    tr.append(cell(name, "mono"), cell(value, name === "x-cache" ? "mono " + value : "mono"));
    body.append(tr);
  }
  $("header-table").hidden = false;
});
`;
