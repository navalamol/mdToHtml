# Tech Stack and Architecture Evaluation

An honest assessment for architects and senior developers evaluating this system. Written as of 2026-10.

---

## TL;DR

The stack is well-chosen and architecturally coherent. The contract-first API, typed i18n, and typed error keys are genuinely excellent patterns that eliminate whole classes of runtime bugs at compile time. The main gaps are operational: no local mock layer forces real credentials for onboarding, there is no E2E test suite despite the tooling being in place, and several quality gates that should be automated (knowledge-sync, typecheck on commit) rely on developer memory. These are fixable; none represents a fundamental architectural problem.

---

## What's excellent

### oRPC contract-first API

Zod schemas and oRPC contracts in `@repo/core-contracts` are the single source of truth for every API shape. The BFF `implement(contract)` call enforces handler input/output types at compile time. The isomorphic client inherits those types with no manual casting.

In practice this means: if the upstream service changes a field shape and you update the Zod schema, TypeScript immediately shows every call site that needs to change — across both apps, in a single `pnpm typecheck` run. There is no "we updated the API but forgot to update the client" class of bug.

The `absorb-openapi-changes` skill propagates upstream spec drift through the BFF stack. Having a defined process for this is rare and valuable.

### TanStack ecosystem (Router, Query, Form)

Each of the three TanStack libraries is best-in-class for its domain.

**TanStack Router** generates a fully typed route tree from filesystem conventions. `Link` components and `useNavigate` accept only routes that exist — broken internal links are build errors, not 404s discovered in QA. The `beforeLoad` hook is a clean place for permission guards; it runs before any data is fetched, so unauthorized users are redirected before any component renders.

**TanStack Query** eliminates manual loading/error/refetch state management. The `useSuspenseQuery` integration means components receive data directly — no `if (isLoading) return <Spinner />` branches. Cache invalidation, background refetching, and deduplication are handled automatically.

**TanStack Form** is notably better than Formik or React Hook Form for this use case. The `isDefaultValue` check (used here instead of `isDirty`) is a live deep-equality check that returns to `true` when the user restores the original value — something `isDirty` cannot do. This makes the unsaved-changes guard accurate.

### Zod 4

Zod powers both compile-time type inference and runtime validation. Every API input/output is validated on both sides of the network. Schema drift between the BFF and the upstream service produces a clear `validation.*` error with span attributes rather than a mysterious runtime crash. Zod 4 in particular has significant performance improvements over v3 for parsing large payloads.

### Typed error keys and typed i18n selectors

Both patterns apply the same principle: make a missing key a build error rather than a production defect.

`ErrorKey` is a closed union in `@repo/core-contracts`. `throwError({ errorKey })` only accepts a member of that union. Each member must have a corresponding `errors.<key>` entry in all four locale files or `tsc` fails.

Translation selectors (`t($ => $.vendor.title)`) are validated against the compiled shape of the locale type. Adding a key to one locale file but not the others fails the build.

These patterns are rare in industry codebases. Most teams discover missing error messages or translation keys in production. Enforcing completeness at compile time is a significant quality advantage.

### No barrel files with granular subpath exports

`@syndigo/orpc` is declared `"sideEffects": false`. This allows Rollup/Vite to tree-shake the entire server-side router graph from the browser bundle — but only if the import graph is clean. A barrel file that re-exports both server and client code would break this guarantee and potentially leak server-only dependencies into the browser bundle.

The granular subpath export pattern (`@syndigo/design-system/components/button`) is more verbose than barrel imports but correct for this architecture. The IDE experience is acceptable given language server support.

### pnpm workspaces + Turbo

pnpm's workspace protocol (`workspace:*`) links packages locally without the overhead of npm link. Turbo's incremental task graph means `pnpm build` only rebuilds packages whose source changed since the last build. For a monorepo of this size, this makes the inner development loop fast enough to be practical.

### SSR with isomorphic client

The isomorphic client calls the router directly during server-side rendering — no HTTP hop, no waterfall. The initial page load delivers a fully rendered page with real data. TanStack Query hydrates its cache from the server render, so the browser doesn't refetch data it already has. This is the correct architecture for a data-heavy enterprise application where first-load performance matters.

