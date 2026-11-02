---
name: absorb-openapi-changes
description: Propagate changes from packages/orpc/specs/openapi.json (or its generated openapi.d.ts) through the BFF stack — Zod schemas, contract outputs, oRPC handlers, mappers, MSW tests, and where relevant the frontend client. Use when the retail OpenAPI spec is regenerated and the generated types drift from what the procedures/contracts/UI expect.
---

# Absorb OpenAPI Spec Changes

The retail OpenAPI spec is the upstream source of truth for shapes the BFF talks to. When it changes, the rest of the stack (Zod schemas in `@repo/core-contracts`, contract outputs, oRPC handlers, mappers, MSW handlers, UI) drifts silently — TypeScript only catches a subset; the rest manifests as runtime decoding errors, missing UI states, or untranslated strings.

This skill is the playbook for closing that gap deliberately. It is the inverse of `add-orpc-procedure`: that skill creates a new vertical slice; this one absorbs an upstream change into an existing one.

## When to use

- `packages/orpc/specs/openapi.json` was updated (manual edit or vendor drop).
- `pnpm generate` produced a fresh `packages/orpc/src/generated/openapi.d.ts` that no longer matches downstream code.
- `tsc` is failing in `packages/orpc/src/procedures/` or `packages/orpc/src/utils/` after a spec bump.
- The upstream API added a response variant (e.g. 207) and the procedure is silently throwing it away.

## When NOT to use

- A brand-new endpoint with no existing contract — use `add-orpc-procedure` instead.
- A new error key only — use `error-key`.
- A locale-only fix — use `i18n-sync`.

## Required inputs (ask if not provided)

1. **Source of the change** — did the user manually edit `openapi.json`, or did a vendor drop a new spec? If the spec changed but `openapi.d.ts` did not, regenerate first (see step 0).
2. **Scope** — single field, new response variant, renamed/removed field, new endpoint?
3. **Frontend exposure** — does the change need to reach the UI (new optional field, new response variant the user must see)? If yes, you also touch `apps/pxc-retail/`.

## Architecture map (where the change lands)

```
packages/orpc/specs/openapi.json                       # the spec (manually edited or vendor-dropped)
packages/orpc/src/generated/openapi.d.ts               # generated — do NOT edit
                                  ↓
packages/orpc/src/utils/<service>-mappers.ts           # rpx-prefix ↔ camelCase, drop-unknowns
packages/orpc/src/procedures/<domain>/<service>.ts     # handler — unwrap(context.api.*), shape result
                                  ↓
@repo/core-contracts/src/schemas/<service>-schema.ts   # Zod input/output schemas (BFF contract shape)
@repo/core-contracts/src/types/<service>-types.ts      # inferred TS types re-exported
@repo/core-contracts/src/<domain>/contracts/<svc>.ts   # contract input/output bindings + route metadata
                                  ↓
apps/pxc-retail/src/...                                # callers, UI, locale keys
packages/orpc/src/__tests__/<service>.test.ts          # MSW-driven tests
```

## Step 0 — Regenerate types if needed

If the user changed `openapi.json` but did not regenerate:

```bash
pnpm --filter=@syndigo/orpc generate
```

That runs `openapi-typescript specs/openapi.json -o src/generated/openapi.d.ts && oxfmt …`. The d.ts file is auto-generated — never hand-edit it. Now the downstream type errors will show up under `tsc`.

## Step 1 — Identify what changed

Read the diff. The JSON spec has a lot of formatting noise; prefer the generated d.ts diff for signal:

```bash
git diff HEAD -- packages/orpc/src/generated/openapi.d.ts
```

Classify each change against the table below. Multiple categories can apply to one spec bump.

| # | What changed | Touchpoints |
|---|---|---|
| 1 | New response variant on an existing endpoint (e.g. 207) | response schema → contract output → handler → MSW test |
| 2 | New optional field on a response body | mapper FromApi → schema → (optionally) UI |
| 3 | New optional field on a request body | schema → mapper ToApi → callers (frontend) |
| 4 | Renamed or removed field | schema + mapper + callers (let `tsc` guide you) |
| 5 | Changed scalar type (string→number etc.) | schema + mapper casts; check parseInt/toString roundtrips |
| 6 | New 4xx/5xx status code | usually nothing — `unwrap` + `STATUS_TABLE` cover standard codes. New error key? defer to `error-key`. |
| 7 | New endpoint or new operation on an existing service | defer to `add-orpc-procedure` |

## Step 2 — Apply the change, layer by layer

Always work spec-outward: types → schemas → contract → handler → tests → UI. That order lets `tsc` keep you honest at each step.

### 2a. Generated types (auto)

Already produced by step 0. The `components['schemas']['…']` union now reflects the new shape. Reference it in mappers as `type X = components['schemas']['NewType']`.

