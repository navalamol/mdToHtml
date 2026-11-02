# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root via Turbo:

```bash
pnpm dev                  # Start all apps/packages in dev mode
pnpm build                # Build all packages
pnpm lint                 # Lint all packages
pnpm format               # Format with Oxfmt
pnpm typecheck            # Type-check all packages
```

Filter to a specific workspace:

```bash
pnpm dev --filter=pxc-retail
pnpm dev --filter=tenant-management
pnpm build --filter=@syndigo/design-system
pnpm test --filter=pxc-retail          # Vitest (in apps/pxc-retail)
pnpm test --filter=tenant-management   # Vitest (in apps/tenant-management)
```

## Architecture

**Monorepo**: pnpm workspaces + Turbo. ESM throughout (`"type": "module"`).

### Apps

Both apps are TanStack Start (SSR framework on Nitro) + React 19, use file-based routing via TanStack Router (`src/routes/`), and share the shell chrome, permissions engine, navigation types, i18n, and error handling via **`@syndigo/app-shell`** (see Packages). `routeTree.gen.ts` is auto-generated — do not edit. Each app owns its own `src/lib/navigation-config.ts` and `src/lib/permissions/index.ts`, which binds app-shell's permissions engine to that app's vocabulary (see `.claude/knowledge/permissions/`). Unauthorized users are redirected to `/no-access`.

- **`apps/pxc-retail`** (dev port 3000) — Main retail application. Routes are organized under `_shell/` with domain subdirectories: `merchandising/`, `vendor-central/`, `insights/`, `system-admin/`. Use `requireModuleAccess` in `beforeLoad` guards and `useFilteredMenuGroups`/`useFilteredSubTabs` for nav filtering.
- **`apps/tenant-management`** (dev port 3001) — Tenant onboarding and feature-set/feature-definition management. Routes under `_shell/`: `onboard`, `tenant.$tenantId`, `features`, `feature-set.*`, `feature-definition.*`. Consumes the same oRPC router and `@syndigo/app-shell` primitives as pxc-retail.

### Packages

- **`@repo/core-contracts`** — oRPC contract definitions, Zod schemas, and inferred TypeScript types. Contracts live under `src/<domain>/contracts/`, schemas under `src/schemas/`, inferred types under `src/types/`. Import the top-level contract via `@repo/core-contracts`, schemas via `@repo/core-contracts/schemas/<name>`, and inferred types via `@repo/core-contracts/types/<name>`.
- **`@syndigo/orpc`** — Type-safe RPC implementations. Implements contracts from `@repo/core-contracts` using `implement(contract)`. Exports the router via `@syndigo/orpc/router`. Consumed by the app API routes and the isomorphic client.
- **`@syndigo/design-system`** — Component library using CVA + Tailwind CSS 4 + @base-ui/react primitives (shadcn preset: `base-nova`). Exports components, hooks, utils, and `globals.css` (OKLch color tokens, dark mode). No barrel files — import individual components via `@syndigo/design-system/components/<name>`.
- **`@syndigo/app-shell`** — Shared application shell consumed by both apps. Houses the shell chrome (`@syndigo/app-shell/shell`), the generic permissions engine (`.../permissions` — `createPermissionsContext`, `requireModuleAccess`, `filterMenuGroups`, `resolveLandingRoute`), navigation types (`.../navigation` — `MenuGroup`, `SubTabItem`, `buildSubTabResolver`), i18n config (`.../i18n`), query error cache (`.../query/error-cache`), error-toast helpers, and theme/timezone/date hooks. No barrels — import via the subpath exports declared in its `package.json`.
- **`@syndigo/telemetry`** — OpenTelemetry bootstrap. `.../instrumentation` exports `startTelemetry({ serviceName, instrumentations })` and is consumed by both apps' `instrumentation.mjs`. Traces only — see the Observability section. No barrels — import via the subpath exports.
- **`@repo/typescript-config`** — Shared tsconfig bases (strict mode, `verbatimModuleSyntax`).

