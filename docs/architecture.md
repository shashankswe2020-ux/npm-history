# Architecture and Operations

## Decision: One Small Node Service

The browser and SVG API share a pure D3-based renderer. There is no headless
browser in production. Native HTTP/fetch keeps the deployment a single Node
process; Zod validates both query strings and npm payloads. esbuild produces the
browser bundle, local font assets and server entry. No upstream source was copied.

Inspired by Star History's shareable comparison URLs and standalone chart
images, not its current framework, code or business model. A browser-only chart
would not work in GitHub READMEs; that is why `/svg` runs on the server.

## Data Flow

1. Validate package names, mode, theme and UTC range.
2. Split the selected interval into nonoverlapping, inclusive 365-day chunks.
3. Retrieve each chunk from the fixed `https://api.npmjs.org` origin.
4. Validate the returned package, range and every expected day; sort chronologically.
5. Sum counts once, keeping daily counts alongside the plotted value.
6. Return JSON or escaped, self-contained SVG.

The app deliberately says "since date" instead of "lifetime". Historical npm
availability starts on 2015-01-10; a zero reported by npm is retained, but a day
missing from npm's response is an error. This avoids misleading cumulative totals.

## Bounds

- 3 packages per chart, 2048-character request URL.
- 8 unique concurrent history jobs per process, one sequential fetch per job.
- Identical history jobs and chunks share in-flight work.
- 256 cached chunks, one-hour TTL with least-recently-used eviction.
- 256 KB maximum streamed upstream response, validated before use.
- 8-second per-fetch deadline and a 45-second overall history budget.
- 60-second shared upstream cooldown following a 429; no retry loops.
- 100 accepted connections per process; bounded headers and socket timeouts.

The cache is intentionally ephemeral. A restart refetches data; it does not erase
history at npm. Persistent shared caching is a future scaling option, not a
prerequisite for joining historical intervals. Large cold ranges may time out and
require a retry or narrower range. Concurrent consumers of the same chunk share
that chunk's request deadline.

## Privacy and Security

No accounts, API keys, cookies, analytics, client identifiers, arbitrary URL
fetching or database. Only requested public package names and dates go to npm.
Hosting providers may retain network logs; configure that separately.

Package names cannot inject paths or markup. Upstream redirects are rejected.
SVG text is escaped, scripts and external resources are absent, and the browser
uses textContent for untrusted labels. Static serving is allowlisted. Errors do
not reveal upstream bodies, stack traces or filesystem paths. Fonts are local.

This is not a distributed abuse-prevention system. Add edge request limits,
connection limits, TLS and monitoring before opening a public hosted endpoint.

## Sources

- [npm download API contract](https://github.com/npm/registry/blob/main/docs/download-counts.md)
- [D3 line generation](https://d3js.org/d3-shape/line)
- [D3 UTC scales](https://d3js.org/d3-scale/time#scaleUtc)
- [Node HTTP](https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener)
- [Star History](https://github.com/star-history/star-history)
