import { describe, expect, it, vi } from "vitest";
import { addDays, DAY_MS, parseQuery } from "../src/history.js";
import { createNpmClient } from "../src/npm-client.js";

const now = new Date("2026-09-30T00:00:00Z");
const query = parseQuery(
  new URLSearchParams("packages=demo&start=2026-01-01&end=2026-01-03"),
  now,
);

function responseFor(url: string): Response {
  const match = new URL(url).pathname.match(
    /\/range\/(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\/(.+)/,
  )!;
  const [, start = "", end = "", name = ""] = match;
  return Response.json({
    start,
    end,
    package: decodeURIComponent(name),
    downloads: Array.from(
      { length: (Date.parse(end) - Date.parse(start)) / DAY_MS + 1 },
      (_, index) => ({ day: addDays(start, index), downloads: index + 1 }),
    ),
  });
}

describe("npm client", () => {
  it("maps an exhausted overall history budget to a gateway timeout", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(
        AbortSignal.abort(new DOMException("expired", "TimeoutError")),
      );
    try {
      await expect(
        createNpmClient({ fetcher: vi.fn() }).history(query),
      ).rejects.toMatchObject({ status: 504 });
    } finally {
      timeout.mockRestore();
    }
  });
  it("maps fetch timeouts to a retryable gateway timeout", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    await expect(
      createNpmClient({ fetcher }).history(query),
    ).rejects.toMatchObject({ status: 504 });
  });
  it.each([new Response("not json"), new Response(null)])(
    "rejects malformed or empty upstream bodies",
    async (response) => {
      await expect(
        createNpmClient({ fetcher: async () => response }).history(query),
      ).rejects.toMatchObject({ status: 502 });
    },
  );
  it("uses a fixed HTTPS origin, no redirects and encoded scoped package", async () => {
    const fetcher = vi.fn(async (url: string) => responseFor(url));
    const client = createNpmClient({ fetcher });
    const result = await client.history({
      ...query,
      packages: ["@types/node"],
    });
    expect(result.series[0]?.total).toBe(6);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.npmjs.org/downloads/range/2026-01-01:2026-01-03/%40types%2Fnode",
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("joins historical chunks and preserves a continuous cumulative total", async () => {
    const fetcher = vi.fn(async (url: string) => responseFor(url));
    const result = await createNpmClient({ fetcher }).history({
      ...query,
      start: "2024-01-01",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const points = result.series[0]!.points;
    expect(new Set(points.map((point) => point.day)).size).toBe(points.length);
    expect(points.at(-1)?.value).toBe(result.series[0]?.total);
  });
  it("deduplicates concurrent work, reuses data for theme/mode, and expires cache", async () => {
    let time = 0;
    const fetcher = vi.fn(async (url: string) => responseFor(url));
    const client = createNpmClient({ fetcher, now: () => time, ttlMs: 10 });
    await Promise.all([client.history(query), client.history(query)]);
    await client.history({ ...query, mode: "daily", theme: "dark" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    time = 11;
    await client.history(query);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("evicts the least recently used cache entry", async () => {
    const fetcher = vi.fn(async (url: string) => responseFor(url));
    const client = createNpmClient({ fetcher, maxEntries: 1 });
    await client.history(query);
    await client.history({ ...query, packages: ["other"] });
    await client.history(query);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([404, 429, 500])(
    "maps upstream status %s without leaking its body",
    async (status) => {
      const fetcher = vi.fn(
        async () => new Response("private upstream detail", { status }),
      );
      await expect(
        createNpmClient({ fetcher }).history(query),
      ).rejects.toMatchObject({ status: status === 500 ? 502 : status });
    },
  );
  it("applies a cooldown after upstream rate limiting", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    const client = createNpmClient({ fetcher });
    await expect(client.history(query)).rejects.toMatchObject({ status: 429 });
    await expect(
      client.history({ ...query, packages: ["other"] }),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    "missing",
    "duplicate",
    "negative",
    "wrong-package",
    "wrong-range",
    "unsafe",
    "invalid-date",
  ])("rejects %s data instead of inventing totals", async (kind) => {
    const data = {
      package: "demo",
      start: query.start,
      end: query.end,
      downloads: [
        { day: "2026-01-01", downloads: 1 },
        { day: "2026-01-02", downloads: 2 },
        { day: "2026-01-03", downloads: 3 },
      ],
    };
    if (kind === "missing") data.downloads.pop();
    if (kind === "duplicate") data.downloads[1]!.day = "2026-01-01";
    if (kind === "negative") data.downloads[0]!.downloads = -1;
    if (kind === "wrong-package") data.package = "other";
    if (kind === "wrong-range") data.end = "2026-01-04";
    if (kind === "unsafe")
      data.downloads[0]!.downloads = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "invalid-date") data.downloads[0]!.day = "2026-02-30";
    await expect(
      createNpmClient({ fetcher: async () => Response.json(data) }).history(
        query,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });
  it("limits streamed body size before parsing", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(260_000)));
    await expect(
      createNpmClient({ fetcher }).history(query),
    ).rejects.toMatchObject({ status: 502 });
  });
  it("does not cache failed fetches", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(async (url: string) => responseFor(url));
    const client = createNpmClient({ fetcher });
    await expect(client.history(query)).rejects.toMatchObject({ status: 502 });
    expect((await client.history(query)).series[0]?.total).toBe(6);
  });
  it("bounds unique in-flight jobs while allowing duplicate consumers", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetcher = vi.fn(() => pending.promise);
    const client = createNpmClient({ fetcher, maxJobs: 1 });
    const first = client.history(query);
    const duplicate = client.history(query);
    await expect(
      client.history({ ...query, packages: ["other"] }),
    ).rejects.toMatchObject({ status: 503 });
    pending.resolve(
      responseFor(
        "https://api.npmjs.org/downloads/range/2026-01-01:2026-01-03/demo",
      ),
    );
    await Promise.all([first, duplicate]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
