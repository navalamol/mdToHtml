# Architecture

This document describes the system structure, data flow, and key design decisions. For setup instructions, see `docs/LOCAL-DEV-SETUP.md`. For day-to-day conventions, see `ONBOARDING.md` and `CLAUDE.md`.

---

## Overview

pxc-retail is a monorepo containing two server-rendered React applications and a set of shared packages. The main app (`pxc-retail`) is a retail intelligence platform used by retailers to manage vendors, merchandise, promotions, and analytics. The secondary app (`tenant-management`) is an internal tool for onboarding new retail tenants and configuring their feature sets. Both apps are backed by a contract-first BFF (Backend for Frontend) layer that fronts upstream services, validates all inputs and outputs with Zod schemas, and ensures that errors never expose internal details to the client.

---

## System context

```
                        ┌─────────────────────────────────────┐
                        │          Upstream Services           │
                        │  Vendor Service  │  MDM API          │
                        │  CSL Entity      │  CSL Onboarding   │
                        └──────────────────┬──────────────────┘
                                           │  HTTP (unwrapped via unwrap())
                        ┌──────────────────▼──────────────────┐
                        │           @syndigo/orpc (BFF)        │
                        │  Implements contracts, applies       │
                        │  middleware stack, maps errors       │
                        └──────────────────┬──────────────────┘
                                           │  oRPC (JSON-RPC or direct)
               ┌───────────────────────────┴──────────────────────────┐
               │                                                       │
  ┌────────────▼──────────────┐                  ┌────────────────────▼──────────┐
  │      apps/pxc-retail      │                  │   apps/tenant-management      │
  │  Retailers: merchandising,│                  │   Syndigo staff: tenant        │
  │  vendor central, insights,│                  │   onboarding, feature sets,   │
  │  system admin  (port 3000)│                  │   feature definitions (3001)  │
  └───────────────────────────┘                  └───────────────────────────────┘
```

**Who uses each app:**
- `pxc-retail` — retail buyers, merchandisers, vendor managers, and system administrators at retailer organizations.
- `tenant-management` — Syndigo internal teams provisioning new retail tenants and managing feature entitlements.

---

## Repository structure

```
retail-pxc/
├── apps/
│   ├── pxc-retail/              # Main retail app
│   │   ├── src/routes/          # File-based routes (path = URL)
│   │   ├── src/lib/             # Navigation config, permissions binding
│   │   ├── src/integrations/    # oRPC client, TanStack Query setup, i18n
│   │   ├── src/locales/         # en, es, fr, de translation files
│   │   ├── src/env/             # T3 Env-validated server + client env schemas
│   │   └── src/components/      # App-specific UI components
│   └── tenant-management/       # Admin/config app (same structure)
│
├── packages/
│   ├── core-contracts/          # @repo/core-contracts
│   │   ├── src/<domain>/contracts/   # oRPC contract definitions
│   │   ├── src/schemas/              # Zod input/output schemas
│   │   └── src/types/                # Inferred TypeScript types, ErrorKey union
│   ├── orpc/                    # @syndigo/orpc
│   │   ├── src/procedures/      # Procedure implementations
│   │   ├── src/router.ts        # Router assembly
│   │   ├── src/errors.ts        # throwError, mapUpstreamError, recordErrorOnSpan
│   │   └── src/middleware/      # errorRecording, validationError, auth, span, apiClient
│   ├── app-shell/               # @syndigo/app-shell
│   │   ├── src/permissions/     # RBAC engine (logic, context factory, nav filter, route guard)
│   │   ├── src/components/      # UnsavedChangesGuard, RouteErrorComponent base
│   │   └── src/error-toast.ts   # getErrorToast, parseErrorPayload
│   ├── design-system/           # @syndigo/design-system
│   │   ├── src/components/      # Button, DataTable, Dialog, etc. (no barrel)
│   │   └── src/globals.css      # OKLch color tokens, dark mode
│   ├── telemetry/               # @syndigo/telemetry — OTel bootstrap, traces only
│   └── typescript-config/       # Shared strict tsconfig bases
│
└── submodules/
    └── loveable/                # Lovable-generated retail UI — UX reference, not shipped
```

### Package dependency graph

```
apps/pxc-retail ──────────────────────────────────────────────────────────┐
apps/tenant-management ────────────────────────────────────────────────────┤
                                                                           │
              ┌────────────────────────────────────────────────────────────┤
              ▼                        ▼                         ▼         ▼
   @syndigo/app-shell      @syndigo/design-system      @syndigo/orpc      ...
              │                        │                         │
              └────────────────────────┴─────────────────────────┘
                                       │
                              @repo/core-contracts
                         (the single source of API types)
```

