// Takes the README screenshots from the running demo page.
// Starts `npm run dev` itself unless something already answers on port 8701.

import { spawn, execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = "http://localhost:8701";
const OUT = "docs/screenshots";

async function isUp() {
  try {
    return (await fetch(`${BASE}/__demo`)).ok;
  } catch {
    return false;
  }
}

async function waitUntilUp(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Demo page didn't come up on ${BASE}`);
}

function stop(child) {
  if (!child) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {}
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

let dev;
if (!(await isUp())) {
  dev = spawn("npm run dev", {
    shell: true,
    detached: process.platform !== "win32",
    stdio: "ignore",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  await waitUntilUp();
}

const browser = await chromium.launch();
try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/__demo`);

  // Start from an empty cache and a zeroed origin counter.
  await page.click("#reset");
  await page.waitForFunction(() => document.getElementById("summary").textContent.includes("deleted"));

  await page.selectOption("#target", "/api/config/demo-shop");
  await page.fill("#count", "200");
  await page.fill("#parallel", "10");
  await page.click("#run");
  await page.waitForFunction(() => document.getElementById("summary").textContent.includes("origin request"), null, {
    timeout: 60_000,
  });
  console.log(await page.textContent("#summary"));

  const headersTop = await page.locator("#headers").evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.screenshot({ path: `${OUT}/demo.png`, clip: { x: 0, y: 0, width: 1280, height: Math.ceil(headersTop) } });

  await page.click("#inspect");
  await page.waitForSelector("#header-table:not([hidden])");
  const box = await page.locator("#headers").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height };
  });
  await page.setViewportSize({ width: 1280, height: Math.ceil(box.top + box.height + 40) });
  await page.screenshot({
    path: `${OUT}/headers.png`,
    clip: { x: 0, y: Math.floor(box.top - 20), width: 1280, height: Math.ceil(box.height + 40) },
  });
  console.log(`Saved ${OUT}/demo.png and ${OUT}/headers.png`);
} finally {
  await browser.close();
  stop(dev);
}
