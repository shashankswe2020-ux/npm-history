import { readFile } from "node:fs/promises";
import type { RequestListener, ServerResponse } from "node:http";
import { AppError, parseQuery } from "./history.js";
import { renderChart } from "./chart.js";
import type { NpmClient } from "./npm-client.js";

const MIME: Record<string, string> = {
  "/": "text/html; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/app.css": "text/css; charset=utf-8",
  "/favicon.svg": "image/svg+xml",
};

export function createHandler(client: NpmClient, assets: URL): RequestListener {
  return (request, response): void => {
    const head = request.method === "HEAD";
    const send = (
      status: number,
      body: string | Buffer,
      type = "application/json; charset=utf-8",
    ): void => {
      response.statusCode = status;
      response.setHeader("content-type", type);
      response.setHeader("content-length", Buffer.byteLength(body));
      response.end(head ? undefined : body);
    };
    secure(response);
    void (async () => {
      if (!["GET", "HEAD"].includes(request.method ?? "")) {
        response.setHeader("allow", "GET, HEAD");
        throw new AppError(405, "METHOD_NOT_ALLOWED", "Use GET or HEAD.");
      }
      if ((request.url?.length ?? 0) > 2048)
        throw new AppError(414, "URL_TOO_LONG", "The request URL is too long.");
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/healthz") {
        send(200, JSON.stringify({ status: "ok" }));
        return;
      }
      if (url.pathname === "/api/history" || url.pathname === "/svg") {
        const query = parseQuery(url.searchParams);
        const history = await client.history(query);
        response.setHeader("cache-control", "public, max-age=3600");
        if (url.pathname === "/svg") {
          response.setHeader(
            "content-security-policy",
            "default-src 'none'; sandbox",
          );
          send(
            200,
            renderChart(history, query.theme),
            "image/svg+xml; charset=utf-8",
          );
        } else send(200, JSON.stringify(history));
        return;
      }
      const font = /^\/fonts\/[a-zA-Z0-9_-]+\.woff2$/.test(url.pathname);
      const type = MIME[url.pathname] ?? (font ? "font/woff2" : undefined);
      if (!type) throw new AppError(404, "NOT_FOUND", "Not found.");
      const file = new URL(
        url.pathname === "/" ? "index.html" : url.pathname.slice(1),
        assets,
      );
      const content = await readFile(file).catch(() => {
        throw new AppError(404, "NOT_FOUND", "Not found.");
      });
      response.setHeader(
        "cache-control",
        font ? "public, max-age=86400" : "no-cache",
      );
      send(200, content, type);
    })().catch((error: unknown) => {
      const known =
        error instanceof AppError
          ? error
          : new AppError(
              500,
              "INTERNAL_ERROR",
              "The chart could not be generated. Please retry.",
            );
      response.setHeader("cache-control", "no-store");
      if (known.status === 429 || known.status === 503)
        response.setHeader("retry-after", "60");
      send(
        known.status,
        JSON.stringify({ error: { code: known.code, message: known.message } }),
      );
    });
  };
}

function secure(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
}
