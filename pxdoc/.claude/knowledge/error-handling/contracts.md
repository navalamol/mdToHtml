# Error Handling — Contracts & Samples

**Last verified:** 2026-09-30 | commit `1cb0369` | branch `dev/jmarquardt/kb-bootstrap-2`

## Contracts & Signatures

### `throwError` — only BFF error construction path

```ts
// packages/orpc/src/errors.ts
function throwError(opts: ThrowErrorOptions): never

interface ThrowErrorOptions {
  code: StandardErrorCode           // BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | TIMEOUT | CONFLICT | UNPROCESSABLE_CONTENT | TOO_MANY_REQUESTS | INTERNAL_SERVER_ERROR
  errorKey: ErrorKey                // typed closed union, e.g. 'vendor.not_found'
  params?: Record<string, string | number | boolean | null>
  cause?: unknown
  message?: string                  // English fallback; defaults to errorKey
}
```

Returns `never` — callers do not write `throw throwError(...)`, just `throwError(...)`.

### `getErrorToast` — resolve ORPCError to toast config

```ts
// packages/app-shell/src/error-toast.ts  (re-exported from apps/*/src/lib/error-toast.ts)
function getErrorToast(error: unknown): ErrorToastConfig

interface ErrorToastConfig {
  titleKey: TranslationSelector   // always a valid client translation key
  params?: Record<string, unknown>
  traceId?: string
}
```

Title resolution order: `error.data.errorKey` → `ERROR_KEY_BY_CODE[error.code]` → `'errors.something_went_wrong'`.

### `parseErrorPayload` — safely extract ErrorPayload

```ts
// same re-export path
function parseErrorPayload(data: unknown): ErrorPayload | undefined
```

Returns `undefined` for any shape that does not match `ErrorPayloadSchema`.

### `makeMutationCache` — global mutation error toast

```ts
// apps/*/src/integrations/tanstack-query/error-cache.ts
function makeMutationCache(i18n: I18nInstance): MutationCache
```

The returned `MutationCache` fires `toast.error` on every mutation failure unless `meta.errorToast` is `false`.

### Sample: `ErrorPayload` wire shape (ORPCError.data)

```json
{
  "errorKey": "vendor.not_found",
  "params": { "id": "abc123" },
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7"
}
```

Validation failure payload adds an `issues` array:

```json
{
  "errorKey": "upstream.validation",
  "issues": [
    { "code": "invalid_type", "message": "Expected string, received number", "path": ["legalName"] }
  ],
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7"
}
```

## Config / Forks

| Setting / Flag | Lookup | Values | Behavior |
|---|---|---|---|
| `mutation.meta.errorToast` | `MutationCache.onError` reads `mutation.meta?.errorToast` | absent (auto) / `false` / `{ titleKey, params }` | Absent → auto-derive title from `getErrorToast`. `false` → suppress toast entirely. Object → override `titleKey` and/or `params`. |
| `ORPCError.code` presence | `getErrorToast` checks `error instanceof ORPCError` | `ORPCError` / other `Error` | `ORPCError` → resolves `ErrorPayload` + `ERROR_KEY_BY_CODE` fallback. Other → returns `errors.unexpected_error`. |
| `error.data.errorKey` presence | `getErrorToast` reads `payload?.errorKey` | defined / undefined | Defined → `dynamicSelector('errors.${errorKey}')`. Undefined → `ERROR_KEY_BY_CODE[error.code]` fallback. |
| `RouteErrorComponent` `code` branch | `RouteErrorComponent` reads `ORPCError.code` | `UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` / other | Unauthorized/forbidden → access-denied UI. Not found → 404 UI. Other → generic error UI with trace ID. |
