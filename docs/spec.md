# npm-history MVP

## Objective

A standalone public chart tool for npm maintainers: compare up to three packages,
view cumulative or daily downloads, share a URL, and embed a live SVG in a README.
Inspired by Star History's URL-first sharing and server-rendered chart workflow;
this is an independent implementation, not a fork or affiliated service.

## Approved Scope and Plan

1. Test and implement date validation, historical request chunking and cumulative totals.
2. Add bounded cached npm access, JSON API and D3-based SVG rendering.
3. Build a responsive, accessible chart workspace with URL state and export controls.
4. Verify with mocked API tests and desktop/mobile browser tests; add CI and deployment docs.
5. Create the public repository under shashankswe2020-ux, commit and push after verification.

No accounts, database, tracking, paid deployment, or integration into WHOOP MCP.
Release annotations, age-aligned comparisons and persistent caching are deferred.

## Stack and Structure

Node.js 22.13+, 24.x or 26+, strict TypeScript, native HTTP/fetch, Zod, D3, esbuild,
Vitest and Playwright. Original SVG chart, bundled Lucide controls and local fonts.

- src/: query validation, npm client, chart renderer, HTTP handlers and server
- web/: browser TypeScript, CSS and HTML
- tests/: mocked unit/integration tests
- e2e/: browser workflow tests with local synthetic npm responses
- docs/: specification, API and operation notes

## Commands

- npm install
- npm test
- npm run typecheck
- npm run lint
- npm run build
- npm run test:e2e
- npm run dev
- npm start

## Contract

GET /api/history and GET /svg accept packages (comma-separated, max 3),
start/end (inclusive UTC YYYY-MM-DD), mode (cumulative|daily), theme (light|dark).
The singular package alias is supported for embedding. Defaults: zod,
last 365 completed UTC days, cumulative, light. Unknown/duplicate parameters fail.
Dates cannot precede 2015-01-10 or exceed yesterday. SVG theme does not affect data.

History JSON includes start/end, mode, generatedAt and series containing package,
total, and daily points with day/downloads/value. The cumulative baseline is zero
immediately before start. Missing or mismatched npm days fail closed; they are not
invented as zeros. Package not found, throttling and upstream errors are explicit.

Requests use contiguous inclusive chunks of at most 365 days. Historical downloads
are available back to 2015-01-10, subject to npm availability. This is a per-request
size limit, not a rolling retention window. Never claim all-time adoption or users.

## Safety and Resource Limits

Fixed npm API origin, validated package names, redirect rejection, upstream body
size limit and timeout. Bound concurrent history jobs and outbound requests,
deduplicate identical in-flight requests, and bound TTL/LRU cache entries.
JSON errors are no-store, contain no internal details and use appropriate status.
Public deployment requires TLS and edge rate limits; no paid services provisioned.

## Code Style

Named exports, kebab-case files, explicit exported return types, no any, small modules.

```ts
export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(day) + amount * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
```

## Verification and Boundaries

Write failing tests before behavior. Mock all npm calls in automated tests.
Verify chunk boundaries, leap days, missing/duplicate points, validation, errors,
cache expiry/deduplication, SVG escaping and HTTP headers. Browser tests cover
desktop/mobile layout, real rendered SVG pixels, URL state, copy, download,
empty/error states and keyboard controls. Run tests, lint, types, build and audit.

Always keep data labels honest and preserve the existing WHOOP repository.
Ask before adding accounts, paid resources or deployment. Never commit secrets,
copy upstream code without license compliance or fake production download counts.

## Public Hosting Increment (Approved 2026-09-30)

Deploy a separate npm-history Pages project and private npm-history-api Worker
on the existing Cloudflare account, Free plan only, on an independent pages.dev
hostname. No billing changes or WHOOP resource changes or bindings.
Reuse the core npm and SVG modules, add a Fetch-native adapter, static assets,
canonical edge response caching, per-location cache-miss limits, TLS headers,
and deployment/runtime tests. Verify worst-case multi-year charts on the actual
platform before calling the service ready. Free-plan quotas and any failed gates
must be disclosed. Hosting does not imply capacity or availability parity with
Star History. Retain local Node execution as an alternative.

## Sources

- https://github.com/star-history/star-history (product inspiration only)
- https://github.com/npm/registry/blob/main/docs/download-counts.md
- https://d3js.org/d3-scale and https://d3js.org/d3-shape
