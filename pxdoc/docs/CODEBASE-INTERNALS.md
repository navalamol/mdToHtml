# Codebase Internals

A deep-dive reference for developers who need to understand *how* things wire together, not just *what* exists. Read `ARCHITECTURE.md` first for the high-level picture, then come here for the mechanics.

---

## Table of Contents

1. [Folder Map — Every Directory and Its Job](#folder-map)
2. [The Stack in One Picture](#the-stack)
3. [RPC, Not REST — What That Means](#rpc-not-rest)
4. [The Isomorphic Client — How SSR and Browser Share One API](#isomorphic-client)
5. [End-to-End Request Lifecycle](#end-to-end-lifecycle)
6. [Contract → Implementation → Client Type Chain](#contract-chain)
7. [Permissions System — Three Layers](#permissions-system)
8. [Routing — File-Based, Pathless Layouts, Guards](#routing)
9. [Design System — Import Rules and Component Patterns](#design-system)
10. [i18n — Selector Callbacks and ErrorKey Flow](#i18n)

---

## Folder Map

Every significant directory with its single responsibility. `node_modules`, `.turbo`, `dist`, and `build` are omitted.

```
retail-pxc/
│
├── apps/
│   ├── pxc-retail/                     Main retail app (Nitro SSR, port 3000)
│   │   └── src/
│   │       ├── routes/                 File system = URL tree (TanStack Router)
│   │       │   ├── __root.tsx          Global providers: QueryClient, i18next, Toaster, devtools
│   │       │   ├── _shell.tsx          Pathless auth layout: loads session, mounts ShellChrome + PermissionsProvider
│   │       │   ├── _shell/             Every authenticated page lives here
│   │       │   │   ├── vendor-central/ Domain routes: vendor list, detail, contacts, documents
│   │       │   │   ├── merchandising/  Domain routes: assortment, commerce, promotions, product catalog
│   │       │   │   ├── insights/       Domain routes: analytics & reporting
│   │       │   │   └── system-admin/   Domain routes: users, roles, integrations, UI config, branding
│   │       │   ├── no-access.tsx       Redirect target when requireModuleAccess() fails
│   │       │   ├── rpc/$.ts            Server route: hands POST /rpc to oRPC RPCHandler
│   │       │   └── openapi/$.ts        Server route: serves auto-generated OpenAPI spec at /openapi
│   │       ├── integrations/
│   │       │   ├── orpc/               Isomorphic client, queryOptions, session query, server prefix util
│   │       │   ├── i18n/               i18next config, dynamicSelector utility
│   │       │   └── tanstack-query/     QueryClient factory, MutationCache (error toast wiring), devtools
│   │       ├── lib/
│   │       │   ├── permissions/        App-specific RBAC binding: Module/Action union types, typed helpers
│   │       │   ├── navigation-config.ts menuGroups[] + moduleSubTabs definitions for nav filtering
│   │       │   ├── vendor/             Vendor domain utilities (mapping, sorting, display logic)
│   │       │   └── mock/               Dev-time stub data for missing API endpoints (NOT production)
│   │       ├── components/             App-specific UI — domain subdirectories (vendor/, admin/, etc.)
│   │       ├── hooks/                  useTranslation re-export, useSession, useFormatDate
│   │       ├── locales/                {en,es,fr,de}/translation.ts — all user-visible text
│   │       └── env/
│   │           ├── server.ts           T3 Env server-side vars (OTEL endpoints, auth flags)
│   │           └── client.ts           T3 Env client-side vars (VITE_APP_TITLE, VITE_BASE)
│   │
│   └── tenant-management/              Admin app (Nitro SSR, port 3001) — same structure
│       └── src/
│           ├── routes/_shell/          onboard, tenant.$tenantId, features, feature-set.*, feature-definition.*
│           ├── lib/permissions/        Narrowed vocab local to tenant-management (NOT from core-contracts)
│           └── components/             Features, onboarding, tenant config, entitlements
│
├── packages/
│   ├── core-contracts/                 @repo/core-contracts — single API source of truth
│   │   └── src/
│   │       ├── <domain>/contracts/     oRPC contract definitions (input schema + output schema)
│   │       ├── schemas/                Zod schemas (runtime validators + TypeScript type sources)
│   │       ├── types/                  z.infer<> derived types, ErrorKey union — never hand-written
│   │       ├── masking/                Pure utils: maskName, maskEmail, maskPhone, maskLast4
│   │       └── vendor-central/         Pure utils: address-rules, banking-rules, contact-masking
│   │
│   ├── orpc/                           @syndigo/orpc — server-side BFF implementation
│   │   └── src/
│   │       ├── router.ts               Assembles all procedures into one exported router object
│   │       ├── builder.ts              os (base builder) and authed (builder + full middleware chain)
│   │       ├── context.ts              Context, AuthedContext, ApiClientContext types
│   │       ├── errors.ts               throwError, recordErrorOnSpan, recordValidationError
│   │       ├── upstream-error.ts       mapUpstreamError, unwrap (converts openapi-fetch → ORPCError)
│   │       ├── auth-session.ts         parseAuthSessionUser, devFallbackUser
│   │       ├── middleware/
│   │       │   ├── auth.ts             authMiddleware: resolves user + permissions
│   │       │   ├── api-client.ts       apiClientMiddleware: creates vendorApi, mdmApi, cslApi clients
│   │       │   ├── error-recording.ts  errorRecordingMiddleware: OTel span exception + status
│   │       │   ├── span-attributes.ts  spanAttributesMiddleware: sets enduser.id, tenant_id on span
│   │       │   └── validation-error.ts validationErrorMiddleware: rewraps Zod errors as ORPCErrors
│   │       ├── procedures/<domain>/    One file per domain; one exported function per procedure
│   │       │   └── *.mock.ts           Deterministic stub generators (gated on context.stubsEnabled)
│   │       ├── clients/                openapi-fetch typed clients for each upstream service
│   │       │   ├── vendor-api.ts       Riversand Vendor API client factory
│   │       │   ├── mdm-api.ts          MDM API client factory
│   │       │   ├── csl-entity-service.ts
│   │       │   └── csl-onboarding-service.ts
│   │       └── generated/             Auto-generated TypeScript types from upstream OpenAPI specs
│   │           ├── vendor-api.d.ts     (type-only — .d.ts, no runtime code)
│   │           ├── mdm-api.d.ts
│   │           ├── csl-entity-service.d.ts
│   │           └── csl-onboarding-service.d.ts
│   │
│   ├── app-shell/                      @syndigo/app-shell — shared chrome, RBAC, i18n, error utils
│   │   └── src/
│   │       ├── shell/                  ShellChrome component (sidebar, header, nav rendering)
│   │       ├── permissions/            Pure RBAC math + createPermissionsContext<M,A>() factory
│   │       ├── navigation/             MenuGroup, SubTabItem types, buildSubTabResolver
│   │       ├── i18n/                   i18next config base, useTranslation hook
│   │       ├── hooks/                  use-timezone, use-theme, use-translation
│   │       ├── query/error-cache.ts    makeMutationCache (MutationCache.onError → toast)
│   │       └── components/UnsavedChangesGuard.tsx
│   │
│   ├── design-system/                  @syndigo/design-system — 44 styled components
│   │   └── src/
│   │       ├── components/             One file per component (no barrel). Button, Badge, DataTable…
│   │       ├── lib/utils.ts            cn() — clsx + tailwind-merge
│   │       └── styles/globals.css      OKLch color tokens, dark mode, base resets
│   │
│   └── telemetry/                      @syndigo/telemetry — OTel bootstrap only
│       └── src/instrumentation.ts      startTelemetry({ serviceName, instrumentations })
│
├── submodules/loveable/                READ-ONLY UX reference mockups — visual spec, not shipped
└── .claude/
    ├── knowledge/                      Curated KB consumed by AI agents; start at INDEX.md
    └── skills/                         Task playbooks (add-orpc-procedure, add-route, error-key…)
```

---

## The Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / SSR                            │
│                                                                 │
│  React 19  +  TanStack Router (file-based)                      │
│  TanStack Query (React Query) — caches all RPC results          │
│  @syndigo/design-system (CVA + Tailwind 4 + @base-ui/react)     │
│  i18next (selector-callback translation keys)                   │
│                                                                 │
│  src/integrations/orpc/client.ts                                │
│       ↕  isomorphic — same call, different transport            │
├─────────────────────────────────────────────────────────────────┤
│                  TanStack Start (Nitro SSR)                      │
│                                                                 │
│  src/routes/rpc/$.ts ← RPCHandler ← @syndigo/orpc/router        │
│                                                                 │
│  Middleware chain (every authed procedure):                     │
│  errorRecording → validationError → auth → spanAttributes       │
│                → apiClient → requirePermission → handler        │
│                                                                 │
│  openapi-fetch clients → upstream REST APIs                     │
├─────────────────────────────────────────────────────────────────┤
│            Upstream Services (external, REST)                   │
│                                                                 │
│  Riversand Vendor API  ·  MDM API                               │
│  CSL Entity Service    ·  CSL Onboarding Service                │
└─────────────────────────────────────────────────────────────────┘
```

---

## RPC, Not REST

**The app uses oRPC (JSON-RPC style), not REST.**

| Concern | REST | This app |
|---------|------|----------|
| Transport | Multiple URLs, HTTP verbs | Single `POST /rpc` |
| Procedure address | URL path + verb | Procedure name in body |
| Type safety | OpenAPI → codegen | Zod schemas → inferred TypeScript |
| Error shape | Status codes + ad-hoc bodies | Typed `ORPCError` with `errorKey` |

**What `/rpc` actually looks like on the wire:**
```
POST /rpc/vendorCentral.tenantVendor.list
Content-Type: application/json

{ "input": { "limit": 12, "vendorStatus": "active" } }
```

The procedure path is encoded in the URL *suffix* (after `/rpc/`), but it is still a single handler — `RPCHandler` in `src/routes/rpc/$.ts` routes by the path, not by HTTP verb.

**OpenAPI at `/openapi` is documentation only.** The frontend never calls REST endpoints. It exists to auto-generate a REST-style spec from the oRPC contracts for tooling and consumers.

**Upstream services ARE REST.** The BFF communicates with Riversand, MDM, CSL via standard HTTP using `openapi-fetch` typed clients. The `unwrap()` utility converts these REST responses into the oRPC type system.

```
Browser ──POST /rpc──→ BFF (oRPC)
BFF ──GET/POST /v1/...──→ Upstream REST APIs
```

---

## Isomorphic Client

**File:** `apps/pxc-retail/src/integrations/orpc/client.ts`

The isomorphic client gives components one API call that works identically during SSR and in the browser, without double-fetching.

```typescript
const getORPCClient = createIsomorphicFn()
  .server(() =>
    // SSR path: direct in-process call — NO network, NO serialization
    createRouterClient(router, {
      context: getOrpcContext,  // reads cookies/headers from the live Nitro request
    })
  )
  .client(() => {
    // Browser path: HTTP POST to /rpc
    const link = new RPCLink({
      url: `${window.location.origin}${getOrpcServerPrefix('/rpc')}`,
    })
    return createORPCClient<Client>(link)
  })

export const client = getORPCClient()
export const orpc = createTanstackQueryUtils(client)
```

### Server path (SSR)

- `createRouterClient(router, { context })` calls the router object directly in-process
- No HTTP round-trip, no JSON serialization
- `getOrpcContext` is called fresh per invocation; reads `getCookie()`, `getRequestHeader()`, `getRequest()` from `@tanstack/react-start/server` — these primitives read the *current* incoming Nitro request
- The full middleware chain (auth, validation, span recording) still runs
- Data is returned as typed objects, never serialized

### Browser path

- `RPCLink` serializes every call to `POST /rpc/...` over HTTP
- `getOrpcServerPrefix('/rpc')` computes the correct URL; in production the app is served at `/pxc/`, so the endpoint is `/pxc/rpc` — never hardcode `/rpc`
- `createORPCClient<Client>` infers all input/output types from the same `Router` type used server-side — the TypeScript types are identical

### The `orpc` export

`createTanstackQueryUtils(client)` wraps every procedure with React Query helpers:

```typescript
// In a component:
const data = useSuspenseQuery(
  orpc.vendorCentral.tenantVendor.list.queryOptions({ input: { limit: 12 } })
)

// Infinite scroll:
const data = useSuspenseInfiniteQuery(
  orpc.vendorCentral.tenantVendor.list.infiniteOptions({
    input: { limit: 12 },
    getNextPageParam: (page) => page.nextCursor,
  })
)

// Mutation:
const mutation = useMutation(
  orpc.vendorCentral.tenantVendor.update.mutationOptions()
)
```

The stable cache key is derived from the procedure path + input. The same key is used on server and client, which is why TanStack Start can hydrate the cache from SSR data.

### What differs between environments

| | Server (SSR) | Browser |
|---|---|---|
| Transport | In-process function call | HTTP POST |
| Request context | Read from Nitro request primitives | Cookies forwarded automatically |
| Performance | Zero network latency | One round-trip per cache miss |
| TypeScript types | Identical — same `Router` type | Identical |
| Middleware chain | Runs fully | Runs fully on server |

---

## End-to-End Request Lifecycle

This traces a real feature: the vendor list page in `pxc-retail`. Follow this to understand the complete wiring.

### First Page Load (SSR)

```
GET /vendor-central/vendor-management/vendors?sort=name
```

**1. Nitro receives request → TanStack Start matches route**
```
src/routes/_shell/vendor-central/vendor-management/vendors.tsx
```

**2. `_shell.tsx` `beforeLoad` runs first (pathless parent)**
```typescript
// _shell.tsx
const session = await queryClient.fetchQuery(sessionQueryOptions())
// sessionQueryOptions calls orpc.users.session.queryOptions()
// isomorphic client (server path): createRouterClient.users.session()
// users.session procedure uses os (base builder — no auth middleware)
// Returns { user, tenantId, permissions: string[] }

const resolvedPermissions = new Set(session.permissions)
return { user, tenantId, resolvedPermissions }
// This is injected into all child route contexts
```

**3. `vendors.tsx` `beforeLoad` runs**
```typescript
beforeLoad: ({ context }) => {
  requireModuleAccess(context.resolvedPermissions, 'vendor-management')
  // checks permissions.has('vendor-management:read')
  // if missing: throw redirect({ to: '/no-access' })
}
```

**4. `vendors.tsx` `validateSearch` runs**
```typescript
validateSearch: (search) => vendorPortalSearchSchema.parse(search)
// Zod parses + provides defaults: view='grid', sort='name'
// Available in component as: Route.useSearch()
```

**5. React renders — `<Suspense>` boundary activates**
```typescript
// VendorPortalPage renders immediately (filter bar, layout)
// <Suspense fallback={<VendorListSkeleton />}>
//   <VendorContent />
// </Suspense>
```

**6. `VendorContent` calls `useSuspenseInfiniteQuery`**
```typescript
useSuspenseInfiniteQuery(
  orpc.vendorCentral.tenantVendor.list.infiniteOptions({
    input: { limit: 12, sort, vendorStatus },
    getNextPageParam: (page) => page.nextCursor,
  })
)
// isomorphic client (server path): calls router directly
```

**7. Middleware chain runs (in order, outermost first)**

```
a. errorRecordingMiddleware
   → wraps everything; catches any escaping ORPCError
   → recordException(err) + setStatus(ERROR) on OTel span
   → re-throws

b. validationErrorMiddleware
   → Zod validates input schema
   → on failure: rewraps as ORPCError { code: 'BAD_REQUEST', errorKey: 'upstream.validation' }

c. authMiddleware
   → reads context.currentUser (from cookie via getOrpcContext)
   → if no userId: throwError({ code: 'UNAUTHORIZED', errorKey: 'auth.unauthenticated' })
   → resolveUserRoles(context) [currently stubs to DEFAULT_ROLES — see known issues]
   → resolveStoredRolePermissions(roles) → string[] of "module:action"
   → getTenantEnabledModules(tenantId) → intersects with tenant's enabled modules
   → merges AuthedContext { userId, tenantId, permissions: ReadonlySet<Permission> }

d. spanAttributesMiddleware
   → sets enduser.id, app.tenant_id on active OTel span

e. apiClientMiddleware
   → creates VendorApiClient(baseUrl, headers)
   → creates MdmApiClient, CslApiClient, CslOnboardingApiClient
   → merges { vendorApi, mdmApi, cslApi, cslOnboardingApi } into context

f. requirePermission('vendor-management', 'read')  [per-procedure .use()]
   → context.permissions.has('vendor-management:read')
   → missing: throwError({ code: 'FORBIDDEN', errorKey: 'auth.permission_denied' })

g. listTenantVendors handler executes
   → unwrap(context.vendorApi.GET('/v1/vendors', { params: { query: { ... } } }))
   → unwrap: if !response.ok → mapUpstreamError(status, body) → throw ORPCError
   → if ok: maps response with mapTenantVendorFromApi
   → if context.stubsEnabled: merges mockVendorCardFields (from *.mock.ts sibling)
   → returns { items: TenantVendor[], nextCursor?: string }

h. Zod validates return value against output schema
   → if invalid: validationErrorMiddleware logs [orpc:validation], rewraps as ORPCError
```

**8. Data flows back through middleware (no mutations on success path)**

**9. Nitro serializes HTML + dehydrated React Query cache → browser**

Browser receives fully-rendered page. React Query cache is hydrated. No second fetch needed.

---

### Subsequent Browser Navigation

```
User applies filter → URL updates → React Query sees new cache key
```

```typescript
// browser-side fetch:
RPCLink.call(['vendorCentral','tenantVendor','list'], { vendorStatus: 'active', limit: 12 })
// → HTTP POST /pxc/rpc (production) or /rpc (local)
// body: { input: { vendorStatus: 'active', limit: 12 } }
// → Nitro routes to RPCHandler → same middleware chain → JSON response
```

---

### Error Path

```typescript
// Inside any procedure:
throwError({ code: 'NOT_FOUND', errorKey: 'vendor.not_found', params: { id } })
```

```
errorRecordingMiddleware catches ORPCError
→ recordException(err) on OTel span
→ setStatus({ code: ERROR })
→ re-throws

RPCHandler serializes:
{ error: { code: 'NOT_FOUND', data: { errorKey: 'vendor.not_found', traceId, spanId } } }

On browser (mutation):
  MutationCache.onError
  → parseErrorPayload(error.data) → { errorKey: 'vendor.not_found' }
  → dynamicSelector('errors.vendor.not_found')
  → toast.error(t(selector)) → shows "Vendor not found"

On browser (page/query):
  RouteErrorComponent receives error
  → code === 'UNAUTHORIZED' / 'FORBIDDEN' → access-denied page
  → code === 'NOT_FOUND' → 404 page
  → else → generic error page with traceId for support
```

---

## Contract Chain

Three layers, all in `@repo/core-contracts`. Types flow automatically — never written by hand.

```
Layer 1: Zod Schema (src/schemas/)
         Runtime validator + TypeScript type source
         ↓ z.infer<typeof MySchema>
Layer 2: TypeScript Type (src/types/)
         Inferred — never declare by hand
         ↑ imported by both BFF procedures AND frontend components

Layer 3: Contract Definition (src/<domain>/contracts/)
         oc.input(InputSchema).output(OutputSchema).route({ summary })
         ↓ implement(contract)
         BFF Procedure (packages/orpc/src/procedures/)
         TypeScript compiler enforces: return type must match output schema
         ↓ router.ts assembles into router
         Client Types (client.ts: RouterClient<typeof router>)
         orpc.domain.procedure.queryOptions({ input: ... })
         input/output types inferred from contract — zero annotation in components
```

**If a contract output schema changes**: build fails everywhere that uses the old shape — the handler, the component, the test fixtures. This is intentional.

**`oc` vs `os`:**
- `oc` = `ocBase.errors(standardErrors)` — the contract builder. Adds `UNAUTHORIZED`, `NOT_FOUND`, `INTERNAL_SERVER_ERROR` as typed error variants to every procedure automatically.
- `os` = the oRPC *server* builder from `builder.ts`. `authed` extends it with the full middleware chain.
- `os` is only used in the BFF; `oc` is only used in core-contracts.

---

## Permissions System

Three layers: pure logic → typed factory → per-app binding.

### Layer 1: Pure Logic (vocabulary-agnostic)

`packages/app-shell/src/permissions/logic.ts`

```typescript
const ACTION_HIERARCHY = {
  admin: ['read', 'write', 'delete'],
  delete: ['read', 'write'],
  write: ['read'],
  read: [],
}

// "vendor-management:admin" → expands to:
// { "vendor-management:admin", "vendor-management:read",
//   "vendor-management:write", "vendor-management:delete" }
resolvePermissions(permissions, ACTION_HIERARCHY)

hasPermission(permissions, 'vendor-management', 'write')
// → checks permissions.has('vendor-management:write')

hasModuleAccess(permissions, 'vendor-management')
// → checks permissions.has('vendor-management:read')
// true for ANY granted action (admin implies read)
```

### Layer 2: Typed Context Factory

`packages/app-shell/src/permissions/index.ts`

```typescript
createPermissionsContext<Module, Action>()
// Returns:
// PermissionsProvider — wraps the React tree, injects the resolved Set
// useResolvedPermissions() — returns the Set
// useHasPermission(module, action) — boolean hook
// useHasModuleAccess(module) — boolean hook
```

### Layer 3: Per-App Binding

`apps/pxc-retail/src/lib/permissions/index.ts`

```typescript
// Calls the factory with retail-specific types:
const {
  PermissionsProvider,
  useHasModuleAccess,
  // ...
} = createPermissionsContext<Module, Action>()

// Exports typed helpers that already know about menuGroups:
export { requireModuleAccess, filterMenuGroups, resolveLandingRoute,
         useFilteredMenuGroups, useFilteredSubTabs }
```

### How session → permissions flows

```
_shell.tsx beforeLoad
  → orpc.users.session (no auth middleware on this procedure)
  → handler: parseAuthSessionUser(cookie) → currentUser
  → resolveUserRoles(userId, tenantId) [stubs to DEFAULT_ROLES today]
  → resolveStoredRolePermissions(roles) → string[]
  → returns session.permissions as string[] (already hierarchy-expanded)
  → _shell.tsx: new Set(session.permissions) → PermissionsProvider
```

**Server-side defense in depth:**
The same permission check runs inside the authed middleware chain on every BFF procedure, independent of the client-side guard. Failing `requireModuleAccess` in `beforeLoad` prevents the page from rendering; failing `requirePermission` in the BFF returns a `FORBIDDEN` ORPCError. Both must pass.

### Navigation filtering

`filterMenuGroups(resolved)` drops `MenuGroup` items where `hasModuleAccess` returns false. This powers both the live nav and the "live preview" inside the Roles & Permissions admin panel.

`resolveLandingRoute(resolved)` returns the first accessible `href` — used in the root index route redirect to send users to their first allowed page.

---

## Routing

File system path = URL path. Rules:

| Pattern | Meaning |
|---------|---------|
| `__root.tsx` | Global root layout (no URL segment) |
| `_shell.tsx` | Pathless layout (adds no URL segment, wraps children) |
| `_shell/` | Directory for children of the pathless layout |
| `vendors.tsx` | Page at that path |
| `$vendorId.tsx` | Dynamic segment `:vendorId` |
| `routeTree.gen.ts` | Auto-generated — never edit |

### Route File Anatomy

```typescript
export const Route = createFileRoute('/_shell/vendor-central/vendor-management/vendors')({
  // 1. Parse + default URL search params
  validateSearch: (search) => vendorSearchSchema.parse(search),

  // 2. Guard + data prefetch (runs before component mounts)
  beforeLoad: ({ context }) => {
    requireModuleAccess(context.resolvedPermissions, 'vendor-management')
    // if fails: throw redirect({ to: '/no-access' })
  },

  // 3. Page component
  component: VendorPortalPage,

  // 4. Error boundary scoped to this route
  errorComponent: RouteErrorComponent,
})
```

### Route Context

TanStack Router propagates context down the tree. The root route defines `{ queryClient, i18n, timezone }`. `_shell.tsx` `beforeLoad` extends it with `{ user, tenantId, resolvedPermissions }`. Every child route accesses context via `Route.useRouteContext()` or receives it in its own `beforeLoad({ context })`.

### Search Params as State

Search params are the source of truth for all filterable/sortable page state — they are bookmarkable, shareable, and SSR-compatible.

```typescript
// Navigate to update filter state:
navigate({ search: (prev) => ({ ...prev, status: 'active' }) })

// Read in component:
const { sort, status, view } = Route.useSearch()
```

**Do not store filter state in local React state.** Put it in the URL via `validateSearch`.

---

## Design System

### Import Rule

No barrel. Every component is its own file.

```typescript
// CORRECT:
import { Button } from '@syndigo/design-system/components/button'
import { DataTable } from '@syndigo/design-system/components/data-table'
import { cn } from '@syndigo/design-system/lib/utils'

// WRONG — no barrel export at package root:
import { Button } from '@syndigo/design-system'
```

### Technology

- **Tailwind CSS 4** — OKLch color tokens in `globals.css`; imported once at `__root.tsx` via `appCss`
- **CVA (Class Variance Authority)** — variants on every component
- **@base-ui/react** — accessible primitives (Dialog, Select, Tooltip, etc.) — shadcn `base-nova` preset
- **`cn()`** — always use this for merging class names (clsx + tailwind-merge)

### DataTable Pattern

The design system renders a TanStack Table instance — it does not own table state.

```typescript
// App owns state and columns:
const table = useTable({
  features: tableFeatures({ columnVisibilityFeature }),
  data: vendors,
  columns: vendorColumns,
})

// Design system owns rendering:
<DataTable
  table={table}
  onRowClick={(row) => navigate({ to: '/$vendorId', params: { vendorId: row.id } })}
  emptyState={t($ => $.vendor.empty_state)}
/>
```

### Key Components Quick Reference

| Component | Import suffix | Notes |
|-----------|--------------|-------|
| `Button` | `components/button` | Also exports `buttonVariants` |
| `Badge` | `components/badge` | CVA: default, secondary, destructive, outline |
| `DataTable` | `components/data-table` | Consumes TanStack Table instance |
| `DataTablePagination` | `components/data-table-pagination` | Prev/Next cursor pager |
| `Dialog` | `components/dialog` | Modal |
| `Drawer` | `components/drawer` | Side panel/sheet |
| `Field` | `components/field` | Form field wrapper (label + error) |
| `Skeleton` | `components/skeleton` | Loading placeholder |
| `Spinner` | `components/spinner` | Loading indicator |
| `Toaster` | `components/sonner` | Toast root (mounted in `__root.tsx`) |
| `Combobox` | `components/combobox` | Dropdown with filtering |

---

## i18n

### Selector Callbacks (not string keys)

```typescript
const { t } = useTranslation()

// Static key:
t($ => $.vendor.table_headers.name)

// Interpolation:
t($ => $.vendor.employees_count, { count: 5 })

// Pluralization (define both `key` and `key_one` in locale files):
t($ => $.items, { count: 1 })  // → "1 item"
t($ => $.items, { count: 5 })  // → "5 items"

// Closed union → Record map (preferred over dynamicSelector):
const STATUS_LABELS: Record<VendorStatus, TranslationSelector> = {
  active:  $ => $.vendor.status.active,
  pending: $ => $.vendor.status.pending,
}
t(STATUS_LABELS[vendor.vendorStatus])

// Runtime-computed key (only when union is open/unknown):
t(dynamicSelector(`errors.${errorKey}`))
```

**Never use string keys** (`t('vendor.name')`). The selector callback pattern gives compile-time type safety and IDE autocomplete.

### ErrorKey Flow

The `ErrorKey` union in `@repo/core-contracts/src/types/error-key.ts` is the typed vocabulary of all user-facing error strings.

```
BFF: throwError({ code: 'NOT_FOUND', errorKey: 'vendor.not_found' })
     TypeScript rejects any errorKey not in the union

Response: { error: { data: { errorKey: 'vendor.not_found', traceId } } }

Client: MutationCache.onError
  → parseErrorPayload → { errorKey: 'vendor.not_found' }
  → dynamicSelector('errors.vendor.not_found')
  → t(selector) → "Vendor not found" (from locale file errors.vendor_not_found)
  → toast.error(...)
```

**Adding a new error key:**
1. Add string literal to `ErrorKey` union in `core-contracts/src/types/error-key.ts`
2. Add `errors.<key>` entry to all four locale files in every app that surfaces it
3. Use `throwError({ ..., errorKey: 'your.new.key' })` in the BFF

Locale files must have matching key structure across all four languages. Missing key in any locale = `pnpm typecheck` fails.
