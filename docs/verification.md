# MVP Verification

Verified locally on 2026-09-30 using Node.js 26.0.0.

- 64 unit/integration/runtime tests pass, with mocked npm responses.
- 7 Chromium browser tests pass: desktop/tablet/mobile at 1440/768/390/320 px,
  nonblank rendered chart pixels, no page/chart overflow, mode/theme changes,
  share clipboard, SVG download, growing embed URLs, keyboard date inspection,
  empty/error recovery and invalid-navigation stale-state protection.
- Strict TypeScript, ESLint, Prettier and production build pass.
- Dependency audit reports zero vulnerabilities, including dev dependencies.
- Manual live checks returned 365 days for whoop-ai-mcp and 2,463 days for Zod
  from 2020-01-01 through 2026-09-28. This proves multi-request history retrieval.
- Desktop/mobile screenshots inspected; README preview uses actual npm data.

Review covered correctness, readability, architecture, security and performance.
Issues found during implementation (mobile chart clipping, stale exports after
invalid navigation, and overall-deadline error mapping) were reproduced in tests
and fixed. No Star History source or assets were copied.

## Remaining Deployment Work

- Public Free-tier beta deployed at https://npm-history.pages.dev with a dedicated
  private npm-history-api Worker. No WHOOP bindings or resources were changed.
- HTTPS, HSTS, live SVG/JSON, scoped packages, input rejection, and live edge
  MISS/HIT were verified. A cold 3-package chart from 2015 succeeded in 35.4s;
  the cached request took 92ms. Runtime tests verify actual rate-limit bindings.
- Sustained-load CPU headroom and availability parity with Star History are not
  certified; quotas remain shared at the Cloudflare account level.
- Verify live README images through GitHub's image proxy and long-term refresh.
- Build and run the Docker image: the local Docker daemon was unavailable.
- Choose an application license before advertising permissive reuse. No license
  was selected on behalf of the owner; third-party licenses are retained separately.