---

## What's solid but has known tradeoffs

### TypeScript 6

TypeScript 6 (`tsgo`) is very new. The `verbatimModuleSyntax` and other strict settings are correct long-term choices. The risk is ecosystem compatibility — some tools and plugins that work against the TypeScript compiler API may lag behind TS 6. If you integrate third-party tooling (code generators, linting rules, IDE plugins), verify TS 6 support before adopting.

### Vite 8

Similarly new. The core build pipeline is reliable, but edge cases in Vite 8's SSR handling are less documented than Vite 5's. When you hit a build issue that doesn't appear in any Stack Overflow result, you're in early-adopter territory and will need to read source or open an issue.

### TanStack Start

TanStack Start on Nitro is a strong foundation, but it has a fraction of the community footprint that Next.js App Router has. "How do I do X in TanStack Start" has fewer third-party answers than "how do I do X in Next.js." The upside is that the TanStack team is responsive and the documentation has improved substantially in 2026. This tradeoff is acceptable given the type-safety advantages of TanStack Router.

### Manual knowledge base sync

The `.claude/knowledge/` directory is a curated map of the codebase that Claude Code uses to answer questions about it. The `knowledge-sync` skill must be run after any significant change to `apps/` or `packages/`, and `kb_lint.py` must exit 0. This process relies on developer memory and is easy to skip under time pressure. If it drifts, Claude's answers about the codebase become stale.

The fix is a git pre-commit hook or a CI step that fails if the knowledge base is out of sync with the staged diff.

### BFF stub pattern (ENABLE_BFF_STUBS)

Several procedures have `*.mock.ts` files that return stub data when `ENABLE_BFF_STUBS=true`. This is a pragmatic way to develop the UI before the upstream service is ready. The risk is drift: if the stub's shape diverges from the real upstream response, the stub becomes misleading. Without a contract test that validates the stub against the real upstream schema, this drift won't be caught until the stub is disabled.

---

## What should be improved

### No local mock layer for offline development

