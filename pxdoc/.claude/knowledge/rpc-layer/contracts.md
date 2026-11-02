# RPC Layer — Contracts & Samples

**Last verified:** 2026-10-27 | commit `b39592c` | branch `main`

## Contracts & Signatures

### `getOrpcContext` — context constructor

```ts
// apps/pxc-retail/src/integrations/orpc/get-orpc-context.ts
function getOrpcContext(): Context
```

Reads the incoming HTTP request (via `@tanstack/react-start/server`), infers `tenantId` from the `x-rdp-tenantId` header or the first subdomain of the hostname, validates the auth session cookie, and returns a `Context` with per-upstream client instances. Throws `Error` (not `ORPCError`) when `tenantId` cannot be inferred or the auth cookie is absent and `ALLOW_DEV_FALLBACK_USER` is false — the route handler's outer `try/catch` calls `recordErrorOnSpan` and returns HTTP 500.

### `client` / `orpc` — isomorphic client exports

```ts
// apps/pxc-retail/src/integrations/orpc/client.ts
export const client: RouterClient<typeof router>  // raw typed client
export const orpc: TanstackQueryUtils<typeof client> // React Query utils
```

`client` calls the router in-process on the server or via `RPCLink` over HTTP on the client. `orpc` wraps it with `createTanstackQueryUtils(client)`. Standard usage:

```ts
useSuspenseQuery(orpc.vendorCentral.vendor.list.queryOptions({ input: {} }))
```

### `oc` — contract builder with standard errors

```ts
// packages/core-contracts/src/schemas/standard-errors.ts
export const oc = ocBase.errors(standardErrors)
```

`standardErrors` pre-applies the nine standard error codes so every procedure inherits them. Individual procedures can chain additional `.errors({...})` calls — maps merge.

### `vendorCentral.vendorHistory.export` — file-returning procedure

```ts
// packages/core-contracts/src/vendor-central/contracts/vendor-history.ts
export: oc.input(VendorHistoryExportInputSchema).output(z.instanceof(File))
// packages/orpc/src/procedures/vendor-central/vendor-history.ts
export const exportVendorHistory // requirePermission('vendor-management', 'read')
```

Pages `GET /v1/vendors/{vendorId}/history` (limit 200) over `from`/`to`, applies `actorScope`, `attributes` and `includeRelationships`, and returns an `.xlsx` or `.pdf` `File`. Exceeding `EXPORT_ROW_CAP` (5000) throws `vendor_history.export_too_large` before any file is built. Sample input, from `packages/orpc/src/__tests__/vendor-history.test.ts`:

```json
{ "vendorId": "<vendor id>", "format": "xlsx", "includeRelationships": false }
```

`actorScope` defaults to `"all"` and `order` to `"desc"`; `columnHeaders` carries client-translated header labels.

### Sample: `TenantVendor` response shape

Source: `packages/orpc/src/__tests__/fixtures/tenant-vendors.ts`

```json
{
  "id": "aa1b2c3d-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  "tenantId": "11111111-1111-4111-8111-111111111111",
  "legalName": "Acme Corporation",
  "vendorStatus": "active",
  "employeeCount": 500,
  "websiteUrl": "https://acme.com",
  "createdAt": "2024-02-01T10:00:00.000Z",
  "updatedAt": "2024-02-01T10:00:00.000Z"
}
```

**Tile-card fields** (`category`, `displayId`, `location`, `capabilities`, `onTimeDeliveryRate`, `onTimeDeliveryTrend`, `orderVolume`) are declared `.nullish()`/`.optional()` on `TenantVendorSchema` but the upstream API does not supply them yet. `listTenantVendors` merges a deterministic stub (`mockVendorCardFields`) over each row only when `context.stubsEnabled`, tracked by RPC-148 — see the `stubsEnabled` fork below and the repo-wide stub pattern in `PATTERNS.md`.

