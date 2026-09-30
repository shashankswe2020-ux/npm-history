import { AppError, parseQuery } from "./history.js";
import { renderChart } from "./chart.js";
import type { NpmClient } from "./npm-client.js";

export interface WorkerEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  MISS_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}
export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
export interface WorkerContext {
  waitUntil(task: Promise<unknown>): void;
}
type WorkerHandler = (
  request: Request,
  environment: WorkerEnvironment,
  context: WorkerContext,
  cache: EdgeCache,
) => Promise<Response>;

const HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000",
  "content-security-policy": "default-src 'none'; sandbox",
};

export function createWorkerHandler(client: NpmClient): WorkerHandler {
  return async (request, environment, context, cache): Promise<Response> => {
    const head = request.method === "HEAD";
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        return Response.json(
          {
            error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or HEAD." },
          },
          { status: 405, headers: { ...HEADERS, allow: "GET, HEAD" } },
        );
      }
      const url = new URL(request.url);
      if (url.pathname.length + url.search.length > 2048)
        throw new AppError(414, "URL_TOO_LONG", "The request URL is too long.");
      if (url.pathname === "/healthz")
        return new Response(head ? null : JSON.stringify({ status: "ok" }), {
          headers: { ...HEADERS, "content-type": "application/json" },
        });
      if (!["/svg", "/api/history"].includes(url.pathname)) {
        if (
          ["/", "/app.js", "/app.css", "/favicon.svg"].includes(url.pathname) ||
          /^\/fonts\/[a-zA-Z0-9_-]+\.woff2$/.test(url.pathname)
        )
          return environment.ASSETS.fetch(request);
        throw new AppError(404, "NOT_FOUND", "Not found.");
      }
      const query = parseQuery(url.searchParams);
      const key = new URL(`/__cache/v1${url.pathname}`, url.origin);
      key.search = new URLSearchParams({
        packages: query.packages.join(","),
        start: query.start,
        end: query.end,
        mode: query.mode,
        theme: url.pathname === "/svg" ? query.theme : "light",
      }).toString();
      const cacheRequest = new Request(key);
      const cached = await cache.match(cacheRequest);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("x-npm-history-cache", "HIT");
        return new Response(head ? null : cached.body, {
          status: cached.status,
          headers,
        });
      }
      if (
        !(
          await environment.MISS_LIMITER.limit({
            key: "npm-history:cache-miss",
          })
        ).success
      )
        throw new AppError(
          429,
          "RATE_LIMITED",
          "The chart service is busy. Please retry in a minute.",
        );
      const history = await client.history(query);
      const svg = url.pathname === "/svg";
      const body = svg
        ? renderChart(history, query.theme)
        : JSON.stringify(history);
      const response = new Response(body, {
        headers: {
          ...HEADERS,
          "content-type": svg
            ? "image/svg+xml; charset=utf-8"
            : "application/json; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "x-npm-history-cache": "MISS",
        },
      });
      context.waitUntil(
        cache.put(cacheRequest, response.clone()).catch(() => undefined),
      );
      return head
        ? new Response(null, { headers: response.headers })
        : response;
    } catch (error) {
      const known =
        error instanceof AppError
          ? error
          : new AppError(
              500,
              "INTERNAL_ERROR",
              "The chart could not be generated. Please retry.",
            );
      return new Response(
        head
          ? null
          : JSON.stringify({
              error: { code: known.code, message: known.message },
            }),
        {
          status: known.status,
          headers: {
            ...HEADERS,
            "content-type": "application/json; charset=utf-8",
            ...(known.status === 429 || known.status === 503
              ? { "retry-after": "60" }
              : {}),
          },
        },
      );
    }
  };
}