The biggest day-one onboarding friction: developers need real credentials (`AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `CSL_ONBOARDING_SERVICE_AUTHORIZATION`) to run the app at all. Without those credentials, both apps fail immediately.

**Recommendation:** Add MSW (Mock Service Worker) to intercept oRPC `/rpc` requests in development. Define a baseline set of mock responses for the most common procedures. This allows the app to run entirely offline without credentials, shortens onboarding from "ask teammates for secrets" to "clone and run", and enables reliable Vitest component tests that don't require a live upstream.

### Auth gap between development and production

`NODE_ENV=development` bypasses the auth session check entirely. Developers never exercise the real auth flow locally. A misconfigured auth setup will only surface in a staging environment.

**Recommendation:** Either (a) provision a shared test tenant with real Auth0 session cookies that developers can copy into their browser, or (b) run a local Auth0 tenant via Auth0's CLI (`auth0 test login`). Either approach closes the gap between local and deployed behavior for the auth path.

### No committed E2E test suite

The `playwright-cli` skill exists and the infrastructure is in place. But there are no committed Playwright test files. This means every regression in a critical user flow (vendor list loading, tenant onboarding, permission redirects) is caught by manual QA or production.

**Recommendation:** Start with one golden-path E2E test per major feature area: vendor list loads, a form submits, a permission guard redirects correctly. These three tests alone would catch the most common regressions. The `playwright-cli` skill makes writing them fast.

### No design system documentation

`@syndigo/design-system` has no Storybook, no component catalogue, and no usage examples outside the apps. A developer who wants to know what `DataTable` props exist must read `packages/design-system/src/components/data-table/index.tsx`.

**Recommendation:** Add Storybook with one story per component. This is a one-day investment with compounding returns: every new developer can discover available components without reading source, and visual regressions become visible in CI.

### Knowledge base sync should be automated

As noted above — this relies on developer memory. It is a quality gate, not a nice-to-have.

**Recommendation:** Add a git pre-commit hook (`lefthook` or `husky`) that runs `py -3 .claude/skills/knowledge-sync/scripts/kb_lint.py` against the staged diff. If the lint fails, the commit is blocked until the knowledge base is updated.

### No error alerting

OTel traces capture every error with a `traceId` that links back to the span. But there is no configured alert that fires when the error rate exceeds a threshold. An error wave in production is only visible if someone is actively watching the Grafana trace view.

**Recommendation:** Add a Grafana alert rule on the oRPC error rate (available from span status attributes). A simple threshold alert — "more than N INTERNAL_SERVER_ERROR spans in 5 minutes" — closes the loop from "error is traced" to "someone knows".

### No server-side caching strategy

TanStack Query caches data on the client. But there is no documented or implemented caching at the BFF layer. A frequently called procedure like `vendor.list` hits the upstream service on every SSR page load and on every cache miss in the browser. For procedures with stable, read-heavy data, a short TTL cache in the BFF would reduce upstream load significantly.

**Recommendation:** Document the caching policy per procedure domain: which procedures are safe to cache, for how long, and with what cache key. Then implement it for the highest-traffic read procedures. Node's `lru-cache` or a Redis layer are both viable.

### No API contract compliance tests

The upstream OpenAPI specs in `packages/orpc/specs/` are the source of truth. The `absorb-openapi-changes` skill propagates spec changes through the BFF. But there is no automated test that verifies the running upstream service actually matches the spec. Upstream services can change their behavior without updating their spec.

**Recommendation:** Add a nightly CI job that runs the oRPC procedure test suite against the real QA upstream environment. A procedure that returns data not matching its Zod schema will fail the test, catching spec drift before it reaches production.

---

## Architecture evolution path

These recommendations are ordered by impact-to-effort ratio. Do them in sequence to avoid compounding work.

**Phase 1 — Now (days):** Automate the quality gates that currently rely on memory. Set up git pre-commit hooks for `pnpm typecheck`, `pnpm lint`, and knowledge-sync lint. The development loop already works; this just removes the human step.

**Phase 2 — 3 months:** Add MSW mock layer and Storybook. Both unblock faster onboarding and parallel development (UI work can proceed without real upstream credentials). Add the first three golden-path E2E tests.

**Phase 3 — 6 months:** API contract compliance tests running nightly in CI. Error rate alerting in Grafana. At this point the observability story is complete: errors are traced, alerted on, and linked to a trace ID in the support ticket.

**Phase 4 — 12 months:** BFF-level caching for high-traffic read procedures. Local auth provider setup. A committed suite of E2E tests covering all major feature areas. At this point the system is mature enough that a developer can make a significant change with confidence that regressions will be caught automatically before they reach production.

---

## Comparison with Next.js App Router

The most common alternative stack for this type of application is Next.js App Router + tRPC or Server Actions. The tradeoffs:

| Concern | This stack (TanStack Start + oRPC) | Next.js App Router |
| ------- | ----------------------------------- | ------------------ |
| Route type safety | Generated type tree; broken links are build errors | String-based `href`; broken links are runtime 404s |
| API layer | oRPC contracts define shape before implementation | Server Actions: no explicit contract, just a function |
| Type safety for API calls | Enforced end-to-end by Zod + oRPC contract | Enforced by tRPC (if used) or absent with raw Server Actions |
| Community size | Smaller; fewer third-party answers | Very large; most React questions have answers |
| SSR/hydration | TanStack Start on Nitro; stable but less documented | Battle-tested across millions of deployments |
| Tailwind version | v4 (CSS-native, faster) | Typically v3; v4 support is available but less common |
| Deployment | Any Node server (Nitro adapter) | Optimized for Vercel; self-hosting requires more configuration |

The choice of TanStack Start + oRPC over Next.js + tRPC is defensible and arguably superior on type safety. The tradeoff is community support and documentation depth. For an internal enterprise product with a dedicated engineering team, this tradeoff is acceptable. For an open-source project or a product where external contributors are expected, Next.js's larger community would be an advantage.
