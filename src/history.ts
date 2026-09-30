import { z } from "zod";

export const EARLIEST_DAY = "2015-01-10";
export const DAY_MS = 86_400_000;
export const packageSchema = z
  .string()
  .min(1)
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(value);
    return (
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === value
    );
  });

export type Mode = "cumulative" | "daily";
export interface Query {
  packages: string[];
  start: string;
  end: string;
  mode: Mode;
  theme: "light" | "dark";
}
export interface DayCount {
  day: string;
  downloads: number;
}
export interface Series {
  package: string;
  total: number;
  points: (DayCount & { value: number })[];
}
export interface History {
  start: string;
  end: string;
  mode: Mode;
  generatedAt: string;
  series: Series[];
}

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(day) + amount * DAY_MS).toISOString().slice(0, 10);
}

export function parseQuery(params: URLSearchParams, now = new Date()): Query {
  const yesterday = addDays(now.toISOString().slice(0, 10), -1);
  const invalid = (): never => {
    throw new AppError(
      400,
      "INVALID_QUERY",
      "Use up to 3 unique npm packages, valid UTC dates from 2015-01-10 through yesterday, mode cumulative or daily, and theme light or dark.",
    );
  };
  const keys = [...params.keys()];
  if (
    new Set(keys).size !== keys.length ||
    (params.has("package") && params.has("packages"))
  )
    invalid();
  const schema = z
    .object({
      package: packageSchema.optional(),
      packages: z.string().max(644).optional(),
      start: daySchema.default(addDays(yesterday, -364)),
      end: daySchema.default(yesterday),
      mode: z.enum(["cumulative", "daily"]).default("cumulative"),
      theme: z.enum(["light", "dark"]).default("light"),
    })
    .strict();
  const result = schema.safeParse(Object.fromEntries(params));
  if (!result.success) return invalid();
  const { start, end, mode, theme } = result.data;
  const packages = (result.data.packages ?? result.data.package ?? "zod").split(
    ",",
  );
  if (
    packages.length > 3 ||
    new Set(packages).size !== packages.length ||
    packages.some((name) => !packageSchema.safeParse(name).success) ||
    start < EARLIEST_DAY ||
    end > yesterday ||
    start > end
  )
    invalid();
  return { packages, start, end, mode, theme };
}

export function dateChunks(
  start: string,
  end: string,
): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  for (let cursor = start; cursor <= end;) {
    const chunkEnd = addDays(cursor, 364) < end ? addDays(cursor, 364) : end;
    chunks.push({ start: cursor, end: chunkEnd });
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

export function toSeries(name: string, days: DayCount[], mode: Mode): Series {
  let total = 0;
  const points = days.map((point) => {
    total += point.downloads;
    if (!Number.isSafeInteger(total))
      throw new AppError(
        502,
        "INVALID_UPSTREAM",
        "npm returned counts outside the supported numeric range.",
      );
    return { ...point, value: mode === "cumulative" ? total : point.downloads };
  });
  return { package: name, total, points };
}
