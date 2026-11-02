# RPC Layer — Knowledge Base

**Modules owned:** `packages/core-contracts/src/`, `packages/orpc/src/`, `apps/*/src/integrations/orpc/`, `apps/*/src/routes/rpc/`, `apps/*/src/routes/openapi/`
**Entry points:** `RPCHandler#handle` (JSON-RPC at `/rpc`), `OpenAPIReferencePlugin` (spec at `/openapi`)
**Last verified:** 2026-10-23 | commit `fcf3cfe` | branch `feature/RPC-135-document-management-core`

Contract-first API layer. `@repo/core-contracts` defines Zod schemas and oRPC contracts; `@syndigo/orpc` implements them; each app exposes them at `/rpc` and `/openapi` and provides an isomorphic client that calls the router directly on the server and over HTTP on the client.

## Files

| Doc | Covers |
|---|---|
| `README.md` | scope, architecture, flow, reusable surface, related KB |
| `contracts.md` | procedure signatures, sample payloads, builder API reference |

## Scope

**In scope:** contract definitions, procedure implementations, builder middleware stack, transport routes (`/rpc`, `/openapi`), isomorphic client, React Query query utils.
**Out of scope:** error recording and payloads (→ `error-handling`), RBAC checks inside procedures (→ `permissions`), OpenTelemetry bootstrap (→ `@syndigo/telemetry`).

## Architecture

| Layer | Module | Export | Responsibility |
|---|---|---|---|
| Contract | `@repo/core-contracts` | `oc` builder | Zod input/output schemas + typed contract tree with `standardErrors` pre-applied |
| Implementation | `@syndigo/orpc` | `os`, `authed` builders | Implement procedures; apply middleware stack |
| Transport | `apps/*/src/routes/rpc/$.ts` | `RPCHandler` | Serve JSON-RPC at `/rpc`; record pre-handler errors |
| OpenAPI | `apps/*/src/routes/openapi/$.ts` | `OpenAPIReferencePlugin` | Auto-generate OpenAPI spec at `/openapi` |
| Client | `apps/*/src/integrations/orpc/client.ts` | `client`, `orpc` | Isomorphic router client + React Query utils |

**Builder middleware stack** (outermost → innermost): `errorRecordingMiddleware` → `validationErrorMiddleware` → *(authed only)* `authMiddleware` → `spanAttributesMiddleware` → `apiClientMiddleware` → handler.

## Flow

| Hop | Condition | Envelope | Mutates |
|---|---|---|---|
| `RPCHandler#handle` | HTTP POST `/rpc/*` | `Request` | no |
| `getOrpcContext()` | always | builds `Context` (tenant, session) | no |
| `errorRecordingMiddleware` | wraps all inner hops | passes `Context` through; records any escape on span | no |
| `validationErrorMiddleware` | always | validates Zod input; rewraps `ValidationError` → `ORPCError` | no |
| `authMiddleware` | authed procedure | resolves user + permissions; adds `AuthedContext` to context | no |
| `spanAttributesMiddleware` | authed | sets `enduser.id`, `app.tenant_id` on active OTel span | no |
| `apiClientMiddleware` | authed | attaches `context.api.*` HTTP clients | no |
| Procedure handler | always | calls `unwrap(context.api.X(...))` | depends on procedure |
| `RPCHandler` serializes | success | JSON response body | no |
| `errorRecordingMiddleware` re-throws | error escape | records on span; `ORPCError` propagates → HTTP error response | no |

**Isomorphic client branch:** server-side uses `createRouterClient(router, { context: getOrpcContext })` — no HTTP hop. Client-side uses `RPCLink` over HTTP POST to `/rpc`.

## Design Patterns

**Contract-first oRPC** — every procedure must have a contract entry before its implementation. See `PATTERNS.md` for the four-step wiring order.

**`unwrap` for upstream calls** — inside any procedure, every `context.api.*` call goes through `unwrap()` from `@syndigo/orpc/errors`. `unwrap` returns the body on success, converts 504 → `TIMEOUT`, propagates `AbortError` unchanged, and calls `mapUpstreamError` on other failures. Never pattern-match HTTP status codes directly.

