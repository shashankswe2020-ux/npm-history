import { format, line, scaleLinear, scaleUtc, utcFormat } from "d3";
import type { History, Query, Series } from "./history.js";

export const SERIES_COLORS = ["#cf3341", "#087f82", "#a16b08"];

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

export function renderChart(
  history: History,
  theme: Query["theme"],
  width = 1000,
): string {
  const compactLayout = width < 700;
  const height = compactLayout ? 500 + history.series.length * 48 : 620;
  const dark = theme === "dark";
  const background = dark ? "#191b1d" : "#ffffff";
  const ink = dark ? "#eff1f2" : "#25292d";
  const muted = dark ? "#a8afb6" : "#606b73";
  const grid = dark ? "#34383c" : "#e6e9eb";
  const colors = dark ? ["#ff7b86", "#51c9c1", "#efbf59"] : SERIES_COLORS;
  const patterns = ["none", "8 5", "2 5"];
  const left = compactLayout ? 54 : 80;
  const right = width - (compactLayout ? 35 : 70);
  const top = compactLayout ? 112 : 130;
  const bottom = compactLayout ? 390 : 460;
  const start = Date.parse(history.start);
  const end = Date.parse(history.end);
  const horizontal = scaleUtc()
    .domain(
      start === end
        ? [new Date(start - 43_200_000), new Date(end + 43_200_000)]
        : [new Date(start), new Date(end)],
    )
    .range([left, right]);
  const maximum = Math.max(
    1,
    ...history.series.flatMap((series) =>
      series.points.map((point) => point.value),
    ),
  );
  const vertical = scaleLinear()
    .domain([0, maximum * 1.06])
    .nice(5)
    .range([bottom, top]);
  const path = line<Series["points"][number]>()
    .x((point) => horizontal(new Date(point.day)))
    .y((point) => vertical(point.value));
  const compact = format("~s");
  const text = (
    content: string,
    positionX: number,
    positionY: number,
    attributes = "",
  ): string =>
    `<text x="${positionX}" y="${positionY}" ${attributes}>${escapeXml(content)}</text>`;
  const heading =
    history.mode === "cumulative" ? "Cumulative downloads" : "Daily downloads";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-description">`,
    `<title id="chart-title">${heading}: ${escapeXml(history.series.map((series) => series.package).join(", "))}</title>`,
    `<desc id="chart-description">${escapeXml(`${history.start} through ${history.end}, inclusive UTC. ${history.mode === "cumulative" ? "Cumulative totals start at zero before the selected period. " : ""}Downloads are not unique users. ${history.series.map((series) => `${series.package}: ${series.total} downloads in this period`).join(". ")}`)}</desc>`,
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
    `<g font-family="sans-serif" font-size="${compactLayout ? 11 : 14}" fill="${ink}">`,
    text(
      heading,
      compactLayout ? 18 : 38,
      40,
      `font-size="${compactLayout ? 20 : 25}" font-weight="700"`,
    ),
    ...(compactLayout
      ? [
          text(`Since ${history.start}`, 18, 64, `fill="${muted}"`),
          text(`through ${history.end} UTC`, 18, 82, `fill="${muted}"`),
        ]
      : [
          text(
            `Since ${history.start}  /  through ${history.end} UTC`,
            38,
            72,
            `fill="${muted}"`,
          ),
          text(
            "npm-history",
            width - 40,
            40,
            `text-anchor="end" font-size="17" fill="${muted}"`,
          ),
        ]),
  ];
  for (const tick of vertical.ticks(5)) {
    parts.push(
      `<line x1="${left}" x2="${right}" y1="${vertical(tick)}" y2="${vertical(tick)}" stroke="${grid}"/>`,
      text(
        compact(tick),
        left - 14,
        vertical(tick) + 5,
        `text-anchor="end" fill="${muted}"`,
      ),
    );
  }
  const ticks =
    start === end
      ? [new Date(start)]
      : horizontal
          .ticks(compactLayout ? 3 : 5)
          .filter((tick) => tick.getUTCHours() === 0);
  const dateFormat = utcFormat(
    end - start < 90 * 86_400_000 ? "%b %d" : "%b %Y",
  );
  for (const tick of ticks)
    parts.push(
      text(
        dateFormat(tick),
        horizontal(tick),
        bottom + 30,
        `text-anchor="middle" fill="${muted}"`,
      ),
    );
  history.series.forEach((series, index) => {
    const color = colors[index % colors.length]!;
    parts.push(
      `<path data-series="${index}" d="${path(series.points) ?? ""}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${patterns[index % patterns.length]}"/>`,
    );
    const last = series.points.at(-1);
    if (last)
      parts.push(
        `<circle cx="${horizontal(new Date(last.day))}" cy="${vertical(last.value)}" r="4" fill="${color}"/>`,
      );
    const maxName = compactLayout
      ? Math.floor((width - 82) / 7.5)
      : Math.floor((width / 3 - 64) / 7.5);
    const name =
      series.package.length > maxName
        ? `${series.package.slice(0, maxName - 3)}...`
        : series.package;
    const column = compactLayout ? 18 : 40 + (index * (width - 34)) / 3;
    const row = compactLayout ? 449 + index * 48 : 535;
    parts.push(
      `<line x1="${column}" x2="${column + 24}" y1="${row}" y2="${row}" stroke="${color}" stroke-width="3" stroke-dasharray="${patterns[index % patterns.length]}"/>`,
      text(name, column + 34, row + 5, 'font-size="14"'),
      text(
        `${series.total.toLocaleString("en-US")} in period`,
        column + 34,
        row + 25,
        `font-size="13" fill="${muted}"`,
      ),
    );
  });
  if (history.series.every((series) => series.total === 0))
    parts.push(
      text(
        "No downloads reported",
        width / 2,
        260,
        `text-anchor="middle" fill="${muted}"`,
      ),
    );
  parts.push(
    text(
      compactLayout
        ? "npm-history / Source: npm downloads API"
        : "Source: npm downloads API. Downloads are not unique users.",
      compactLayout ? 18 : 38,
      height - 20,
      `font-size="${compactLayout ? 10 : 12}" fill="${muted}"`,
    ),
    "</g></svg>",
  );
  return parts.join("\n");
}
