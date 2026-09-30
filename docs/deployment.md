# Deployment

Public beta: https://npm-history.pages.dev

## Cloudflare Free Hosting

Two dedicated npm-history resources share one Cloudflare account:

- Pages project `npm-history`: static UI and a small API forwarding function.
- Private Worker `npm-history-api`: npm retrieval, JSON/SVG rendering, cache and rate limit.

The Pages function binds only to `npm-history-api`. There are no WHOOP service,
storage, secret or deployment dependencies. Account billing and daily quotas
remain shared with other projects. The account owner confirmed Workers Free;
the deployment token cannot read billing subscriptions. No billing upgrade,
custom domain purchase, database or paid storage was provisioned.

The API Worker has no public workers.dev URL or preview URL. Pages serves the
independent hostname. Static routes bypass Functions using `_routes.json`.
HTTPS, HSTS, CSP and nosniff are enabled. No client tracking or application
request logs are enabled; provider security/network logging is separate.

### Deploy

```sh
npm ci
npm run build
npm run build:worker
npx wrangler login
npm run deploy:api
npm run deploy:site
```

Select the intended Cloudflare account using `CLOUDFLARE_ACCOUNT_ID` when needed.
`wrangler.json` configures Pages; `wrangler.api.json` configures the private API.
Wrangler 4.144.0 is pinned. The site command uses `--force` to opt out of the
CLI's automatic Pages-to-Workers migration, which would otherwise change the
requested hosting/hostname. It does not force-push Git history.

The initial Pages project was created via the Cloudflare Pages API with
`production_branch: main`, `fail_open: false`, and the dedicated service binding.
Future deploys use the commands above. CI verifies tests/builds but does not
automatically deploy: no deployment token is stored in GitHub.

### Capacity and Caching

- Workers Free: 100,000 dynamic requests/day per account and 10 ms CPU per invocation.
- Pages forwarding and private API calls consume shared platform resources; this
  is not a guarantee of 100,000 completed charts or a Star History-scale SLA.
- The API caches successful JSON/SVG responses for one hour per data center.
- Canonical keys include packages, exact dates, mode and SVG theme. Aliases,
  parameter order and explicit defaults normalize to the same key.
- Errors are never cached. Cache hits bypass the cache-miss limiter.
- Cache misses are limited to 30/minute per Cloudflare location, shared by all
  visitors at that location. The platform limiter is approximate, not a global
  daily quota or precise upstream-call budget. It does not retain IP addresses.
- The Worker creates a client per invocation to avoid sharing in-flight I/O
  between request contexts. Node's per-process job limits are not global edge limits.
- Cold three-package history from 2015 succeeded in a manual smoke test in 35.4s;
  the repeated request was a cache hit in 92ms. These are samples, not guarantees.
- CPU usage under sustained load has not been certified. Multi-year cold requests
  may hit free-tier CPU/time limits. Retry cached data or select a smaller range.
- If daily quota is exhausted, dynamic routes fail closed until quota resets.
  The static UI remains available; a free-only deployment cannot promise unlimited uptime.

### Monitoring and Rollback

Use Cloudflare Workers/Pages aggregate metrics for errors, CPU and request volume.
No custom analytics store or request-body logging is installed. Provider log
retention follows the account settings and has not been independently audited.
For incident response, restore the previous API version with
`npx wrangler rollback <version-id> --config wrangler.api.json`, and select the
previous production Pages deployment in the dashboard. Keep both versions
compatible with the service binding. Rollback commands were not executed against
the live service merely to test them.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Pages routing](https://developers.cloudflare.com/pages/functions/routing/),
[rate-limit locality](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#locality).

GitHub Pages alone cannot run the JSON/SVG API. The Node/container options below
remain available for independent self-hosting.

## Node

```sh
npm ci
npm run build
HOST=0.0.0.0 PORT=4317 npm start
```

`HOST` defaults to loopback for local safety. Bind all interfaces only behind a
trusted reverse proxy or platform gateway. `PORT` must be 1-65535.

## Container

```sh
docker build -t npm-history .
docker run --rm -p 127.0.0.1:4317:4317 npm-history
```

The container uses a non-root user. `/healthz` is a process-health probe, not an
upstream availability guarantee. SIGTERM stops new connections and closes active
connections after a five-second grace period. Cache contents are disposable.

## Public Hosting Checklist

- Configure an HTTPS origin and HTTP-to-HTTPS redirect; apply HSTS at the TLS proxy.
- Permit outbound HTTPS to `api.npmjs.org`; no npm/GitHub token is necessary.
- Apply edge rate limits to `/api/history` and `/svg`, not merely per-process limits.
- Preserve the full query string in CDN cache keys; never cache error responses.
- Keep gateway timeouts above the 45-second history budget.
- Monitor 429/502/503/504 rates and memory; avoid logging full client URLs by default.
- Set provider log retention explicitly. No analytics is built in.
- Use the public HTTPS origin when copying embeds. Localhost URLs do not render on GitHub.
- Deploy a pinned revision; rollback by redeploying the prior image/revision.

## Not Yet Verified

The Dockerfile is provided for portable deployment; the local Docker daemon was
unavailable during verification, so a container build/run is not verified.
Sustained-load CPU headroom, long-term uptime, GitHub image-proxy refresh timing,
provider log retention and rollback execution are not yet certified.