### 2b. Zod schemas (`packages/core-contracts/src/schemas/<service>-schema.ts`)

Mirror the upstream shape in BFF camelCase. For new response variants, prefer extending an existing schema over copying it:

```ts
// existing
export const TenantVendorDetailSchema = TenantVendorSchema.extend({ ... })

// new variant — extend, don't duplicate
export const TenantVendorCreateResultSchema = TenantVendorDetailSchema.extend({
  errors: z.array(TenantVendorSubEntityErrorSchema).optional(),
})
```

If the new variant introduces an enumerable kind (e.g. one of N sub-entity types), export both the array of literals and the `z.enum` — downstream UI code uses both:

```ts
export const SUB_ENTITY_KINDS = [
  'addresses', 'contacts', /* … */
] as const
export const SubEntityKindSchema = z.enum(SUB_ENTITY_KINDS)
```

### 2c. Inferred types (`packages/core-contracts/src/types/<service>-types.ts`)

Re-export every new schema as a TS type — this is what the app and other packages import:

```ts
export type TenantVendorCreateResult = z.infer<typeof TenantVendorCreateResultSchema>
export type TenantVendorSubEntityError = z.infer<typeof TenantVendorSubEntityErrorSchema>
```

### 2d. Contract output (`packages/core-contracts/src/<domain>/contracts/<service>.ts`)

If the procedure's output shape changed, point the contract at the new schema and update the `.route()` description to note the new behavior:

```ts
create: oc
  .input(TenantVendorCreateSchema)
  .output(TenantVendorCreateResultSchema)   // ← was TenantVendorDetailSchema
  .route({
    summary: 'Create Tenant Vendor',
    description: 'Create a new tenant-vendor relationship. On a 207 Multi-Status upstream response the result includes an `errors` array listing which related sub-entities failed to create.',
    tags: ['Tenant Vendor'],
  }),
```

### 2e. Mappers (`packages/orpc/src/utils/<service>-mappers.ts`)

Mappers translate between upstream rpx-prefixed wire shapes and BFF camelCase. Two rules:

1. **Normalize what you can; pass through what you can't — never silently drop a failure.** If the upstream `entityType` is `rpxcontact`, map it to a known BFF union via a lookup table. If it's not in the table, leave `kind` undefined and keep the raw `entityType` on the error so the UI can render it in an "other" bucket. Dropping a failure means the user never learns it happened — strictly worse than the (internal-only) exposure of the upstream name.

   ```ts
   const RDP_ENTITY_TYPE_TO_KIND: Record<string, TenantVendorSubEntityKind> = {
     rpxaddress: 'addresses',
     rpxcontact: 'contacts',
     // …
   }

   export function mapSubEntityErrorFromApi(
     apiError: ApiSubEntityError,
   ): TenantVendorSubEntityError {
     const kind = RDP_ENTITY_TYPE_TO_KIND[apiError.entityType?.toLowerCase() ?? '']
     return {
       kind, // undefined when no mapping exists — UI renders entityType raw
       entityType: apiError.entityType,
       /* … */
     }
   }
   ```

   The matching schema makes `kind` optional (`SubEntityKindSchema.optional()`). Closed-union types belong in the schema only when "unknown" is genuinely impossible upstream.

2. **Field renames preserve the rpx convention** on the wire side. The BFF schema keeps camelCase; only the mapper bridges them. Don't rename in the schema unless the BFF surface is changing.

The wrapper is a plain `.map` — there's nothing to drop:

```ts
export function mapSubEntityErrorsFromApi(
  apiErrors: readonly ApiSubEntityError[] | undefined,
): TenantVendorSubEntityError[] | undefined {
  if (!apiErrors) return undefined
  return apiErrors.map(mapSubEntityErrorFromApi)
}
```

### 2f. Handler (`packages/orpc/src/procedures/<domain>/<service>.ts`)

For **new response variants** (case 1 in the table), `unwrap()` already accepts them — `response.ok` is true for any 2xx, so 207 bodies flow through unchanged. The handler discriminates on the variant by checking for the variant's distinguishing field via the `in` operator:

```ts
const data = await unwrap(context.api.POST('/v1/vendors', { signal, body: {...} }))

return {
  // … shared fields from the 201 path
  errors: mapSubEntityErrorsFromApi(
    'errors' in data ? data.errors : undefined,
  ),
}
```

The `in` check is what lets TypeScript narrow the `data` union (openapi-fetch unions the body of every declared 2xx response). Do **not** read the HTTP status — `unwrap()` only returns the body. If you genuinely need the status code, the handler must call `context.api.*` directly without `unwrap()` and handle errors itself.