All packages import from `@repo/core-contracts`; nothing below it imports upward.

---

## The request lifecycle

### Client-side data fetch (after initial page load)

```
React component
  └─ useSuspenseQuery(orpc.vendor.list.queryOptions({ input: {} }))
       └─ TanStack Query checks in-memory cache
            ├─ HIT → returns cached data immediately
            └─ MISS → HTTP POST to /rpc/vendorCentral.vendor.list
                         └─ RPCHandler#handle (apps/pxc-retail/src/routes/rpc/$.ts)
                              └─ errorRecordingMiddleware  ← outermost; records any escape on OTel span
                                   └─ validationErrorMiddleware  ← rewraps Zod ValidationError
                                        └─ authMiddleware  ← resolves user + permissions from auth-session cookie
                                             └─ spanAttributesMiddleware  ← sets enduser.id, app.tenant_id on span
                                                  └─ apiClientMiddleware  ← attaches context.api.* HTTP clients
                                                       └─ procedure handler
                                                            └─ unwrap(context.api.vendorService.list(...))
                                                                 └─ upstream HTTP call → response
                                                                      └─ Zod validation against output schema
                                                                           └─ typed response returned to component
```

### Server-side render (SSR, first page load)

On the server, the isomorphic client bypasses HTTP and calls the router directly:

```
TanStack Start server render
  └─ useSuspenseQuery(orpc.vendor.list.queryOptions({ input: {} }))
       └─ createRouterClient(router, { context: getOrpcContext() })
            └─ calls procedure handler directly (no network hop)
                 └─ same middleware stack applies
                      └─ response hydrated into the page HTML
```

This means the browser receives a fully-rendered page with data on the first load — no loading spinner, no waterfall.

### Error path

```
procedure handler
  └─ throwError({ code: 'NOT_FOUND', errorKey: 'vendor.not_found' })
       └─ constructs ORPCError { code, data: ErrorPayload { errorKey, traceId, spanId } }
            └─ errorRecordingMiddleware catches, calls recordException on OTel span, re-throws
                 └─ RPCHandler serializes to HTTP error response
                      └─ client receives ORPCError
                           ├─ mutation → MutationCache.onError → getErrorToast → toast.error(t($ => $.errors.vendor.not_found))
                           └─ query/load → RouteErrorComponent branches on error.code
```

---

## Key design decisions

### Contract-first API

Zod schemas and oRPC contract definitions live in `@repo/core-contracts` — the single source of truth for every API shape. The implementation in `@syndigo/orpc` calls `implement(contract)`, which means TypeScript enforces that the handler's input and output match the contract exactly. The app's client inherits those types automatically.

**Why:** Prevents the classic BFF drift — the server returns a shape that the client doesn't expect, causing runtime errors that TypeScript cannot catch. With contract-first, a shape mismatch is a build error.

### No barrel files

Every package declares granular subpath exports in its `package.json`. There is no `index.ts` that re-exports everything. Consumers import from `@syndigo/design-system/components/button`, not from `@syndigo/design-system`.

**Why:** `@syndigo/orpc` is declared `"sideEffects": false`. A tree-shaker can only drop the server-side router graph from the browser bundle if the import graph is provably clean. A barrel file that re-exports both server and client code breaks this guarantee — the browser bundle would include server-only dependencies.

### File-based routing

Route files under `src/routes/` map directly to URLs. `_shell/` is a layout prefix, not a URL segment. Dynamic segments use `$` prefix (`$vendorId.tsx`). `routeTree.gen.ts` is auto-generated by TanStack Router and is never edited manually.

**Why:** Convention over configuration. Every route file is self-evident from the filesystem. The generated route tree gives fully typed `Link` components and `useNavigate` hooks — you cannot link to a route that doesn't exist.

### SSR with isomorphic client

The oRPC client (`src/integrations/orpc/client.ts`) uses `createIsomorphicFn()` to select the right implementation at runtime: direct router call on the server, HTTP over `/rpc` in the browser. TanStack Query's `useSuspenseQuery` works identically in both environments.

**Why:** The initial page load renders with real data from the server — no loading state, no content shift, better perceived performance. The SSR path also eliminates one HTTP round-trip per query on page load.

### Mandatory i18n enforced at compile time

Translation keys are typed selector callbacks (`t($ => $.vendor.title)`). The TypeScript compiler knows the shape of all four locale files and rejects any selector that references a missing key. Adding a new key requires updating all four locale files (`en`, `es`, `fr`, `de`) before the build will pass.

