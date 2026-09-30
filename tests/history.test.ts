import { describe, expect, it } from "vitest";
import { addDays, dateChunks, parseQuery, toSeries } from "../src/history.js";

describe("history dates and query contract", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("defaults to completed UTC days, never a partial current day", () => {
    expect(parseQuery(new URLSearchParams(), now)).toEqual({
      packages: ["zod"],
      start: "2025-09-30",
      end: "2026-09-29",
      mode: "cumulative",
      theme: "light",
    });
  });
  it("accepts scoped packages and the singular embedding alias", () => {
    expect(
      parseQuery(new URLSearchParams("package=@types/node"), now).packages,
    ).toEqual(["@types/node"]);
  });
  it.each([
    "packages=../etc",
    "packages=https://example.com",
    "packages=a,b,c,d",
    "packages=a,a",
    "package=a&packages=b",
    "packages=",
    "packages=a&packages=b",
    "start=2026-02-30",
    "start=2014-01-01",
    "end=2026-09-30",
    "start=2026-09-29&end=2026-09-28",
    "theme=blue",
    "mode=weekly",
    "url=https://example.com",
  ])("rejects invalid query: %s", (query) => {
    expect(() => parseQuery(new URLSearchParams(query), now)).toThrow();
  });
  it("chunks many years without overlap or gaps, including leap days", () => {
    const chunks = dateChunks("2023-01-01", "2026-09-29");
    expect(chunks[0]?.start).toBe("2023-01-01");
    expect(chunks.at(-1)?.end).toBe("2026-09-29");
    chunks.forEach((chunk, index) => {
      expect(Date.parse(chunk.end) - Date.parse(chunk.start)).toBeLessThan(
        365 * 86_400_000,
      );
      if (index > 0)
        expect(chunk.start).toBe(addDays(chunks[index - 1]!.end, 1));
    });
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("supports a single inclusive date", () => {
    expect(dateChunks("2026-01-01", "2026-01-01")).toEqual([
      { start: "2026-01-01", end: "2026-01-01" },
    ]);
  });
});

describe("series", () => {
  it("rejects totals that lose integer precision", () => {
    expect(() =>
      toSeries(
        "demo",
        [
          { day: "2026-01-01", downloads: Number.MAX_SAFE_INTEGER },
          { day: "2026-01-02", downloads: 1 },
        ],
        "cumulative",
      ),
    ).toThrow();
  });
  const points = [
    { day: "2026-01-01", downloads: 2 },
    { day: "2026-01-02", downloads: 0 },
    { day: "2026-01-03", downloads: 5 },
  ];
  it("sums all days once without mutating the source", () => {
    const result = toSeries("demo", points, "cumulative");
    expect(result.total).toBe(7);
    expect(result.points.map((point) => point.value)).toEqual([2, 2, 7]);
    expect(points[0]).not.toHaveProperty("value");
  });
  it("retains raw daily counts in daily mode", () => {
    expect(
      toSeries("demo", points, "daily").points.map((point) => point.value),
    ).toEqual([2, 0, 5]);
  });
});