For **new error variants** (case 6), in most cases you do nothing — `STATUS_TABLE` in `packages/orpc/src/upstream-error.ts` maps 400/401/403/404/408/409/422/429/504 to typed ORPCErrors and `mapUpstreamError` writes `upstream.*` span attributes. If the upstream returns a status not in `STATUS_TABLE`, it falls back to `SERVER_ERROR_FALLBACK` (5xx) and that's usually correct. Only widen `STATUS_TABLE` if a new status has clear, distinct UX semantics.

### 2g. MSW tests (`packages/orpc/src/__tests__/<service>.test.ts`)

For any new variant, add a test that overrides the MSW handler per-test (`server.use(...)` — `afterEach` resets handlers via `msw/setup.ts`). Use a fresh `HttpResponse.json(body, { status })`. Assert both:

1. The mapped result has the new field populated and known `entityType`s are normalized to the BFF union.
2. Unknown / unmappable values are **preserved with `kind` undefined** and the raw `entityType` intact — not silently dropped.

```ts
server.use(
  http.post(`${BASE}/:tenantId/vendors`, () =>
    HttpResponse.json({ /* body */, errors: [{ entityType: 'rpxtaxinfo', … }] }, { status: 207 })
  ),
)
const result = await client.vendorCentral.tenantVendor.create({ … })
expect(result.errors).toEqual([expect.objectContaining({ kind: 'taxInfos' })])
```

Always include a **pass-through-unknowns** test for fields populated by lookup tables — that's the regression-protection for the "never silently drop a failure" rule. Assert `kind: undefined` and the raw `entityType` on the unmapped entry.

### 2h. Frontend impact (only if surface changes)

If the new variant or field is user-visible:

- The `submit*` / loader / mutation wrapper passes the new field through (don't strip it at the boundary).
- New UI states get their own component, not new branches in the happy path.
- All user-facing strings go through `useTranslation()` — add keys to all four locales. If `tsc` complains that a key isn't in `TranslationSelector`, use the `i18n-sync` skill to find the gap.
- If a new error variant is BFF-thrown rather than upstream-mapped, add the literal + locale entries via the `error-key` skill.

## Step 3 — Verify

```bash
pnpm typecheck --filter=@repo/core-contracts --filter=@syndigo/orpc --filter=pxc-retail
pnpm test --filter=@syndigo/orpc --filter=pxc-retail
```

If only `@syndigo/orpc` changed (no UI exposure), the second filter is optional.

## Conventions worth re-reading before every absorption

- **`unwrap()` returns the success body**, regardless of which 2xx code came back. To discriminate variants, check distinguishing fields with `in`, not status codes.
- **Never construct `ORPCError` directly** in handlers — use `throwError({ code, errorKey, params?, message? })`. Upstream errors come typed from `unwrap`/`mapUpstreamError` already.
- **Always pass `signal`** to `context.api.*` so client aborts cancel upstream requests.
- **No hand-edits to `openapi.d.ts`** — it gets clobbered on the next `pnpm generate`.
- **Lift repeated `'field' in data ? …` blocks** into mapper helpers once you see them twice.
- **Pass unknown enum-like values through with the closed-union field undefined** and the raw upstream value preserved on a sibling field. Silent under-reporting hides failures from users; the UI can render the raw value in an "other" bucket. The BFF→UI surface is internal — surfacing a failure beats hiding it.

## Checklist

- [ ] `openapi.d.ts` regenerated if `openapi.json` was edited (`pnpm --filter=@syndigo/orpc generate`)
- [ ] Each changed type classified against the change-type table; every applicable touchpoint visited
- [ ] Zod schemas updated; existing schemas extended (not duplicated) where possible
- [ ] Inferred types re-exported from `core-contracts/src/types/`
- [ ] Contract output points at the new schema; `.route()` description updated to mention new behavior
- [ ] Mappers updated; rpx-prefix convention preserved; unknowns passed through (closed-union field undefined, raw value retained)
- [ ] Handler discriminates variants via `in`, not by reading status codes
- [ ] MSW test added for each new variant — including a pass-through-unknowns case
- [ ] Frontend callers passed through the new field; UI states have their own component
- [ ] All user-facing strings added to all four locales (`i18n-sync` if unsure)
- [ ] `pnpm typecheck` + `pnpm test` pass for every affected workspace

## Common mistakes

- Editing `openapi.d.ts` directly — wiped on next regen. Edit `openapi.json`, then regenerate.
- Forgetting to update the contract output schema after extending the response — the procedure compiles but the client still sees the old shape because `oc.output(...)` strips unknown fields.
- Discriminating response variants by HTTP status — `unwrap()` doesn't surface status. Use `in`.
- Silently dropping unknown enum-like values — the user never learns the failure happened. Normalize via a lookup table where possible and pass unknowns through with the closed-union field undefined; retain the raw upstream value on a sibling field so the UI can render it.
- Adding a new variant without an MSW test — the next contract change can silently regress the mapping.
- Renaming a BFF schema field "to match upstream" — the rpx convention belongs on the wire side only; bridge in the mapper.
