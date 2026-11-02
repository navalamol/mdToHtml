# Error Handling — Knowledge Base

**Modules owned:** `packages/orpc/src/errors.ts`, `packages/orpc/src/upstream-error.ts`, `packages/orpc/src/middleware/error-recording.ts`, `packages/orpc/src/middleware/validation-error.ts`, `packages/app-shell/src/error-toast.ts`, `packages/app-shell/src/query/error-cache.ts`, `apps/*/src/lib/error-toast.ts`, `apps/*/src/integrations/tanstack-query/error-cache.ts`, `apps/*/src/components/RouteErrorComponent.tsx`
**Entry points:** `throwError` (server), `getErrorToast` (client), `makeMutationCache` (client)
**Last verified:** 2026-09-30 | commit `1cb0369` | branch `dev/jmarquardt/kb-bootstrap-2`

Typed, end-to-end error pipeline. Server procedures throw `ORPCError` via `throwError`; `errorRecordingMiddleware` records the span exactly once; the client deserializes `ORPCError.data` as `ErrorPayload` and renders a localized toast or a `RouteErrorComponent` branch depending on where the error surfaces.

## Files

| Doc | Covers |
|---|---|
| `README.md` | scope, architecture, flow, reusable surface, related KB |
| `contracts.md` | `ErrorPayload` shape, `ErrorKey` union, `ErrorToastConfig`, sample payloads |

## Scope

**In scope:** `throwError`, `ErrorPayload`, `ErrorKey`, `mapUpstreamError`, `errorRecordingMiddleware`, `validationErrorMiddleware`, `getErrorToast`, `makeMutationCache`, `RouteErrorComponent` branching logic.
**Out of scope:** procedure implementation details (→ `rpc-layer`), RBAC errors (→ `permissions`), OTel bootstrap (→ `@syndigo/telemetry`), i18n translation files (→ `PATTERNS.md` ErrorKey pattern).

## Architecture

| Layer | Module | Export | Responsibility |
|---|---|---|---|
| Construction | `@syndigo/orpc/errors` | `throwError` | Only path for BFF-originated errors; attaches trace context; pure factory |
| Recording | `@syndigo/orpc/middleware/error-recording` | `errorRecordingMiddleware` | Records every escaping `ORPCError` on the OTel span exactly once; re-throws |
| Validation | `@syndigo/orpc/middleware/validation-error` | `validationErrorMiddleware` | Rewraps Zod `ValidationError` as `ORPCError` with `errorKey: 'upstream.validation'` |
| Client parse | `@syndigo/app-shell/error-toast` | `getErrorToast`, `parseErrorPayload` | Resolves `ORPCError` → `ErrorToastConfig` with a `TranslationSelector` title |
| Mutation cache | `@syndigo/app-shell/query/error-cache` | `makeMutationCache` | Global `MutationCache.onError` → toast; supports `meta.errorToast` overrides |

## Flow

| Hop | Condition | Envelope | Mutates |
|---|---|---|---|
| Procedure calls `throwError({ code, errorKey, params })` | error condition | `ThrowErrorOptions` | no |
| `throwError` reads `getTraceContext()` | always | adds `traceId`, `spanId` to `ErrorPayload` | no |
| `throwError` constructs and throws `ORPCError` | always | `ORPCError { code, data: ErrorPayload }` | no |
| `errorRecordingMiddleware` catches | error escape from any inner hop | calls `recordErrorOnSpan`; sets `error.code`, `error.key` attributes | span |
| `errorRecordingMiddleware` re-throws | always | `ORPCError` unchanged | no |
| `RPCHandler` serializes error | always | HTTP error response; `error.data` included in body | no |
| `MutationCache.onError` (mutation) | client receives error | calls `getErrorToast(error)` | no |
| `getErrorToast` resolves title | `ORPCError` with `errorKey` | `dynamicSelector('errors.${errorKey}')` | no |
| `getErrorToast` falls back | no `errorKey` | `ERROR_KEY_BY_CODE[error.code]` or generic | no |
| `toast.error(translate(titleKey))` | always | localized string rendered in toast | no |
| `RouteErrorComponent` (query failure) | `code === 'UNAUTHORIZED'/'FORBIDDEN'` | access-denied UI | no |
| `RouteErrorComponent` | `code === 'NOT_FOUND'` | 404 UI | no |
| `RouteErrorComponent` | other codes | generic error UI + trace ID for support | no |

## Design Patterns

**`throwError` is the only BFF error construction path** — never `throw new ORPCError(...)` directly in a procedure. `throwError` is typed to return `never`, so no `throw` keyword at the call site, and it attaches the trace context automatically.

**`errorRecordingMiddleware` records once** — it sits outermost on `os` and records every escaping error exactly once. Inner middleware and handlers should not call `recordErrorOnSpan` on errors they re-throw — only on errors they swallow or on the `routes/rpc/$.ts` outer `try/catch` for pre-handler throws.

**`meta.errorToast` overrides** — to suppress a toast for a specific mutation: `useMutation({ ..., meta: { errorToast: false } })`. To override the title: `meta: { errorToast: { titleKey: $ => $.myKey } }`. `titleKey` is typed as `TranslationSelector` — compile-time-checked.

**ErrorKey two-step** — see `PATTERNS.md`.

## Reusable Components

| Export | From | Use |
|---|---|---|
| `throwError` | `@syndigo/orpc/errors` | Only BFF error construction path |
| `recordErrorOnSpan` | `@syndigo/orpc/errors` | Route-level outer `try/catch` only |
| `getErrorToast` | `@syndigo/app-shell/error-toast` (re-exported via `apps/*/src/lib/error-toast.ts`) | Resolve `ORPCError` → `ErrorToastConfig` |
| `parseErrorPayload` | same re-export | Safely parse `ORPCError.data` as `ErrorPayload` |
| `makeMutationCache` | `apps/*/src/integrations/tanstack-query/error-cache.ts` | Build the app's `MutationCache` with global toast behavior |
| `ErrorToastMeta` | same | Type for `mutation.meta.errorToast` |

## Related KB

- `rpc-layer` — builder stack (`os`, `authed`) and how `errorRecordingMiddleware` + `validationErrorMiddleware` are wired into the middleware chain
- `permissions` — `UNAUTHORIZED` / `FORBIDDEN` codes are produced by `authMiddleware`; `RouteErrorComponent` branches on them

## Last verified

2026-09-30 | commit `1cb0369` | branch `dev/jmarquardt/kb-bootstrap-2`
