import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createHandler } from "../src/app.js";
import { AppError, toSeries } from "../src/history.js";
import type { Query } from "../src/history.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

async function fixture(
  fail = false,
): Promise<{ origin: string; history: ReturnType<typeof vi.fn> }> {
  const history = vi.fn(async (query: Query) => {
    if (fail)
      throw new AppError(429, "UPSTREAM_RATE_LIMIT", "Try again shortly.");
    return {
      start: query.start,
      end: query.end,
      mode: query.mode,
      generatedAt: "2026-09-30T00:00:00Z",
      series: [
        toSeries(
          query.packages[0]!,
          [{ day: query.start, downloads: 7 }],
          query.mode,
        ),
      ],
    };
  });
  const server = createServer(
    createHandler({ history }, new URL("../web/", import.meta.url)),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test listener");
  return { origin: `http://127.0.0.1:${address.port}`, history };
}

describe("HTTP contract", () => {
  it("serves JSON with cache and security headers", async () => {
    const { origin } = await fixture();
    const response = await fetch(`${origin}/api/history?package=demo`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toMatchObject({ series: [{ total: 7 }] });
  });
  it("serves embeddable SVG and supports HEAD", async () => {
    const { origin } = await fixture();
    const response = await fetch(`${origin}/svg?package=demo&theme=dark`);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("<svg");
    const head = await fetch(`${origin}/svg?package=demo`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });
  it("rejects invalid input before contacting npm", async () => {
    const { origin, history } = await fixture();
    const response = await fetch(`${origin}/svg?package=../secret`);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(history).not.toHaveBeenCalled();
  });
  it("rejects unsupported methods and unknown routes", async () => {
    const { origin, history } = await fixture();
    expect((await fetch(`${origin}/svg`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${origin}/.env`)).status).toBe(404);
    expect((await fetch(`${origin}/src/app.ts`)).status).toBe(404);
    expect(history).not.toHaveBeenCalled();
  });
  it("does not cache errors and provides retry guidance", async () => {
    const { origin } = await fixture(true);
    const response = await fetch(`${origin}/api/history`);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "UPSTREAM_RATE_LIMIT", message: "Try again shortly." },
    });
  });
  it("provides a local health endpoint without npm access", async () => {
    const { origin, history } = await fixture();
    expect(await (await fetch(`${origin}/healthz`)).json()).toEqual({
      status: "ok",
    });
    expect(history).not.toHaveBeenCalled();
  });
});
