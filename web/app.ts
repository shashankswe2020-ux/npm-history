import "./style.css";
import {
  createIcons,
  ChartNoAxesCombined,
  GitBranch,
  Moon,
  ArrowRight,
  RefreshCw,
  Link,
  Download,
  Code,
  ArrowUpRight,
  X,
  Copy,
} from "lucide";
import { z } from "zod";
import {
  addDays,
  DAY_MS,
  EARLIEST_DAY,
  parseQuery,
  daySchema,
  packageSchema,
} from "../src/history.js";
import type { History, Query } from "../src/history.js";
import { renderChart } from "../src/chart.js";

createIcons({
  icons: {
    ChartNoAxesCombined,
    GitBranch,
    Moon,
    ArrowRight,
    RefreshCw,
    Link,
    Download,
    Code,
    ArrowUpRight,
    X,
    Copy,
  },
});

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing ${id}`);
  return found as T;
}
const form = element<HTMLFormElement>("query-form");
const packages = element<HTMLInputElement>("packages");
const start = element<HTMLInputElement>("start");
const end = element<HTMLInputElement>("end");
const range = element<HTMLSelectElement>("range");
const status = element<HTMLParagraphElement>("status");
const image = element<HTMLImageElement>("chart-image");
const frame = element<HTMLDivElement>("chart-frame");
const placeholder = element<HTMLDivElement>("chart-placeholder");
const slider = element<HTMLInputElement>("inspect-date");
const dialog = element<HTMLDialogElement>("embed-dialog");
const embedCode = element<HTMLTextAreaElement>("embed-code");
const themeButton = element<HTMLButtonElement>("theme");
const outputButtons = ["share", "download", "embed"].map((id) =>
  element<HTMLButtonElement>(id),
);
const historySchema = z.object({
  start: daySchema,
  end: daySchema,
  mode: z.enum(["cumulative", "daily"]),
  generatedAt: z.string(),
  series: z
    .array(
      z.object({
        package: packageSchema,
        total: z.number().nonnegative(),
        points: z.array(
          z.object({
            day: daySchema,
            downloads: z.number().nonnegative(),
            value: z.number().nonnegative(),
          }),
        ),
      }),
    )
    .min(1)
    .max(3),
});
let current: Query | undefined;
let loaded: History | undefined;
let svgUrl: string | undefined;
let controller: AbortController | undefined;
let selectedTheme: Query["theme"] = "light";
const yesterday = addDays(new Date().toISOString().slice(0, 10), -1);
start.max = yesterday;
end.max = yesterday;

function paramsFor(query: Query): URLSearchParams {
  return new URLSearchParams({
    packages: query.packages.join(","),
    start: query.start,
    end: query.end,
    mode: query.mode,
    theme: query.theme,
  });
}

function applyInputs(query: Query): void {
  packages.value = query.packages.join(",");
  start.value = query.start;
  end.value = query.end;
  form.querySelector<HTMLInputElement>(
    `input[name="mode"][value="${query.mode}"]`,
  )!.checked = true;
  const days = String(
    (Date.parse(query.end) - Date.parse(query.start)) / DAY_MS + 1,
  );
  range.value =
    query.start === EARLIEST_DAY
      ? "all"
      : query.end === yesterday && ["30", "90", "365"].includes(days)
        ? days
        : "custom";
  selectedTheme = query.theme;
  document.documentElement.dataset.theme = query.theme;
  const label = query.theme === "light" ? "Dark theme" : "Light theme";
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
}

function readInputs(): Query {
  return parseQuery(
    new URLSearchParams({
      packages: packages.value
        .split(",")
        .map((name) => name.trim())
        .join(","),
      start: start.value,
      end: end.value,
      mode: form.querySelector<HTMLInputElement>('input[name="mode"]:checked')!
        .value,
      theme: selectedTheme,
    }),
  );
}

function inspect(): void {
  if (!loaded) return;
  const index = Number(slider.value);
  const day = loaded.series[0]?.points[index]?.day;
  const values = loaded.series.map(
    (series) =>
      `${series.package}: ${series.points[index]?.value.toLocaleString("en-US") ?? "unavailable"}`,
  );
  element<HTMLOutputElement>("readout").textContent =
    `${day ?? ""} UTC | ${values.join(" | ")}`;
}

function render(history: History, query: Query): void {
  renderImage(history, query);
  const table = element<HTMLTableElement>("summary");
  const body = table.tBodies[0]!;
  body.replaceChildren();
  history.series.forEach((series, index) => {
    const row = body.insertRow();
    const name = row.insertCell();
    const mark = document.createElement("span");
    mark.className = `series-mark series-${index}`;
    mark.textContent = `${index + 1}.`;
    name.append(mark, document.createTextNode(series.package));
    row.insertCell().textContent = series.total.toLocaleString("en-US");
    row.insertCell().textContent = Math.round(
      series.total / Math.max(1, series.points.length),
    ).toLocaleString("en-US");
  });
  table.hidden = false;
  slider.max = String(Math.max(0, (history.series[0]?.points.length ?? 1) - 1));
  slider.value = slider.max;
  element("inspector").hidden = false;
  inspect();
}

function renderImage(history: History, query: Query): void {
  const nextUrl = URL.createObjectURL(
    new Blob(
      [
        renderChart(
          history,
          query.theme,
          Math.max(280, Math.min(1000, frame.clientWidth)),
        ),
      ],
      { type: "image/svg+xml" },
    ),
  );
  if (svgUrl) URL.revokeObjectURL(svgUrl);
  svgUrl = nextUrl;
  image.src = nextUrl;
  image.alt = `${query.mode} npm downloads for ${query.packages.join(", ")} from ${query.start} through ${query.end}`;
  image.hidden = false;
  placeholder.hidden = true;
}

function clearResults(): void {
  controller?.abort();
  current = undefined;
  loaded = undefined;
  outputButtons.forEach((button) => {
    button.disabled = true;
  });
  image.hidden = true;
  placeholder.hidden = false;
  element("summary").hidden = true;
  element("inspector").hidden = true;
  if (svgUrl) URL.revokeObjectURL(svgUrl);
  svgUrl = undefined;
}

async function load(query: Query, push = true): Promise<void> {
  clearResults();
  const active = new AbortController();
  controller = active;
  placeholder.querySelector("span")!.textContent = "Loading history";
  frame.setAttribute("aria-busy", "true");
  status.textContent = "Loading download history...";
  status.dataset.error = "false";
  applyInputs(query);
  if (push) window.history.pushState(null, "", `/?${paramsFor(query)}`);
  try {
    const response = await fetch(`/api/history?${paramsFor(query)}`, {
      signal: active.signal,
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ message: z.string() }) })
        .safeParse(data);
      throw new Error(
        error.success
          ? error.data.error.message
          : "Download history is unavailable.",
      );
    }
    const history = historySchema.parse(data);
    if (active.signal.aborted) return;
    loaded = history;
    current = query;
    render(history, query);
    outputButtons.forEach((button) => {
      button.disabled = false;
    });
    status.textContent = history.series.every((series) => series.total === 0)
      ? "No downloads reported in this period"
      : `Updated ${new Date(history.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} / through ${history.end} UTC`;
  } catch (error) {
    if (active.signal.aborted) return;
    status.dataset.error = "true";
    status.textContent =
      error instanceof Error && !(error instanceof z.ZodError)
        ? error.message
        : "The chart data could not be read. Please retry.";
    placeholder.querySelector("span")!.textContent = "History unavailable";
  } finally {
    if (!active.signal.aborted) frame.setAttribute("aria-busy", "false");
  }
}

function submit(): void {
  if (!form.reportValidity()) return;
  try {
    void load(readInputs());
  } catch (error) {
    clearResults();
    placeholder.querySelector("span")!.textContent = "Check chart parameters";
    frame.setAttribute("aria-busy", "false");
    status.dataset.error = "true";
    status.textContent =
      error instanceof Error ? error.message : "Check the chart parameters.";
  }
}

async function copy(
  text: string,
  message: string,
  noticeId = "notice",
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    element(noticeId).textContent = message;
  } catch {
    embedCode.value = text;
    if (!dialog.open) dialog.showModal();
    embedCode.focus();
    embedCode.select();
    element("embed-notice").textContent =
      "Clipboard unavailable. The text is selected for copying.";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submit();
});
form
  .querySelectorAll('input[name="mode"]')
  .forEach((input) => input.addEventListener("change", submit));
range.addEventListener("change", () => {
  if (range.value === "custom") {
    start.focus();
    return;
  }
  end.value = yesterday;
  start.value =
    range.value === "all"
      ? EARLIEST_DAY
      : addDays(yesterday, 1 - Number(range.value));
  submit();
});
for (const input of [start, end])
  input.addEventListener("change", () => {
    range.value = "custom";
    submit();
  });
themeButton.addEventListener("click", () => {
  selectedTheme = selectedTheme === "light" ? "dark" : "light";
  submit();
});
slider.addEventListener("input", inspect);
element("retry").addEventListener("click", submit);
element("share").addEventListener("click", () => {
  if (current)
    void copy(`${location.origin}/?${paramsFor(current)}`, "Share link copied");
});
element("download").addEventListener("click", () => {
  if (!loaded || !current) return;
  const link = document.createElement("a");
  const downloadUrl = URL.createObjectURL(
    new Blob([renderChart(loaded, current.theme)], { type: "image/svg+xml" }),
  );
  link.href = downloadUrl;
  link.download = "npm-history.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 10_000);
});
element("embed").addEventListener("click", () => {
  if (!current) return;
  const params = paramsFor(current);
  params.delete("end");
  const imageUrl = `${location.origin}/svg?${params}`;
  const pageUrl = `${location.origin}/?${params}`;
  embedCode.value = `[![npm download history](${imageUrl})](${pageUrl})`;
  element("embed-notice").textContent = "";
  dialog.showModal();
});
element("close-embed").addEventListener("click", () => dialog.close());
element("copy-embed").addEventListener("click", () => {
  void copy(embedCode.value, "Markdown copied", "embed-notice");
});

function fromUrl(): void {
  try {
    void load(parseQuery(new URLSearchParams(location.search)), false);
  } catch {
    clearResults();
    applyInputs(parseQuery(new URLSearchParams()));
    status.textContent =
      "Invalid chart URL. Check the parameters and plot again.";
    status.dataset.error = "true";
    placeholder.querySelector("span")!.textContent = "Invalid chart URL";
    frame.setAttribute("aria-busy", "false");
  }
}
window.addEventListener("popstate", fromUrl);
let chartWidth = 0;
new ResizeObserver(() => {
  if (frame.clientWidth === chartWidth) return;
  chartWidth = frame.clientWidth;
  if (loaded && current) renderImage(loaded, current);
}).observe(frame);
fromUrl();
