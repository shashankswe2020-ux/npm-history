import { z } from "zod";
import {
  addDays,
  AppError,
  dateChunks,
  daySchema,
  DAY_MS,
  toSeries,
} from "./history.js";
import type { DayCount, History, Query } from "./history.js";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
interface Options {
  fetcher?: Fetcher;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
  maxJobs?: number;
}
export interface NpmClient {
  history(query: Query): Promise<History>;
}

const upstreamSchema = z.object({
  package: z.string(),
  start: daySchema,
  end: daySchema,
  downloads: z
    .array(
      z.object({
        day: daySchema,
        downloads: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .max(365),
});

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(
      502,
      "INVALID_UPSTREAM",
      "npm returned an empty response.",
    );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256_000)
        throw new AppError(
          502,
          "INVALID_UPSTREAM",
          "npm returned an oversized response.",
        );
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createNpmClient(options: Options = {}): NpmClient {
  const {
    fetcher = fetch,
    now = Date.now,
    ttlMs = 3_600_000,
    maxEntries = 256,
    maxJobs = 8,
  } = options;
  const cache = new Map<string, { expires: number; days: DayCount[] }>();
  const jobs = new Map<string, Promise<DayCount[][]>>();
  const pendingChunks = new Map<string, Promise<DayCount[]>>();
  let cooldownUntil = 0;

  async function fetchChunk(
    name: string,
    start: string,
    end: string,
    signal: AbortSignal,
  ): Promise<DayCount[]> {
    const key = `${name}:${start}:${end}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.days;
    }
    cache.delete(key);
    const existing = pendingChunks.get(key);
    if (existing) return existing;
    if (now() < cooldownUntil)
      throw new AppError(
        429,
        "UPSTREAM_RATE_LIMIT",
        "npm is rate limiting requests. Try again in a minute.",
      );

    const task = (async (): Promise<DayCount[]> => {
      try {
        const response = await fetcher(
          `https://api.npmjs.org/downloads/range/${start}:${end}/${encodeURIComponent(name)}`,
          {
            redirect: "error",
            signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
            headers: {
              accept: "application/json",
              "user-agent": "npm-history/0.1",
            },
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404)
            throw new AppError(
              404,
              "PACKAGE_NOT_FOUND",
              `npm has no download history for ${name}.`,
            );
          if (response.status === 429) {
            cooldownUntil = now() + 60_000;
            throw new AppError(
              429,
              "UPSTREAM_RATE_LIMIT",
              "npm is rate limiting requests. Try again in a minute.",
            );
          }
          throw new AppError(
            502,
            "UPSTREAM_UNAVAILABLE",
            "npm download data is temporarily unavailable.",
          );
        }
        const parsed = upstreamSchema.safeParse(await boundedJson(response));
        if (!parsed.success)
          throw new AppError(
            502,
            "INVALID_UPSTREAM",
            "npm returned invalid download data.",
          );
        const data = parsed.data;
        const days = [...data.downloads].sort((left, right) =>
          left.day.localeCompare(right.day),
        );
        const expected = (Date.parse(end) - Date.parse(start)) / DAY_MS + 1;
        if (
          data.package !== name ||
          data.start !== start ||
          data.end !== end ||
          days.length !== expected ||
          days.some((point, index) => point.day !== addDays(start, index))
        ) {
          throw new AppError(
            502,
            "INCOMPLETE_HISTORY",
            "npm has not returned every requested day. Try an earlier end date or retry later.",
          );
        }
        cache.set(key, { days, expires: now() + ttlMs });
        while (cache.size > maxEntries)
          cache.delete(cache.keys().next().value!);
        return days;
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (
          signal.aborted ||
          (error instanceof Error &&
            ["TimeoutError", "AbortError"].includes(error.name))
        ) {
          throw new AppError(
            504,
            "UPSTREAM_TIMEOUT",
            "npm took too long to respond. Please retry.",
          );
        }
        throw new AppError(
          502,
          "UPSTREAM_UNAVAILABLE",
          "Could not read npm download data. Please retry.",
        );
      }
    })();
    pendingChunks.set(key, task);
    try {
      return await task;
    } finally {
      pendingChunks.delete(key);
    }
  }

  async function load(query: Query): Promise<DayCount[][]> {
    const signal = AbortSignal.timeout(45_000);
    const results: DayCount[][] = [];
    for (const name of query.packages) {
      const days: DayCount[] = [];
      for (const chunk of dateChunks(query.start, query.end)) {
        if (signal.aborted)
          throw new AppError(
            504,
            "UPSTREAM_TIMEOUT",
            "The history request took too long. Please retry or select a smaller range.",
          );
        days.push(...(await fetchChunk(name, chunk.start, chunk.end, signal)));
      }
      results.push(days);
    }
    return results;
  }

  return {
    async history(query): Promise<History> {
      const key = JSON.stringify([query.packages, query.start, query.end]);
      let job = jobs.get(key);
      if (!job) {
        if (jobs.size >= maxJobs)
          throw new AppError(
            503,
            "BUSY",
            "The chart service is busy. Please retry shortly.",
          );
        job = load(query);
        jobs.set(key, job);
      }
      try {
        const days = await job;
        return {
          start: query.start,
          end: query.end,
          mode: query.mode,
          generatedAt: new Date(now()).toISOString(),
          series: query.packages.map((name, index) =>
            toSeries(name, days[index]!, query.mode),
          ),
        };
      } finally {
        if (jobs.get(key) === job) jobs.delete(key);
      }
    },
  };
}