**`tenantVendor.list` query params** — `q` (keyword), `vendorStatus` (→ upstream `vmvendorstatus` attribute filter), `sort`/`sortDir`, and `cursor`/`limit` (`cursor` is a stringified `offset`). `sort` is `VendorSortFieldSchema` = `name` | `trustScore` | `status`, mapped in `listTenantVendors` to the upstream scalar fields `vmlegalname` / `vmvendortrustscore` / `vmvendorstatus` and sent as a single `field:dir` sort token; it is omitted when `sort` is unset. Only these three real scalar fields are sortable — the stub-only tile-card fields are not, so they are intentionally absent from `VendorSortFieldSchema`.

### `tenantVendorDocument` — read-only, stub-backed slice

```ts
// packages/core-contracts/src/vendor-central/contracts/tenant-vendor-document.ts
list: oc.input({ vendorId, cursor?, limit? }).output({ items: TenantVendorDocument[], nextCursor? })
find: oc.input({ id, vendorId }).output(TenantVendorDocument)
// packages/orpc/src/procedures/vendor-central/tenant-vendor-documents.ts
listTenantVendorDocuments / findTenantVendorDocument // requirePermission('vendor-management', 'read')
```

Read-only (`list` + `find`). Upload / new-version / preview-log ops are deferred until the upstream upload mechanism is fixed (RPC-155), so no mechanism-dependent shape is baked into the contract — the frontend's upload dialog does an optimistic client-side cache insert in the meantime. The upstream vendor API has no document endpoints yet, so both procedures are whole-procedure stubs behind `context.stubsEnabled` (see the fork below). `TenantVendorDocumentSchema` models a logical document plus an append-only `versions[]`, with type-specific data (`certificateOfInsurance` / `fdaFsma` / `gfsiUsda` / `w9`) keyed off `documentType`; `status` is derived, not stored. Supersedes the orphaned `VendorDocumentSchema` in `vendor-schema.ts`.

## Config / Forks

| Setting | Lookup | Values | Behavior |
|---|---|---|---|
| `VITE_BASE` | `getOrpcServerPrefix` reads `env.VITE_BASE` | `"/"` (default) or a path prefix | `"/"` → URL prefix is `/rpc`; any other value → URL prefix is `${VITE_BASE}/rpc`. Applied on the browser client only. |
| `ALLOW_DEV_FALLBACK_USER` | `getOrpcContext` calls `allowDevFallbackUser(env.ALLOW_DEV_FALLBACK_USER)` | falsy (prod) / truthy string (local) | Falsy → auth session cookie required; auth cookie forwarded to vendor API. Truthy → `X_RDP_USER_ID` env var used as the signed-in user; service-account headers forwarded to vendor API. |
| `X_RDP_USER_ID` | `getOrpcContext` calls `devFallbackUser(env.X_RDP_USER_ID)` | user ID string | Used only when `ALLOW_DEV_FALLBACK_USER` is truthy; provides the fallback user identity. |
| `MARKETPLACE_TENANT_ID` | `getOrpcContext` reads `env.MARKETPLACE_TENANT_ID` | string or undefined | Injected into `Context` for procedures that need to call the marketplace tenant's upstream API. |
| Server vs client environment | `createIsomorphicFn()` branch check | server process / browser | Server-side: calls router in-process via `createRouterClient`. Client-side: calls router via HTTP `RPCLink`. Determined at build time; no config knob. |
| `stubsEnabled` | `context.stubsEnabled` (ADR RPC-43 D8) | truthy / falsy | Truthy → `listTenantVendors` merges `mockVendorCardFields(v.id)` tile-card fields over each mapped vendor. Falsy → rows pass through with those fields undefined. Stub only; RPC-148 tracks the real upstream fields. |
| `stubsEnabled` (document slice) | `context.stubsEnabled` | truthy / falsy | Truthy → `tenantVendorDocument.list`/`find` return `mockVendorDocuments`. Falsy → `list` returns `{ items: [] }`, `find` throws `vendor.document_not_found`. Whole-procedure stub (no upstream endpoint exists); RPC-155 tracks the real endpoints. |