### API Layer

Contract-first: Zod schemas + oRPC contracts in `@repo/core-contracts` → implementations + router in `@syndigo/orpc` → each app's `/rpc` and `/openapi` routes and isomorphic client (`#/integrations/orpc/client`, exporting `client` and the React Query utils `orpc`). Wiring order, middleware stack and client details: `.claude/knowledge/rpc-layer/`.

### Error Handling

**Never expose internal error details to the client.** Use `throwError({ code, errorKey, params })` from `@syndigo/orpc/errors` — no raw exception messages, stack traces, or upstream response bodies. Wrap every upstream call in `unwrap(context.api.X(...))`; `mapUpstreamError` and the middleware pipeline enforce the rule, so don't bypass them.

Payload shape, middleware order, toast overrides (`meta.errorToast`), `RouteErrorComponent` branching and the two-step `ErrorKey` addition: `.claude/knowledge/error-handling/` and `PATTERNS.md`.

## Observability

**Traces only.** Metrics and logs are deliberately out of scope for now — no metric reader, no log record processor, no logging library. Server code uses `console.*`; there is no structured logger to import. Shared implementation in `@syndigo/telemetry`; each app's `instrumentation.mjs` is a thin wrapper loaded via `node --import` (see its `start:local` script and the Dockerfile `CMD`).

**Export is opt-in.** `startTelemetry` resolves the endpoint from `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, falling back to the generic `OTEL_EXPORTER_OTLP_ENDPOINT` with `/v1/traces` appended. With neither set the SDK never starts. Don't "simplify" this by always constructing the exporter: an exporter built with an undefined URL silently defaults to `localhost:4318` and floods stderr on every machine without a collector.

**Instrumentation only loads in the built server.** `pnpm dev` emits nothing. To see traces locally: start the collector (`docker compose -f docker-compose.observability.yml up -d`), set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in `.env.local`, then `pnpm build --filter=<app> && pnpm --filter=<app> start:local`. Grafana is on port 3100 (Explore → Tempo).

**What carries error detail is the span, not a log line.** `errorRecordingMiddleware` records every escaping error once via `recordException` + `setStatus(ERROR)`, and `recordValidationError` attaches `validation.*` attributes for schema drift. Prefer adding a span attribute or event over adding a log line.

`packages/orpc` declares `"sideEffects": false` so Rollup can drop the whole BFF graph from the browser bundle: each app's `src/integrations/orpc/client.ts` statically imports `@syndigo/orpc/router` and picks the server or client implementation with `createIsomorphicFn()`, and the server branch only truly disappears if the graph is provably droppable. Module-scope work that computes exported values is fine — `builder.ts`'s `implement(contract).use(...)` qualifies. What breaks the assertion is an observable effect at import: mutating a global, calling into a registry (`z.setErrorMap()`, plugin registration), or installing a polyfill. If a module genuinely needs one, switch to the allowlist form (`"sideEffects": ["./src/that-module.ts"]`) or move the effect into an explicit `init()` the server entry calls.

**Deployed environments** must inject `OTEL_EXPORTER_OTLP_ENDPOINT` via Argo CD / Kubernetes config in `global-devops-infra`; nothing is hardcoded here. `OTEL_SDK_DISABLED=true` is the no-rebuild kill switch.

### Path Aliases

In the main app: `#/*` and `@/*` both resolve to `./src/*`. Cross-package imports use `@syndigo/design-system/*`, `@syndigo/orpc/*`, and `@repo/core-contracts/*`.

### Environment Variables

Validated via T3 Env (`src/env/server.ts` and `src/env/client.ts`).

## Code Style

- Use explicit type imports (`verbatimModuleSyntax`)
- Tailwind CSS 4 with CSS variable-based theming (OKLch color space)
- Use `cn()` from `@syndigo/design-system/lib/utils` for merging class names

## Internationalization (i18n)

**IMPORTANT**: All user-facing text MUST use translations. Never hard-code text strings in components or error messages.

