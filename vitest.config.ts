import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd (the Workers runtime) with a real Cache API.
// They import the handler directly and give it a test origin, so no wrangler
// config or second Worker is needed here.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-15",
      },
    }),
  ],
});