**File-returning procedures** — a procedure can return a binary file by declaring `.output(z.instanceof(File))` in the contract and returning `new File([bytes], name, { type })` from the handler; `RPCLink` delivers it to the browser as a `File`. Precedent: `vendorCentral.vendorHistory.export` (`exportVendorHistory`). Generation libraries follow the lazy-import pattern in `PATTERNS.md`. Localized strings that end up inside the file (column headers) are sent by the client in the input, so translations stay in the app.

**Masking in the mapper** — PII that the UI must never show unmasked is masked server-side in the procedure's mapper (e.g. contact name/email/phone deltas in `mapActivityEventFromApi`), so every consumer of the procedure, including exports, receives masked values.

**Stubbed response fields behind `context.stubsEnabled`** — when the UI needs fields the upstream API does not expose yet, the handler merges a deterministic `*.mock.ts` stub over the mapped rows, gated on `context.stubsEnabled`, and a Jira ticket tracks building the real field. Precedent: `listTenantVendors` tile-card fields (`mockVendorCardFields`, RPC-148). See `PATTERNS.md`. The same gate also backs **whole procedures** whose upstream endpoint does not exist at all: the handler returns `{ items: [] }` (or throws `NOT_FOUND`) unless `context.stubsEnabled`, then dynamically imports a `*.mock.ts` that returns domain-shaped rows directly — no upstream call, no mapper. Precedents: `tenantVendorDocument.list`/`.find` (`mockVendorDocuments`, RPC-155) and `addressSuggestion.list` (`mockAddressSuggestions`, RPC-73). When the real endpoint lands, swap the stub branch for `unwrap(context.vendorApi…)` + a mapper and delete the `.mock.ts`; the contract and client stay unchanged.

## Reusable Components

| Export | From | Use |
|---|---|---|
| `client` | `apps/*/src/integrations/orpc/client.ts` | Raw typed `RouterClient`; works server- or client-side |
| `orpc` | `apps/*/src/integrations/orpc/client.ts` | `useSuspenseQuery(orpc.domain.proc.queryOptions({ input }))` |
| `os` | `@syndigo/orpc/builder` | Base builder for public (unauthenticated) procedures |
| `authed` | `@syndigo/orpc/builder` | Builder for protected procedures; provides `context.api` |
| `oc` | `@repo/core-contracts/schemas/standard-errors` | Contract builder with `standardErrors` pre-applied |
| `maskName` / `maskEmail` / `maskPhone`, `CONTACT_MASKERS` | `@repo/core-contracts/masking/contact-masking` | Pure contact maskers shared by the BFF mapper and the app's contact UI |
| `classifyActorScope`, `ActivityScope` | `@repo/core-contracts/vendor-central/activity-scope` | One User/System rule for the activity timeline and the history export (provisional: `actorType === 'system'`, else `user`) |
| `validateAddressRules`, `computeAddressWarnings`, `PO_BOX_PATTERN` | `@repo/core-contracts/vendor-central/address-rules` | Pure address validation used by the address form (the BFF does not run it — address procedures pass through to the upstream API): hard rules (required fields, length, P.O. Box on either street line for HQ/Warehouse, city characters, state-in-country, postal format) and the AD-013 unverifiable warning. Sanctioned-country and ZIP/state checks are deliberately absent — that data must come from the backend. |
| `maskLast4`, `BANKING_MASKERS` | `@repo/core-contracts/masking/banking-masking` | Pure banking maskers (`"••••" + last 4`) for the single Banking profile UI, mirroring `contact-masking`. |
| `validateBankingRules`, `computeBankingWarnings` | `@repo/core-contracts/vendor-central/banking-rules` | Pure banking validation (BK-001..BK-018: ABA checksum, EIN/IBAN/SWIFT, holder-match, etc.) used by the Banking profile form; same pass-through stance as `address-rules` (the BFF does not run it). **INTERIM** — RPC-150 moves these rules server-side and removes the duplicative FE checks. |

## Related KB

- `error-handling` — owns `throwError`, `mapUpstreamError`, `errorRecordingMiddleware`, `validationErrorMiddleware`, and client-side toast / `RouteErrorComponent`
- `permissions` — `authMiddleware` populates the permission set; `requireModuleAccess` is the route-guard entry point

## Last verified

2026-10-23 | commit `fcf3cfe` | branch `feature/RPC-135-document-management-core`
