# HTTP API

## Routes

| Route              | Response                                                     |
| ------------------ | ------------------------------------------------------------ |
| `GET /api/history` | Validated daily points with plotted values and period totals |
| `GET /svg`         | Standalone, script-free 1000-pixel-wide SVG                  |
| `GET /healthz`     | Local process health; does not contact npm                   |
| `GET /`            | Browser workspace                                            |

HEAD is supported. Other methods return 405 with `Allow: GET, HEAD`.

## Query Parameters

| Parameter  | Meaning                                                                       | Default                   |
| ---------- | ----------------------------------------------------------------------------- | ------------------------- |
| `packages` | 1-3 unique comma-separated lowercase npm package names, scoped names accepted | `whoop-ai-mcp`            |
| `package`  | Singular alias; cannot be combined with `packages`                            | none                      |
| `start`    | Inclusive UTC day, `YYYY-MM-DD`, at least `2015-01-10`                        | 364 days before yesterday |
| `end`      | Inclusive UTC day, no later than yesterday                                    | yesterday                 |
| `mode`     | `cumulative` or `daily`                                                       | `cumulative`              |
| `theme`    | `light` or `dark`; SVG only, does not change numbers                          | `light`                   |

Unknown parameters, repeated parameters, invalid dates, duplicates and reversed
ranges return 400. URL length is limited to 2048 characters.

```sh
curl 'http://127.0.0.1:4317/api/history?package=zod&start=2026-01-01&end=2026-01-02'
curl 'http://127.0.0.1:4317/svg?packages=zod,valibot&start=2026-01-01&theme=dark'
```

JSON fields are `start`, `end`, `mode`, `generatedAt`, and `series`. Each series
has `package`, `total` (sum in the selected period), and `points`. Each point has
`day`, `downloads` (daily count) and `value` (cumulative or daily plotted value).
`generatedAt` is response assembly time, not npm's data publication time.

Successful data/image responses have `Cache-Control: public, max-age=3600`.
Client and CDN caches, including GitHub's image proxy, may delay visual updates.

## Errors

All errors use JSON, including errors on `/svg`, and are `no-store`:

```json
{
  "error": {
    "code": "PACKAGE_NOT_FOUND",
    "message": "npm has no download history for example."
  }
}
```

| Status | Meaning                                             |
| ------ | --------------------------------------------------- |
| 400    | Invalid query                                       |
| 404    | Unknown route, asset or npm package                 |
| 405    | Unsupported method                                  |
| 414    | URL too long                                        |
| 429    | npm rate limit; `Retry-After: 60`                   |
| 500    | Unexpected internal failure; details withheld       |
| 502    | Invalid, incomplete or unavailable npm data         |
| 503    | Concurrent-history limit reached; `Retry-After: 60` |
| 504    | Upstream timeout                                    |

No automatic upstream retries: callers retry after the cooldown or choose a
smaller/earlier range. Never treat an error as zero downloads.