- **Frontend**: Use `useTranslation()` hook from `#/hooks/use-translation` in React components
- **Backend**: never hard-code a user-facing message. Use `throwError({ code, errorKey, params })` from `@syndigo/orpc/errors`; `errorKey` is typed as `ErrorKey`. The client renders the message — see the Error Handling section above.
- Translation files: `apps/<app>/src/locales/{en,es,fr,de}/translation.ts`. Error keys live under `errors.<errorKey>` — structure mirrors `ErrorKey` with an `errors.` prefix.
- Translation keys are written as **selector callbacks** (`t($ => $.foo.bar)`), not strings. Selectors give static type-checking and avoid the TS depth-limit issues that nested string keys hit.
- For keys that must be computed at runtime, use `dynamicSelector('foo.bar.baz')` from `#/integrations/i18n/config`. Prefer a `Record<Union, TranslationSelector>` lookup over `dynamicSelector` whenever the union is closed (compile-time-safer and one-shot).
- Use interpolation for dynamic values: `t($ => $.key, { variable: value })`
- Use number formatting: `{{count, number}}` in translation strings
- Use pluralization: Define both `key` (plural/default) and `key_one` (singular) forms, pass `count` parameter

**Examples**:

```tsx
// ✅ Good — selector callbacks
const { t } = useTranslation()
<p>{t($ => $.errors.not_found)}</p>
<p>{t($ => $.vendor.display.employees_count, { count: 5 })}</p>

// ✅ Good — closed-union lookup
const LABELS: Record<Kind, TranslationSelector> = {
  a: $ => $.kinds.a,
  b: $ => $.kinds.b,
}
<p>{t(LABELS[kind])}</p>

// ✅ Acceptable — runtime-computed key
<p>{t(dynamicSelector(`errors.${key}`))}</p>

// ❌ Bad — string keys (legacy pattern)
<p>{t('errors.not_found')}</p>

// ❌ Bad — hard-coded text
<p>Page not found</p>
```

## Forms

- Use **TanStack Form** for all form state management.
- Determine dirtiness via `!state.isDefaultValue` — never use `isDirty` (it latches `true`; see `PATTERNS.md`).
- Use the **Unsaved Changes Guard** to block route navigation when a form has unsaved changes.
- Disable submit buttons when `state.isSubmitting`, `state.isDefaultValue`, or `!state.isValid`.

## Route Tree Generation

- Run `pnpm dev --filter=<app>` (`pxc-retail` or `tenant-management`) to regenerate that app's TanStack Router route tree (`src/routeTree.gen.ts`). This is required after adding, removing, or renaming route files.

<!-- intent-skills:start -->

## Skill Loading

Before substantial work:

- Skill check: run `pnpm dlx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

<!-- knowledge-sync:begin -->
## Knowledge Base

`.claude/knowledge/` holds the curated map of this codebase. Read it before scanning source.

- **Start at `.claude/knowledge/INDEX.md`** — the router. It names the area that owns your question,
  its modules and its entry point. Do not read whole area folders; each area README lists its
  sub-docs and what each one covers.
- **`.claude/knowledge/PATTERNS.md`** — repo-wide patterns and the rule to extend each. Read it
  before adding a class rather than editing one.
- **`.claude/knowledge/recipes/`** — task playbooks for changes that span files (none yet; until
  one exists, use the matching project skill, e.g. `add-orpc-procedure`, `error-key`, `add-route`).
- **`.claude/knowledge/kb-index.json`** — module glob to area registry. To find the owning area of a
  file: `python3 .claude/skills/knowledge-sync/scripts/kb_impact.py --files <path>`
  (on Windows: `py -3 .claude\skills\knowledge-sync\scripts\kb_impact.py --files <path>`).

**Required before committing a change under `apps/` or `packages/`:** run the `knowledge-sync`
skill in mode `sync` and update the impacted area docs. The skill computes the impacted areas from
the staged diff and gates on `kb_lint.py` exiting 0.
<!-- knowledge-sync:end -->
