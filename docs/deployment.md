# Deployment

The repository is ready to run as a Node service. No public hosting or domain is
provisioned by this implementation. GitHub Pages alone cannot run the JSON/SVG API.

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
TLS, CDN behavior, rate limits, GitHub image proxy refresh
and provider health checks must be verified on the selected hosting platform.
