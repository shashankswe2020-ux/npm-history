import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:14318", trace: "retain-on-failure" },
  webServer: {
    command:
      "npx esbuild e2e/server.ts --bundle --platform=node --format=esm --packages=external --outfile=test-results/server.mjs && node test-results/server.mjs",
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    url: "http://127.0.0.1:14318/healthz",
    reuseExistingServer: false,
  },
});