**Why:** i18n is usually treated as "add later." In a four-language product, a missing key shows up as a raw key string in production. Making it a compile-time requirement eliminates that class of bug entirely.

### Typed error keys

`ErrorKey` is a closed union of string literals in `@repo/core-contracts/types/error-key.ts`. `throwError({ errorKey })` accepts only a member of that union. Each member must have a corresponding `errors.<key>` entry in all four locale files.

**Why:** The same guarantee as i18n selectors, applied to error messages. Without this, a new error path can ship with no visible message in any language.

---

## Authentication and authorization

### Authentication

The platform sets an `auth-session` cookie on the user's browser via an upstream identity service. The `authMiddleware` in the BFF reads that cookie on every authenticated request. In local development with `NODE_ENV=development`, the middleware falls back to a dev identity when no cookie is present — this is implicit and requires no configuration. When running the built server (`start:local`, which sets `NODE_ENV=production`), `ALLOW_DEV_FALLBACK_USER=true` must be set explicitly in `.env.local` to get the same behavior; without it, every request returns a 500.

### Authorization

```
auth-session cookie
  └─ authMiddleware resolves roles (string[]) from session
       └─ resolveRolePermissions(roles, roleDefinitions) → permission strings
            └─ resolvePermissions(permissions, ACTION_HIERARCHY) → expanded set
                 └─ ReadonlySet<string> stored in PermissionsProvider React context
                      └─ route beforeLoad: requireModuleAccess(permissions, 'vendor-management', 'read')
                           ├─ has permission → route renders
                           └─ missing → redirect({ to: '/no-access' })
```

Action hierarchy: `admin` implies `[read, write, delete]`; `delete` implies `[read, write]`; `write` implies `[read]`. `hasModuleAccess(module)` checks `module:read`, which is true for any granted action.

The permissions engine in `@syndigo/app-shell` is vocabulary-agnostic (plain string logic). Each app binds it to its own `Module`/`Action` union types in `apps/<app>/src/lib/permissions/index.ts`, adding compile-time safety at the boundary without duplicating the logic.

---

## Data flow summary

```
Upstream services (Vendor, MDM, CSL, Auth)
    │
    │  HTTP (via context.api.* clients, unwrapped with unwrap())
    ▼
@syndigo/orpc (BFF)
    │  Middleware stack: error recording → validation → auth → span → apiClient → handler
    │  Errors: throwError() → ORPCError with ErrorPayload { errorKey, traceId }
    │
    │  Direct call (server-side) or HTTP POST /rpc (client-side)
    ▼
Isomorphic client (apps/*/src/integrations/orpc/client.ts)
    │  orpc.domain.proc.queryOptions() → TanStack Query
    │  client.domain.proc({ input }) → raw RouterClient
    ▼
React components
    │  useSuspenseQuery → data (typed by Zod output schema)
    │  useMutation → MutationCache.onError → error toast
    └─ RouteErrorComponent → error page (UNAUTHORIZED, NOT_FOUND, or generic)
```

---

## Observability

Traces only — no metrics, no structured logging. Server code uses `console.*` for any local output.

`@syndigo/telemetry` bootstraps the OpenTelemetry SDK in each app's `instrumentation.mjs`. The SDK only starts if `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set. An unset endpoint means no exporter is registered — no connection errors, no retries against localhost.

**Instrumentation only loads in the built server.** `pnpm dev` does not produce traces. To see traces locally: start the LGTM stack, set the endpoint in `.env.local`, then run `pnpm build --filter=<app> && pnpm --filter=<app> start:local`. Grafana is on port 3100.

Each authenticated span carries `enduser.id` and `app.tenant_id` from `spanAttributesMiddleware`. Every escaping error is recorded once by `errorRecordingMiddleware` via `recordException` + `setStatus(ERROR)` with `error.code` and `error.key` attributes. The same `traceId` is returned to the client inside `ErrorPayload`, linking a support report directly to the span.

`OTEL_SDK_DISABLED=true` is the kill switch — disables the SDK entirely without a rebuild.

---

## Testing

**Unit and integration tests:** Vitest, co-located with source files or in `__tests__/` directories. Run with `pnpm test` (all workspaces) or `pnpm test --filter=<app>`.

**End-to-end:** The `playwright-cli` skill is available for browser automation and test generation. No committed E2E test suite exists as of the current state of the repo — this is a known gap (see `docs/TECH-EVALUATION.md`).

**Pre-commit verification:**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three must pass before a PR is mergeable. The `typecheck` step is the strongest safety net — it validates contract types, locale keys, error keys, and route shapes in a single pass.
