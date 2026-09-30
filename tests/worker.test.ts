import { describe, expect, it, vi } from "vitest";
import { createWorkerHandler } from "../src/worker.js";
import type { WorkerEnvironment } from "../src/worker.js";
import { AppError, toSeries } from "../src/history.js";
import type { Query } from "../src/history.js";

function fixture() {
  const stored = new Map<string, Response>();
  const writes: Promise<unknown>[] = [];
  const environment: WorkerEnvironment = {
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
    MISS_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
  };
  const cache = {
    match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      stored.set(request.url, response.clone());
    }),
  };
  const history = vi.fn(async (query: Query) => ({
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
  }));
  const handler = createWorkerHandler({ history });
  const request = (path: string, method = "GET") =>
    handler(
      new Request(`https://example.workers.dev${path}`, { method }),
      environment,
      {
        waitUntil: (task) => {
          writes.push(task);
        },
      },
      cache,
    );
  return { environment, cache, history, request, writes };
}

describe("Worker deployment boundary", () => {
  it("serves and caches SVG with HTTPS and safety headers", async () => {
    const fixtureData = fixture();
    const response = await fixtureData.request(
      "/svg?package=demo&start=2026-01-01&end=2026-01-02",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("strict-transport-security")).toContain(
      "max-age",
    );
    expect(response.headers.get("x-npm-history-cache")).toBe("MISS");
    expect(await response.text()).toContain("Cumulative downloads");
    await Promise.all(fixtureData.writes);
    expect(fixtureData.cache.put).toHaveBeenCalledTimes(1);
  });
  it("normalizes aliases, parameter order and defaults into one cache key", async () => {
    const fixtureData = fixture();
    await fixtureData.request(
      "/svg?package=demo&start=2026-01-01&end=2026-01-02",
    );
    await Promise.all(fixtureData.writes);
    const response = await fixtureData.request(
      "/svg?end=2026-01-02&start=2026-01-01&packages=demo&theme=light&mode=cumulative",
      "HEAD",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-npm-history-cache")).toBe("HIT");
    expect(await response.text()).toBe("");
    expect(fixtureData.history).toHaveBeenCalledTimes(1);
    expect(fixtureData.environment.MISS_LIMITER.limit).toHaveBeenCalledTimes(1);
  });
  it("does not mix themes, modes, dates, formats or packages", async () => {
    const fixtureData = fixture();
    for (const path of [
      "/svg?package=demo",
      "/svg?package=demo&theme=dark",
      "/svg?package=demo&mode=daily",
      "/svg?package=demo&start=2026-01-01",
      "/svg?package=other",
      "/api/history?package=demo",
    ]) {
      expect((await fixtureData.request(path)).status).toBe(200);
      await Promise.all(fixtureData.writes);
    }
    expect(fixtureData.history).toHaveBeenCalledTimes(6);
  });
  it("rejects bad queries, unknown routes and methods before npm", async () => {
    const fixtureData = fixture();
    expect((await fixtureData.request("/svg?package=../bad")).status).toBe(400);
    expect((await fixtureData.request("/svg", "POST")).status).toBe(405);
    expect((await fixtureData.request("/svg?unknown=1")).status).toBe(400);
    expect((await fixtureData.request("/secret.txt")).status).toBe(404);
    expect(fixtureData.history).not.toHaveBeenCalled();
  });
  it("rate limits cache misses without storing client identifiers", async () => {
    const fixtureData = fixture();
    vi.mocked(fixtureData.environment.MISS_LIMITER.limit).mockResolvedValue({
      success: false,
    });
    const response = await fixtureData.request("/api/history");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixtureData.history).not.toHaveBeenCalled();
    expect(fixtureData.environment.MISS_LIMITER.limit).toHaveBeenCalledWith({
      key: "npm-history:cache-miss",
    });
  });
  it("never caches upstream errors or exposes unexpected internal details", async () => {
    const fixtureData = fixture();
    fixtureData.history.mockRejectedValueOnce(
      new AppError(502, "INCOMPLETE_HISTORY", "Try an earlier end date."),
    );
    expect((await fixtureData.request("/svg")).status).toBe(502);
    fixtureData.history.mockRejectedValueOnce(
      new Error("secret internal detail"),
    );
    const response = await fixtureData.request("/svg");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
    expect(fixtureData.cache.put).not.toHaveBeenCalled();
  });
  it("serves assets and health without npm or rate limiter calls", async () => {
    const fixtureData = fixture();
    expect(await (await fixtureData.request("/")).text()).toBe("asset");
    expect(await (await fixtureData.request("/healthz")).json()).toEqual({
      status: "ok",
    });
    expect(fixtureData.history).not.toHaveBeenCalled();
    expect(fixtureData.environment.MISS_LIMITER.limit).not.toHaveBeenCalled();
  });
});
