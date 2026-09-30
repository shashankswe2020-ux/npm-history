import { describe, expect, it } from "vitest";
import { renderChart } from "../src/chart.js";
import { toSeries } from "../src/history.js";
import type { History } from "../src/history.js";

const history: History = {
  start: "2026-01-01",
  end: "2026-01-03",
  mode: "cumulative",
  generatedAt: "2026-01-04T00:00:00Z",
  series: [
    toSeries(
      "demo",
      [
        { day: "2026-01-01", downloads: 2 },
        { day: "2026-01-02", downloads: 0 },
        { day: "2026-01-03", downloads: 5 },
      ],
      "cumulative",
    ),
  ],
};

describe("SVG chart", () => {
  it("supports a compact chart with stacked legends and a bounded viewBox", () => {
    const svg = renderChart(history, "light", 320);
    expect(svg).toContain('viewBox="0 0 320');
    expect(svg).not.toContain('x="960"');
    expect(svg).toContain("through 2026-01-03 UTC");
  });
  it("renders a standalone accessible chart with an honest date baseline", () => {
    const svg = renderChart(history, "light");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain("Cumulative downloads");
    expect(svg).toContain("Since 2026-01-01");
    expect(svg).toContain("demo");
    expect(svg).toContain('data-series="0"');
    expect(svg).not.toMatch(/NaN|Infinity|<script|https?:\/\/(?!www.w3.org)/);
  });
  it("escapes XML text even for callers outside the API", () => {
    const svg = renderChart(
      {
        ...history,
        series: [{ ...history.series[0]!, package: '<script>&"' }],
      },
      "light",
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;&quot;");
  });
  it("handles zero counts and a one-day range without invalid paths", () => {
    const svg = renderChart(
      {
        ...history,
        end: history.start,
        series: [
          toSeries("empty", [{ day: history.start, downloads: 0 }], "daily"),
        ],
      },
      "dark",
    );
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(svg).toContain("<circle");
    expect(svg).toContain("No downloads reported");
  });
  it("renders every comparison series with distinct line patterns", () => {
    const svg = renderChart(
      {
        ...history,
        series: ["first", "second", "third"].map((name) => ({
          ...history.series[0]!,
          package: name,
        })),
      },
      "dark",
    );
    expect(svg).toContain('data-series="2"');
    expect(svg).toContain('stroke-dasharray="8 5"');
    expect(svg).toContain("third");
  });
});
