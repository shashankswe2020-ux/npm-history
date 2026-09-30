# Contributing

Use Node.js 22.13+, 24.x or 26+ and install with `npm ci`. Read `docs/spec.md` and `docs/api.md`
before changing chart semantics or endpoint behavior.

Write a failing test for behavior changes, then implement the smallest fix.
Automated tests must mock npm. Keep TypeScript strict, validate external data,
use named exports and avoid `any`. Preserve the meaning of cumulative baselines;
do not label downloads as users or adoption.

Before a pull request:

```sh
npm run format
npm run lint
npm run typecheck
npm test -- --coverage
npm run build
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=low
```

Include the behavior change and verification results. Keep formatting-only
changes separate from behavior changes to existing code. Do not commit secrets,
generated builds, local environment files or browser traces.
