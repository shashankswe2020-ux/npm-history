import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { addDays, DAY_MS } from "../src/history.js";

describe("Cloudflare runtime", () => {
  let runtime: Miniflare;
  let upstreamCalls = 0;
  beforeAll(async () => {
    const bundle = await build({
      absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
      entryPoints: ["src/worker-entry.mjs"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["node:buffer"],
    });
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        telemetry: { enabled: false },
        cf: false,
        workers: [
          {
            name: "site",
            modules: true,
            scriptPath: fileURLToPath(
              new URL("../src/pages-entry.mjs", import.meta.url),
            ),
            compatibilityDate: "2026-09-30",
            serviceBindings: {
              HISTORY_API: "api",
              ASSETS: async () => new Response("asset"),
            },
          },
          {
            name: "api",
            modules: true,
            script: bundle.outputFiles[0]!.text,
            compatibilityDate: "2026-09-30",
            ratelimits: {
              MISS_LIMITER: {
                namespace_id: "930202601",
                simple: { limit: 30, period: 60 },
              },
            },
            outboundService: async (request) => {
              upstreamCalls++;
              const url = new URL(request.url);
              expect(url.origin).toBe("https://api.npmjs.org");
              const match = url.pathname.match(
                /\/range\/(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\/(.+)/,
              )!;
              const [, start = "", end = "", name = ""] = match;
              return Response.json({
                package: decodeURIComponent(name),
                start,
                end,
                downloads: Array.from(
                  {
                    length: (Date.parse(end) - Date.parse(start)) / DAY_MS + 1,
                  },
                  (_, index) => ({ day: addDays(start, index), downloads: 10 }),
                ),
              });
            },
          },
        ],
      }),
    );
  }, 30_000);
  afterAll(async () => {
    await runtime?.dispose();
  });
  it("serves multi-year charts through the Pages service binding and edge cache", async () => {
    const url =
      "https://npm-history.pages.dev/svg?packages=react,vue,svelte&start=2015-01-10&end=2026-09-28";
    const first = await runtime.dispatchFetch(url);
    const body = await first.text();
    expect(first.status, `${body}; upstream calls: ${upstreamCalls}`).toBe(200);
    expect(body).toContain('data-series="2"');
    expect(upstreamCalls).toBe(36);
    const second = await runtime.dispatchFetch(url);
    expect(second.headers.get("x-npm-history-cache")).toBe("HIT");
    expect(upstreamCalls).toBe(36);
  }, 30_000);
  it("serves assets and invalid-query errors through the real runtime", async () => {
    expect(
      await (
        await runtime.dispatchFetch("https://npm-history.pages.dev/")
      ).text(),
    ).toBe("asset");
    expect(
      (
        await runtime.dispatchFetch(
          "https://npm-history.pages.dev/svg?mode=bad",
        )
      ).status,
    ).toBe(400);
  });
  it("enforces the actual rate-limit binding after cache misses", async () => {
    let lastStatus = 0;
    for (let index = 0; index < 35; index++) {
      const response = await runtime.dispatchFetch(
        `https://npm-history.pages.dev/svg?package=fixture-${index}&start=2026-01-01&end=2026-01-01`,
      );
      lastStatus = response.status;
      await response.text();
    }
    expect(lastStatus).toBe(429);
  }, 30_000);
});
