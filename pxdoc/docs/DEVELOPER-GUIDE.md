# Developer Guide: End-to-End Feature Walkthrough

**Audience:** UI developers joining the team. Assumes React knowledge (even if from React 16), basic HTTP/Node.js awareness, and no prior TanStack/oRPC experience.

**Goal:** After reading this, you will understand every layer of this codebase — what it does, why it exists, and exactly what changes when a new feature is added. Use it as your reviewer's reference.

---

## Table of Contents

1. [What is this product?](#1-what-is-this-product)
2. [The architecture in one picture](#2-the-architecture-in-one-picture)
3. [The example we'll trace: Vendor List](#3-the-example-well-trace-vendor-list)
4. [Layer 1 — Zod Schemas (the data shapes)](#4-layer-1--zod-schemas-the-data-shapes)
5. [Layer 2 — oRPC Contracts (the API promise)](#5-layer-2--orpc-contracts-the-api-promise)
6. [Layer 3 — TypeScript Types (free from the schemas)](#6-layer-3--typescript-types-free-from-the-schemas)
7. [Layer 4 — oRPC Implementation (server-side logic)](#7-layer-4--orpc-implementation-server-side-logic)
8. [Layer 5 — The Router (wiring everything together)](#8-layer-5--the-router-wiring-everything-together)
9. [Layer 6 — How HTTP Actually Works Here](#9-layer-6--how-http-actually-works-here)
10. [Layer 7 — The Isomorphic Client (browser + server)](#10-layer-7--the-isomorphic-client-browser--server)
11. [Layer 8 — TanStack Router (pages and URL)](#11-layer-8--tanstack-router-pages-and-url)
12. [Layer 9 — TanStack Query (data fetching in React)](#12-layer-9--tanstack-query-data-fetching-in-react)
13. [Layer 10 — React Components (what the user sees)](#13-layer-10--react-components-what-the-user-sees)
14. [Layer 11 — i18n (all user text)](#14-layer-11--i18n-all-user-text)
15. [Layer 12 — Design System (shared UI components)](#15-layer-12--design-system-shared-ui-components)
16. [The Full Request Journey](#16-the-full-request-journey)
17. [What Changes When a New Feature Is Added](#17-what-changes-when-a-new-feature-is-added)
18. [Error Handling Deep Dive](#18-error-handling-deep-dive)
19. [Permissions: How Route Guards Work](#19-permissions-how-route-guards-work)
20. [Reviewer Checklist](#20-reviewer-checklist)

---

## 1. What is this product?

This is **Syndigo's retail platform** — a multi-tenant SaaS web application. "Multi-tenant" means many different retail companies (tenants) log into the same app, each seeing only their own data.

The monorepo contains two applications:

| App | Port | What it does |
|---|---|---|
| `apps/pxc-retail` | 3000 | Main retail app — vendors, products, merchandising |
| `apps/tenant-management` | 3001 | Syndigo-internal admin — onboard tenants, manage features |

Both apps share:
- A **BFF (Backend-For-Frontend)** — server code that talks to upstream APIs
- A **design system** — shared React UI components
- An **app shell** — nav, permissions, i18n wiring

---

## 2. The Architecture in One Picture

```
Browser
  │  HTTP GET /vendor-central/vendor-management/vendors
  ▼
TanStack Start (SSR framework on Nitro)
  │  Server-renders the React page
  │  During render, calls are NOT HTTP — they're direct function calls
  ▼
TanStack Router (file-based routing)
  │  src/routes/_shell/vendor-central/vendor-management/vendors.tsx
  │  Runs beforeLoad guards, validates URL search params
  ▼
React Component renders, calls useSuspenseInfiniteQuery
  │
  ▼
oRPC isomorphic client
  │  On server: direct function call into the router
  │  In browser: HTTP POST to /rpc
  ▼
oRPC Router  (packages/orpc/src/router.ts)
  │  vendorCentral.tenantVendor.list → listTenantVendors handler
  ▼
Middleware stack (auth → permissions → api-client)
  ▼
Handler calls upstream Vendor API (external HTTP service)
  │  GET https://vendor-api.internal/v1/vendors
  ▼
Returns data → validated against Zod output schema → sent to client
  ▼
React Query caches it → VendorTable renders
```

**Key insight:** On the first page load (SSR), there are **zero extra HTTP round-trips** for data — the server calls its own functions directly. After hydration, if the user filters or paginates, the browser sends HTTP POST to `/rpc`.

---

## 3. The Example We'll Trace: Vendor List

URL: `/vendor-central/vendor-management/vendors`

The page shows a paginated, filterable list of vendors. You can switch between grid view and table view. Clicking a row navigates to the vendor detail page.

Files involved:

```
packages/core-contracts/src/schemas/vendor-schema.ts        ← data shapes
packages/core-contracts/src/vendor-central/contracts/tenant-vendor.ts  ← API contract
packages/core-contracts/src/types/vendor-types.ts           ← TypeScript types
packages/orpc/src/builder.ts                                ← middleware builder
packages/orpc/src/procedures/vendor-central/tenant-vendors.ts  ← server logic
packages/orpc/src/router.ts                                 ← wiring
apps/pxc-retail/src/integrations/orpc/client.ts             ← isomorphic client
apps/pxc-retail/src/routes/_shell/vendor-central/vendor-management/vendors.tsx  ← page
apps/pxc-retail/src/components/vendor/VendorTable.tsx        ← table component
apps/pxc-retail/src/locales/en/translation.ts               ← text strings
```

---

## 4. Layer 1 — Zod Schemas (the data shapes)

**File:** `packages/core-contracts/src/schemas/vendor-schema.ts`

### What is Zod?

Zod is a **runtime validation library**. You describe the shape of data using code, and Zod checks that real data matches that shape at runtime — and TypeScript infers the static types automatically.

Think of it like a stricter version of PropTypes from old React, but for any data (API responses, URL params, form inputs).

```typescript
import { z } from 'zod'

// This is a Zod schema — a runtime validator AND a type description
export const VendorStatusSchema = z.enum(['active', 'pending', 'suspended'])

// This is a full object schema
export const TenantVendorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  officialCorporationName: z.string(),
  website: z.url().optional(),     // optional() means the field may be absent
  employeeCountEstimate: z.number().int().nonnegative().optional(),
  status: VendorStatusSchema,      // reuse a schema as a field type
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
```

### Why is this in `core-contracts`, not inside the app or the server?

Because **both the server implementation AND the frontend components need the same type information**. Putting schemas in a shared package means:
- The server uses it to validate data coming from the upstream API
- The frontend TypeScript types are automatically correct — no manual sync needed
- If the schema changes, TypeScript fails everywhere that assumes the old shape

### The VendorListFilterSchema — used on both ends

```typescript
// packages/core-contracts/src/schemas/vendor-schema.ts
export const VendorListFilterSchema = z.object({
  status: VendorStatusSchema.optional(),
  q: z.string().optional(),
  sort: VendorSortFieldSchema.optional(),
  sortDir: SortDirectionSchema.optional(),
})
```

This exact schema is used in **two completely different places**:
1. In the URL search params validation on the frontend (see Layer 8)
2. As the basis for the oRPC contract input (see Layer 5)

This is intentional — the URL reflects the query, and the server receives the same query fields.

---

## 5. Layer 2 — oRPC Contracts (the API promise)

**File:** `packages/core-contracts/src/vendor-central/contracts/tenant-vendor.ts`

### What is oRPC?

oRPC (Observant Remote Procedure Call) is a **type-safe RPC framework** — think of it as a strongly-typed replacement for writing REST endpoints by hand. Instead of:
- Writing a manual `fetch('/api/vendors?status=active')`
- Manually typing the response shape
- Writing the server route handler separately with no connection to the client

With oRPC:
- You define the contract once (input shape + output shape)
- The server implements it
- The client calls it as a function — no URL strings, no manual fetch
- TypeScript enforces that input and output match across the entire call chain

### The Contract

```typescript
// packages/core-contracts/src/vendor-central/contracts/tenant-vendor.ts
import { oc } from '../../schemas/standard-errors'  // project-level contract builder

export const tenantVendorContract = {
  list: oc
    .input(
      z.object({
        vendorStatus: z.string().optional(),
        q: z.string().optional(),
        cursor: z.string().optional(),  // for pagination
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .output(
      z.object({
        items: z.array(TenantVendorSchema),  // array of vendors
        nextCursor: z.string().optional(),   // undefined = last page
      }),
    )
    .route({ summary: 'List Tenant Vendors', tags: ['Tenant Vendor'] }),

  find: oc
    .input(z.object({ id: z.string() }))
    .output(TenantVendorSchema)
    .route({ summary: 'Get Tenant Vendor', ... }),
  
  // ... more procedures (create, update, delete, etc.)
}
```

### What is `oc`?

`oc` (from `packages/core-contracts/src/schemas/standard-errors.ts`) is the **contract builder**. It's like a fluent API for describing an endpoint:

```typescript
// standard-errors.ts
import { oc as ocBase } from '@orpc/contract'

export const standardErrors = {
  BAD_REQUEST: {},
  UNAUTHORIZED: {},
  FORBIDDEN: {},
  NOT_FOUND: {},
  INTERNAL_SERVER_ERROR: {},
  // ... etc
}

// Wrap the base builder with standard error types that every procedure can throw
export const oc = ocBase.errors(standardErrors)
```

Every procedure declared with `oc` automatically has typed error variants — `UNAUTHORIZED`, `NOT_FOUND`, etc. This means the frontend can pattern-match on error codes with full TypeScript support.

### Why separate contracts from implementations?

The contract package (`@repo/core-contracts`) has **zero runtime code** — it's just type declarations and Zod schemas. This means:
- You can import contracts on the **frontend without pulling in server code**
- The frontend bundle never includes database logic, API keys, or secrets
- The contract is the "API specification" that both sides agree on

---

## 6. Layer 3 — TypeScript Types (free from the schemas)

**File:** `packages/core-contracts/src/types/vendor-types.ts`

```typescript
import type { z } from 'zod'
import type { TenantVendorSchema } from '../schemas/tenant-vendor-schema'

// z.infer<> extracts the TypeScript type from a Zod schema
export type TenantVendor = z.infer<typeof TenantVendorSchema>
// Result: { id: string; name: string; status: 'active' | 'pending' | 'suspended'; ... }
```

These `z.infer<>` types are **derived automatically from the Zod schemas** — you never write them by hand. This is important: the types are always in sync with the validation rules. You cannot have a TypeScript type that says `status` is `string` while the Zod schema enforces it's one of `['active', 'pending', 'suspended']`.

Also used:
```typescript
import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract'

// Extract the TypeScript input/output types directly from the contract
export type TenantVendorServiceInputs = InferContractRouterInputs<typeof tenantVendorContract>
// TenantVendorServiceInputs['list']['input'] is the type for list's input
// TenantVendorServiceInputs['list']['output'] is the type for list's output
```

**When to import types:** Frontend components import from `@repo/core-contracts/types/vendor-types`. They never import from `@syndigo/orpc` (that's server code) or define their own type interfaces manually.

---

## 7. Layer 4 — oRPC Implementation (server-side logic)

**File:** `packages/orpc/src/procedures/vendor-central/tenant-vendors.ts`

This is where actual business logic runs. Each function is a **procedure handler** — the server-side function that executes when the contract's endpoint is called.

### The `authed` builder

```typescript
// packages/orpc/src/builder.ts
import { implement } from '@orpc/server'

// 'authed' is a builder that pre-applies middleware:
// 1. errorRecordingMiddleware  — records all errors to OpenTelemetry spans
// 2. validationErrorMiddleware — wraps Zod validation failures in typed errors
// 3. authMiddleware            — checks the user is logged in, puts user in context
// 4. spanAttributesMiddleware  — adds user/tenant info to OTel spans
// 5. apiClientMiddleware       — creates context.vendorApi (the upstream HTTP client)
export const authed = implement(contract)
  .$context<Context>()
  .use(errorRecordingMiddleware)
  .use(validationErrorMiddleware)
  .use(authMiddleware)
  .use(spanAttributesMiddleware)
  .use(apiClientMiddleware)
```

Think of `authed` as "a procedure blueprint that already has auth, observability, and API client wired in". Every protected procedure starts from `authed`.

### The List Handler

```typescript
// packages/orpc/src/procedures/vendor-central/tenant-vendors.ts
export const listTenantVendors = authed.vendorCentral.tenantVendor.list
  //                              ^^^^^ picks the exact contract entry
  .use(requirePermission('vendor-management', 'read'))
  //   ^^^ another middleware: checks this user has 'read' on 'vendor-management'
  .handler(async ({ input, context, signal }) => {
    //              ^^^^^  ^^^^^^^  ^^^^^^
    //              input  = validated against the contract's input schema (already typed!)
    //              context = { user, vendorApi, ... } provided by middleware
    //              signal  = AbortSignal for request cancellation

    // Build attribute filters for the upstream API
    const attributeFilters = input.vendorStatus
      ? ({ vmvendorstatus: input.vendorStatus } as object)
      : {}

    // Call the upstream Vendor API via the typed HTTP client
    const data = await unwrap(
      context.vendorApi.GET('/v1/vendors', {
        signal,
        params: {
          query: {
            q: input.q,
            offset: input.cursor ? Number.parseInt(input.cursor, 10) : undefined,
            limit: input.limit,
            ...attributeFilters,
          },
        },
      }),
    )

    // Map from upstream API shape → our TenantVendorSchema shape
    const vendors = data.vendors?.map(mapTenantVendorFromApi) ?? []
    
    // Compute cursor-based pagination
    const nextOffset = (data.page?.offset ?? 0) + (data.page?.limit ?? 0)
    const hasMore = data.page?.total !== undefined && nextOffset < data.page.total

    return {
      items: vendors,
      nextCursor: hasMore ? String(nextOffset) : undefined,
    }
  })
```

### What is `unwrap`?

```typescript
const data = await unwrap(context.vendorApi.GET('/v1/vendors', { ... }))
```

`unwrap` is a helper that:
1. Awaits the HTTP call to the upstream Vendor API
2. If the response is a non-2xx HTTP status, it calls `throwError(...)` with an appropriate `code` and `errorKey`
3. If successful, returns the typed response data

This is the rule: **never expose upstream error details to the client**. `unwrap` intercepts them and re-throws using our typed error system. A raw error message from the upstream API might leak internal service names, stack traces, or sensitive data. `throwError` ensures only a sanitized, typed error code reaches the browser.

### What is `throwError`?

```typescript
throwError({
  code: 'NOT_FOUND',          // maps to HTTP 404
  errorKey: 'vendor.not_found', // key into the i18n translation files
  params: { id: input.id },   // template variables for the translated message
  message: `...`,             // server-only log message, never sent to client
})
```

`errorKey` is a typed string literal — TypeScript enforces it matches a key in the `ErrorKey` union type. The client renders the human-readable message by looking up `errors.vendor.not_found` in the translation files. The server's `message` stays in logs/traces only.

### The Mapper Functions

```typescript
const vendors = data.vendors?.map(mapTenantVendorFromApi) ?? []
```

The upstream Vendor API returns field names in its own format (e.g., `vmvendorstatus`, `vmvendorname`). Our `TenantVendorSchema` uses clean names (`vendorStatus`, `legalName`). The `mapTenantVendorFromApi` function translates between these — it lives in `packages/orpc/src/utils/tenant-vendor-mappers.ts`.

**Why mappers?** Because the upstream API can change its field names without breaking our app — we only update the mapper, not every component that uses the data.

---

## 8. Layer 5 — The Router (wiring everything together)

**File:** `packages/orpc/src/router.ts`

```typescript
const router = os.router({
  vendorCentral: {
    tenantVendor: {
      list: listTenantVendors,    // ← the function from tenant-vendors.ts
      find: findTenantVendor,
      findDetails: findTenantVendorDetails,
      create: createTenantVendor,
      update: updateTenantVendor,
      delete: deleteTenantVendor,
      // ...
    },
    tenantVendorAddress: { ... },
    tenantVendorContact: { ... },
  },
  // other domains...
})

export default router
```

This is the **address book** — it maps the nested path `vendorCentral.tenantVendor.list` to the actual handler function. The nested object structure is the same nesting you'll use when calling from the frontend:

```typescript
// Frontend:
orpc.vendorCentral.tenantVendor.list.infiniteOptions(...)
//   ^^^^^^^^^^^^^  ^^^^^^^^^^^^  ^^^^
//   matches exactly the router's nested structure
```

TypeScript traverses this structure statically — if the path doesn't exist in the router, the frontend call won't compile.

---

## 9. Layer 6 — How HTTP Actually Works Here

### On the server (SSR, first page load)

When a user navigates to `/vendor-central/vendor-management/vendors`, the Nitro server (TanStack Start's runtime) SSR-renders the React page. During rendering, `useSuspenseInfiniteQuery` is called. The oRPC client detects it's running server-side and calls the router **directly as a function** — no HTTP at all.

```
Browser → GET /vendor-central/vendor-management/vendors
             ↓
         Nitro SSR renders React
             ↓
         useSuspenseInfiniteQuery calls orpc.vendorCentral.tenantVendor.list
             ↓
         createIsomorphicFn().server() branch: calls router directly
             ↓
         listTenantVendors handler runs → calls upstream Vendor API
             ↓
         HTML with pre-filled data sent to browser
```

### In the browser (subsequent interactions)

After the page loads and React "hydrates" (takes control from the server-rendered HTML), any new queries — filtering by status, loading the next page — go through HTTP:

```
User changes filter
    ↓
React Query triggers refetch
    ↓
orpc.vendorCentral.tenantVendor.list runs in browser
    ↓
createIsomorphicFn().client() branch: sends HTTP POST to /rpc
    ↓
POST /rpc  body: { procedure: ['vendorCentral','tenantVendor','list'], input: {...} }
    ↓
Nitro receives it → routes to RPCHandler
    ↓
Same listTenantVendors handler runs
    ↓
JSON response → React Query caches it → component re-renders
```

### Where is `/rpc` defined?

In `apps/pxc-retail/src/routes/rpc.ts` (or similar) — a TanStack Start server route that hands all requests to the oRPC handler. You don't usually touch this file; it's infrastructure.

---

## 10. Layer 7 — The Isomorphic Client (browser + server)

**File:** `apps/pxc-retail/src/integrations/orpc/client.ts`

```typescript
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createRouterClient } from '@orpc/server'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import router from '@syndigo/orpc/router'
import { createIsomorphicFn } from '@tanstack/react-start'

// createIsomorphicFn creates a function that has different implementations
// depending on whether it's running on the server or in the browser.
const getORPCClient = createIsomorphicFn()
  .server(() =>
    // On the server: call the router directly (no HTTP)
    createRouterClient(router, {
      context: getOrpcContext,  // provides auth token, request headers, etc.
    }),
  )
  .client(() => {
    // In the browser: create an HTTP client that POSTs to /rpc
    const link = new RPCLink({
      url: `${window.location.origin}${getOrpcServerPrefix('/rpc')}`,
    })
    return createORPCClient<Client>(link)
  })

export const client = getORPCClient()

// createTanstackQueryUtils wraps the client to work with TanStack Query.
// This gives you .queryOptions(), .infiniteOptions(), .mutationOptions()
// on every procedure path.
export const orpc = createTanstackQueryUtils(client)
```

**Key point:** Both `client` (the raw callable) and `orpc` (the TanStack Query wrappers) are exported. Components almost always use `orpc` — it integrates with React Query's caching, loading states, and error handling automatically.

---

## 11. Layer 8 — TanStack Router (pages and URL)

**File:** `apps/pxc-retail/src/routes/_shell/vendor-central/vendor-management/vendors.tsx`

### File-based Routing

The file path **is** the URL path. `_shell/` is a layout route (renders the nav shell but doesn't add a URL segment). So:
- File: `routes/_shell/vendor-central/vendor-management/vendors.tsx`
- URL: `/vendor-central/vendor-management/vendors`

The `_` prefix on `_shell` means it's a **pathless layout route** — it wraps everything under it in the shell chrome (sidebar, header) without contributing to the URL.

### The Route Definition

```typescript
// At the top of vendors.tsx
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { VendorListFilterSchema, VendorSortFieldSchema, SortDirectionSchema } from '@repo/core-contracts/schemas/vendor-schema'

// Extend the shared filter schema with page-specific fields
const vendorPortalSearchSchema = VendorListFilterSchema.extend({
  view: z.enum(['grid', 'table']).catch('grid'),  // .catch() = default if missing/invalid
  sort: VendorSortFieldSchema.catch('name'),
  sortDir: SortDirectionSchema.catch('asc'),
})

export const Route = createFileRoute(
  '/_shell/vendor-central/vendor-management/vendors',
)({
  validateSearch: (search) => vendorPortalSearchSchema.parse(search),
  //              ^^^^^^ raw URL params (strings) → parsed, typed, defaulted
  component: VendorPortalPage,
  errorComponent: RouteErrorComponent,
})
```

`validateSearch` runs Zod validation on the URL query string. The benefit: if the URL has `?view=invalid`, Zod's `.catch('grid')` silently defaults it to `'grid'` instead of crashing. The component always receives correctly-typed search params.

### Reading Search Params in the Component

```typescript
function VendorPortalPage() {
  const { status, q, sort, sortDir } = Route.useSearch()
  //                                   ^^^^^^^^^^^^^^^^
  // Fully typed: status is 'active' | 'pending' | 'suspended' | undefined
  // TypeScript knows exactly what these values can be
```

### Navigating (updating the URL)

```typescript
const navigate = useNavigate({ from: Route.fullPath })

// Update the view while keeping all other search params unchanged
navigate({ search: (p) => ({ ...p, view: 'table' }) })
```

This is how state lives in the URL — not in React `useState`. Benefits:
- Bookmarkable/shareable URLs that preserve filter state
- Browser back button works correctly
- Server can use the same URL to SSR the same view

---

## 12. Layer 9 — TanStack Query (data fetching in React)

TanStack Query is the **data-fetching and caching layer**. In React 16, you might have used `useEffect` + `useState` to fetch data. TanStack Query replaces that pattern entirely, handling loading states, caching, background refetching, and pagination.

### The Key Call in `vendors.tsx`

```typescript
function VendorContent() {
  const { view, status, q } = Route.useSearch()

  const { data, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useSuspenseInfiniteQuery(
      orpc.vendorCentral.tenantVendor.list.infiniteOptions({
        //               ^^^^^^^^^^^^  ^^^^  ^^^^^^^^^^^^^^^
        // Path in the router        proc   returns query options for infinite scroll

        input: (pageParam: string | undefined) => ({
          vendorStatus: status,   // from URL search params
          q: q || undefined,
          cursor: pageParam,      // undefined = first page
          limit: 12,
        }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        // ^^^^^^^^^^^^^^^^ tells React Query what to pass as pageParam
        // for the next page. undefined = no more pages.
      }),
    )

  const items = data.pages.flatMap((page) => page.items)
  // data.pages = array of all fetched pages
  // flatMap combines all pages' items into one flat array
```

### What is `useSuspenseInfiniteQuery`?

- **`Suspense`** prefix: this hook throws a Promise while loading — React catches it and shows the `<Suspense fallback={...}>` content (the skeleton). No manual `if (isLoading) return <Skeleton />` needed.
- **`Infinite`**: supports "load more" / cursor-based pagination
- **Regular `useQuery`** is for single-page fetches (e.g., fetching one vendor by ID)
- **`useMutation`** is for write operations (create, update, delete)

### The Cache Key

oRPC + TanStack Query automatically generates stable cache keys from the procedure path + input. When `status` changes in the URL, the hook sees a different cache key, fetches fresh data, and React Query caches both sets (the previous and new). If the user switches back to the original filter, the cached result is shown instantly with no network request.

---

## 13. Layer 10 — React Components (what the user sees)

### The Page Component (`vendors.tsx`)

```typescript
function VendorPortalPage() {
  return (
    <div className="space-y-6">
      {/* Page header with title and "Add Vendor" button */}
      <div className="flex items-start justify-between gap-4">
        <h1>{t(($) => $.pages.vendor_management.title)}</h1>
        <Link to="/vendor-central/vendor-management/onboarding">
          {t(($) => $.vendor.actions.add_new_vendor)}
        </Link>
      </div>

      {/* Filter bar — updates URL search params via navigate() */}
      <VendorFilterBar filters={{ status, q, sort, sortDir }} onFilterChange={onFilterChange} />

      {/* Suspense: shows skeleton while loading, VendorContent when ready */}
      <Suspense fallback={<VendorContentSkeleton />}>
        <VendorContent />
      </Suspense>
    </div>
  )
}
```

The page itself doesn't fetch data — `VendorContent` does. Wrapping `VendorContent` in `<Suspense>` means:
- While data loads: `VendorContentSkeleton` renders (skeleton shimmer)
- Once data is ready: `VendorContent` renders with actual data

This keeps the skeleton and loading logic isolated from the real content.

### The Table Component (`VendorTable.tsx`)

```typescript
import { useTable, columnVisibilityFeature, tableFeatures } from '@tanstack/react-table'
import { DataTable } from '@syndigo/design-system/components/data-table'
import type { TenantVendor } from '@repo/core-contracts/types/vendor-types'

// Step 1: Enable table features (column visibility = the "show/hide columns" menu)
const features = tableFeatures({ columnVisibilityFeature })

// Step 2: Define columns
function useVendorColumns() {
  const { t } = useTranslation()

  const columns: ColumnDef<typeof features, TenantVendor>[] = [
    {
      accessorKey: 'legalName',        // reads row.legalName
      header: t(($) => $.vendor.table_headers.name),  // translated header
      cell: ({ getValue }) => (
        <span className="font-medium">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'vendorStatus',
      header: t(($) => $.vendor.table_headers.status),
      cell: ({ getValue }) => {
        const status = getValue<string | undefined>()
        if (!status) return <span className="text-muted-foreground">&mdash;</span>
        return <Badge variant={vendorStatusVariant[status]}>{status}</Badge>
      },
    },
    // ... more columns
  ]
  return columns
}

// Step 3: Wire up the table
function VendorTable({ items }: { items: TenantVendor[] }) {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({
    websiteUrl: false,  // hidden by default
    yearEstablished: false,
  })

  const table = useTable({
    features,
    data: items,
    columns,
    onColumnVisibilityChange: setColumnVisibility,
    state: { columnVisibility },
  })

  return (
    <DataTable
      table={table}
      emptyState={t(($) => $.data_table.no_results)}
      onRowClick={(row) =>
        navigate({ to: '/vendor-central/vendor-management/$vendorId', params: { vendorId: row.original.id } })
      }
    />
  )
}
```

**TanStack Table's job:** Manages which columns are visible, sort state, row selection, etc. `useTable` holds all the state. `<DataTable>` from the design system does the actual HTML rendering — it knows how to iterate visible columns correctly.

**Why separate `useTable` (state) from `<DataTable>` (rendering)?** Because `useTable` gives you programmatic access to table state for other things — like reading `table.getSelectedRowModel()` if you need to act on selected rows. The design system component only renders; the app owns the state.

---

## 14. Layer 11 — i18n (all user text)

**Files:** `apps/pxc-retail/src/locales/{en,es,fr,de}/translation.ts`

Every string the user sees is in a translation file. There are NO hardcoded English strings in components.

### How Translation Works

```typescript
// In a component:
const { t } = useTranslation()

// Selector callback style — t receives a function, not a string key
t(($) => $.vendor.table_headers.name)
//         ^^^^^^^^^^^^^^^^^^^^^^^^^^
//         TypeScript traverses the translation type
//         If this key doesn't exist, TypeScript ERROR at compile time
```

Why callbacks instead of strings like the old `t('vendor.table_headers.name')`?

With the old string approach:
- `t('vendor.table_hedrs.name')` — typo, silently returns the key at runtime, no TypeScript error
- No autocomplete

With callback approach:
- `t(($) => $.vendor.table_hedrs.name)` — TypeScript error: property `table_hedrs` does not exist
- Full IDE autocomplete

### Adding a Translation

When Claude adds any user-visible text, it must add entries to **all four locale files**:

```typescript
// apps/pxc-retail/src/locales/en/translation.ts
vendor: {
  table_headers: {
    name: 'Vendor Name',     // ← new key
    status: 'Status',
    website: 'Website',
    // ...
  },
},

// apps/pxc-retail/src/locales/es/translation.ts — Spanish
vendor: {
  table_headers: {
    name: 'Nombre del Proveedor',
    // ...
  },
},
```

If any locale file is missing a key, **TypeScript compilation fails**. This is the safety net — you can't ship a half-translated UI.

---

## 15. Layer 12 — Design System (shared UI components)

**Package:** `@syndigo/design-system`

The design system is a library of styled React components. It uses:
- **Tailwind CSS 4** with CSS variable tokens in OKLch color space
- **CVA (Class Variance Authority)** for component variants (e.g., `<Badge variant="success">`)
- **@base-ui/react** for accessible primitives (dialogs, selects, tooltips)

### Import Convention

```typescript
// ✅ Correct: import from the specific subpath
import { Button, buttonVariants } from '@syndigo/design-system/components/button'
import { Badge } from '@syndigo/design-system/components/badge'
import { DataTable } from '@syndigo/design-system/components/data-table'

// ❌ Wrong: no barrel file exists
import { Button, Badge } from '@syndigo/design-system'
```

The design system has no package-root barrel file because that would force the entire component library into every bundle, even if only one component is used. Explicit subpath imports enable tree-shaking.

### Key Components Used in Vendor List

| Component | Where imported | What it does |
|---|---|---|
| `Button` | `components/button` | Standard clickable button |
| `Badge` | `components/badge` | Colored status chip (active/pending/suspended) |
| `DataTable` | `components/data-table` | Renders a TanStack Table instance |
| `DataTableViewOptions` | `components/data-table-view-options` | "Show/hide columns" dropdown |
| `ToggleGroup` / `ToggleGroupItem` | `components/toggle-group` | Grid/Table view switcher |

---

## 16. The Full Request Journey

Let's trace exactly what happens when a user first opens the vendor list page.

### Phase 1: Server-Side Render (SSR)

```
1. User browser: GET /vendor-central/vendor-management/vendors?sort=name&sortDir=asc

2. Nitro server receives the request

3. TanStack Router matches the file route:
   src/routes/_shell/vendor-central/vendor-management/vendors.tsx

4. Route's validateSearch runs:
   - Parses "sort=name&sortDir=asc" with vendorPortalSearchSchema
   - Defaults: view='grid', status=undefined, q=undefined
   - Result: { sort: 'name', sortDir: 'asc', view: 'grid', status: undefined, q: undefined }

5. React renders VendorPortalPage on the server
   - VendorPortalPage renders VendorFilterBar + <Suspense><VendorContent /></Suspense>

6. VendorContent runs useSuspenseInfiniteQuery:
   - The oRPC isomorphic client detects server environment
   - Calls listTenantVendors({ vendorStatus: undefined, q: undefined, cursor: undefined, limit: 12 })
     directly as a function (no HTTP)

7. Middleware stack runs:
   a. errorRecordingMiddleware (outermost)
   b. validationErrorMiddleware
   c. authMiddleware → reads session cookie, resolves user + tenant
   d. spanAttributesMiddleware → attaches user/tenant to OTel span
   e. apiClientMiddleware → creates context.vendorApi (authenticated HTTP client for upstream)
   f. requirePermission('vendor-management', 'read') → checks user.permissions
   g. listTenantVendors handler runs

8. Handler calls upstream:
   context.vendorApi.GET('/v1/vendors', { params: { query: { limit: 12 } } })
   → HTTP GET https://vendor-api.internal/v1/vendors?limit=12
   → Returns: { vendors: [...], page: { offset: 0, limit: 12, total: 47 } }

9. Handler maps response → returns { items: TenantVendor[], nextCursor: '12' }

10. React renders VendorContent with data:
    - Renders grid of 12 vendor cards (or table rows)
    - Renders "Load more" button (since nextCursor is defined)

11. Nitro serializes the rendered HTML + React Query cache state
    → Sends to browser
```

### Phase 2: Browser Hydration

```
12. Browser receives HTML — vendor cards are immediately visible (no flash of empty state)

13. React loads and "hydrates" — attaches event handlers to server-rendered HTML

14. React Query restores cache from serialized state
    — The data is already there, no refetch needed
```

### Phase 3: User Interaction (client-side)

```
15. User clicks "Table" toggle → view='table' in URL

16. navigate({ search: (p) => ({ ...p, view: 'table' }) }) runs
    → URL: /vendors?sort=name&sortDir=asc&view=table

17. TanStack Router re-renders with new search params
    → VendorContent re-renders → shows VendorTable (same cached data, just different view)

18. User types "acme" in search box → q='acme' in URL

19. React Query sees different cache key → triggers new fetch

20. oRPC client (browser): HTTP POST /rpc
    Body: { procedure: ['vendorCentral','tenantVendor','list'], input: { q: 'acme', limit: 12 } }

21. Server: Same middleware stack → same handler → calls upstream with q='acme'

22. Response: filtered vendors → React Query updates cache → table re-renders
```

---

## 17. What Changes When a New Feature Is Added

Suppose we need to add a new procedure: "get vendor performance KPIs". Here's every file that changes.

### Step 1: Add the Zod schema

```typescript
// packages/core-contracts/src/schemas/tenant-vendor-schema.ts
export const VendorPerformanceKpiSchema = z.object({
  metric: z.string(),
  value: z.number(),
  trend: z.enum(['up', 'down', 'flat']),
})
export const VendorPerformanceKpisSchema = z.object({
  vendorId: z.string(),
  kpis: z.array(VendorPerformanceKpiSchema),
})
```

### Step 2: Add the contract procedure

```typescript
// packages/core-contracts/src/vendor-central/contracts/tenant-vendor.ts
findPerformance: oc
  .input(z.object({ id: z.string() }))
  .output(VendorPerformanceKpisSchema)
  .route({ summary: 'Get Vendor Performance KPIs', tags: ['Tenant Vendor'] }),
```

### Step 3: Add the TypeScript types

```typescript
// packages/core-contracts/src/types/vendor-types.ts
export type VendorPerformanceKpis = z.infer<typeof VendorPerformanceKpisSchema>
export type VendorPerformanceKpi = z.infer<typeof VendorPerformanceKpiSchema>
```

### Step 4: Implement the handler

```typescript
// packages/orpc/src/procedures/vendor-central/tenant-vendors.ts
export const findTenantVendorPerformance =
  authed.vendorCentral.tenantVendor.findPerformance
    .use(requirePermission('vendor-management', 'read'))
    .handler(async ({ input, context }) => {
      const data = await unwrap(
        context.vendorApi.GET('/v1/vendors/{vendorId}/performance', {
          params: { path: { vendorId: input.id } },
        }),
      )
      return { vendorId: input.id, kpis: data.kpis }
    })
```

### Step 5: Add to the router

```typescript
// packages/orpc/src/router.ts
vendorCentral: {
  tenantVendor: {
    // ... existing
    findPerformance: findTenantVendorPerformance,   // ← add this line
  },
}
```

### Step 6: Add translation keys

```typescript
// apps/pxc-retail/src/locales/en/translation.ts
vendor: {
  performance: {
    title: 'Performance KPIs',
    trend_up: 'Improving',
    trend_down: 'Declining',
    trend_flat: 'Stable',
  },
},

// Also add to es/, fr/, de/ — TypeScript enforces all four exist
```

### Step 7: Add the React component

```typescript
// apps/pxc-retail/src/components/vendor/VendorPerformance.tsx
import { useSuspenseQuery } from '@tanstack/react-query'
import { orpc } from '#/integrations/orpc/client'
import { useTranslation } from '#/hooks/use-translation'

function VendorPerformance({ vendorId }: { vendorId: string }) {
  const { t } = useTranslation()
  const { data } = useSuspenseQuery(
    orpc.vendorCentral.tenantVendor.findPerformance.queryOptions({
      input: { id: vendorId },
    }),
  )

  return (
    <div>
      <h2>{t(($) => $.vendor.performance.title)}</h2>
      {data.kpis.map((kpi) => (
        <div key={kpi.metric}>
          {kpi.metric}: {kpi.value}
        </div>
      ))}
    </div>
  )
}
```

### Step 8: Use it in a route

```typescript
// apps/pxc-retail/src/routes/_shell/vendor-central/vendor-management/$vendorId.tsx
// (already exists — just add the component to the page JSX)
<Suspense fallback={<Skeleton />}>
  <VendorPerformance vendorId={vendorId} />
</Suspense>
```

### What TypeScript enforces automatically

- The procedure must exist in the contract before it can be in the router (TypeScript build failure)
- The handler's return type must match the contract's output schema (TypeScript build failure)
- Every `t(($) => $.vendor.performance.title)` must exist in all four locale files (TypeScript build failure)
- `requirePermission('vendor-management', 'read')` — the module name must be in the known permissions union (TypeScript build failure)

---

## 18. Error Handling Deep Dive

### The Rule: Never Expose Upstream Details

```typescript
// ❌ Wrong — leaks internal error to client
throw new Error(`Upstream returned: ${upstreamError.message}`)

// ✅ Correct — controlled, typed error with i18n key
throwError({
  code: 'NOT_FOUND',
  errorKey: 'vendor.not_found',
  params: { id: vendorId },
  message: `Log only: vendor ${vendorId} 404 from upstream`,  // stays in logs
})
```

### Error Flow to the UI

```
throwError({ code: 'NOT_FOUND', errorKey: 'vendor.not_found' })
  ↓
oRPC error middleware serializes as: { code: 'NOT_FOUND', data: { errorKey: 'vendor.not_found' } }
  ↓
Browser: React Query catches the error
  ↓
error-toast middleware in app-shell reads errorKey
  ↓
Looks up translation: errors.vendor.not_found = "Vendor not found"
  ↓
Shows toast: "Vendor not found"
```

The client never sees "Upstream returned: 404 Not Found from vendor-service-7f3a2b". It sees a clean, localized message.

---

## 19. Permissions: How Route Guards Work

### The Pattern

```typescript
// In a route file's beforeLoad
import { requireModuleAccess } from '@syndigo/app-shell/permissions'

export const Route = createFileRoute('/_shell/vendor-central/vendor-management/vendors')({
  beforeLoad: ({ context }) => {
    requireModuleAccess(context.permissions, 'vendor-management')
    // If user lacks access → throws redirect to /no-access
  },
  component: VendorPortalPage,
})
```

### In the Server Procedure

```typescript
.use(requirePermission('vendor-management', 'read'))
```

Both guards check the same permission system — the route guard prevents rendering the page, and the procedure guard prevents the data call from succeeding even if someone bypasses the UI (e.g., calls `/rpc` directly). Defense in depth.

---

## 20. Reviewer Checklist

When Claude creates a new feature, verify these points:

### Schemas & Contracts

- [ ] New Zod schemas in `packages/core-contracts/src/schemas/` — using `z.object(...)` with specific field validations (`.min()`, `.uuid()`, `.optional()`, etc.)
- [ ] New contract entry in `packages/core-contracts/src/<domain>/contracts/<domain>.ts` using `oc.input(...).output(...)` (not bare `z.object` — uses `oc` for standard errors)
- [ ] Types exported from `packages/core-contracts/src/types/<domain>-types.ts` using `z.infer<>`

### Server Implementation

- [ ] Handler starts with `authed.<domain>.<procedure>` (not bare `os`)
- [ ] Uses `.use(requirePermission(...))` before `.handler(...)`
- [ ] All upstream calls wrapped with `unwrap(...)` — never a raw `await fetch`
- [ ] All errors use `throwError({ code, errorKey, ... })` — no `throw new Error(...)`
- [ ] Added to the router in `packages/orpc/src/router.ts`

### Frontend

- [ ] Imports types from `@repo/core-contracts/types/...` — never re-declares them
- [ ] All user text uses `t(($) => $....)` — no hardcoded strings
- [ ] All four locale files have the new keys (en, es, fr, de)
- [ ] Data fetching uses `useSuspenseQuery` or `useSuspenseInfiniteQuery` — not `useEffect`
- [ ] Loading state handled by `<Suspense fallback={<Skeleton />}>` — not manual `if (isLoading)`
- [ ] Design system components imported via subpath (`@syndigo/design-system/components/button`)
- [ ] Tables use `useTable` + `<DataTable>` pattern — not manual `<tr>/<td>` loops

### General

- [ ] `pnpm typecheck` passes — TypeScript has no errors
- [ ] `pnpm lint` passes — no lint violations
- [ ] `knowledge-sync` skill has been run (Claude does this before committing)
