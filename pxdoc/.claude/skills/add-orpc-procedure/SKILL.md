---
name: add-orpc-procedure
description: Scaffold a new oRPC procedure end-to-end — Zod schemas in @repo/core-contracts, contract definition, @syndigo/orpc implementation, error keys, locale strings, and router wiring. Use when adding any new server endpoint.
---

# Add oRPC Procedure

Contract-first vertical slice for a new BFF endpoint. The procedure spans three packages — missing any step breaks the build.

## When to use

- Adding a new endpoint (any HTTP verb).
- Adding a new domain or service group.
- Adding a new action to an existing service (e.g. `vendorCentral.tenantVendor.archive`).

## Required inputs (ask if not provided)

1. **Domain** — top-level router key. Existing: `users`, `permissions`, `vendorCentral`, `attributeManager`. New domains require a new contract group.
2. **Service** — second-level key (e.g. `tenantVendor`). Existing services live in `packages/core-contracts/src/<domain>/contracts/`.
3. **Action** — `list` / `find` / `findDetails` / `create` / `update` / `delete` / custom verb.
4. **Permission** — `<module>:<action>` (e.g. `vendor-management:read`). Public procedures (session, health) skip this.
5. **Upstream call** — the `context.api.GET/POST/PATCH/DELETE` path and any field-name remapping needed.

## Architecture map

```
@repo/core-contracts/src/<domain>/contracts/<service>.ts    # contract (input/output Zod + .route metadata)
@repo/core-contracts/src/<domain>/<domain>.ts               # group barrel — re-exports the contract object
@repo/core-contracts/src/index.ts                           # top-level `contract` map — domain wired here
@repo/core-contracts/src/schemas/<service>-schema.ts        # Zod input/output schemas
@repo/core-contracts/src/types/<service>-types.ts           # OPTIONAL — inferred types when reused

@syndigo/orpc/src/procedures/<domain>/<service>.ts          # handler(s) — one export per action
@syndigo/orpc/src/router.ts                                 # router wires named handler exports

apps/pxc-retail — no app-side changes needed for the procedure itself; the
isomorphic client picks new procedures up automatically through the router type.
```

## Step-by-step

### 1. Schemas (`packages/core-contracts/src/schemas/<service>-schema.ts`)

Define Zod schemas for the wire shape. Conventions:

- `<Entity>Schema` — full row.
- `<Entity>CreateSchema` — typically `.omit({ id: true, createdAt: true, updatedAt: true })` from the full schema.
- `<Entity>DetailSchema` — `.extend(...)` adding optional sub-entity arrays.
- Use Zod v4 syntax: `z.iso.datetime()`, `z.email()`, `z.url()`, `z.record(z.string(), ...)`.

```ts
import { z } from 'zod'

export const WidgetSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
})

export const WidgetCreateSchema = WidgetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
```

### 2. Contract (`packages/core-contracts/src/<domain>/contracts/<service>.ts`)

Import `oc` from `../../schemas/standard-errors` (NOT from `@orpc/contract` — `oc` is pre-applied with the 9 standard error codes). Every action becomes a builder chain.

```ts
import { z } from 'zod'
import { oc } from '../../schemas/standard-errors'
import { WidgetSchema, WidgetCreateSchema } from '../../schemas/widget-schema'

export const widgetContract = {
  list: oc
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .output(
      z.object({
        items: z.array(WidgetSchema),
        nextCursor: z.string().optional(),
      }),
    )
    .route({
      summary: 'List Widgets',
      description: 'Paginated widget list.',
      tags: ['Widget'],
    }),

  find: oc
    .input(z.object({ id: z.string() }))
    .output(WidgetSchema)
    .route({
      summary: 'Get Widget',
      description: 'Retrieve a single widget by ID.',
      tags: ['Widget'],
    }),

  create: oc
    .input(WidgetCreateSchema)
    .output(WidgetSchema)
    .route({
      summary: 'Create Widget',
      description: 'Create a new widget.',
      tags: ['Widget'],
    }),

  update: oc
    .input(
      WidgetSchema.omit({ createdAt: true, updatedAt: true })
        .partial()
        .required({ id: true }),
    )
    .output(WidgetSchema)
    .route({ summary: 'Update Widget', description: '...', tags: ['Widget'] }),

  delete: oc
    .input(z.object({ id: z.string() }))
    .output(z.object({ id: z.string() }))
    .route({ summary: 'Delete Widget', description: '...', tags: ['Widget'] }),
}
```

### 3. Domain group (`packages/core-contracts/src/<domain>/<domain>.ts`)

For new domains, create a barrel object. For existing domains, add the import + key.

```ts
import { widgetContract } from './contracts/widget'

export const widgetCentralContract = {
  widget: widgetContract,
}
```

### 4. Top-level wiring (`packages/core-contracts/src/index.ts`)

New domains only — append to the `contract` map:

```ts
import { widgetCentralContract } from './widget-central/widget-central'

export const contract = {
  // ...existing
  widgetCentral: widgetCentralContract,
}
```

### 5. Procedure implementation (`packages/orpc/src/procedures/<domain>/<service>.ts`)

Each contract action gets a named export. Use `authed` (NOT `os`) for any procedure that needs the upstream API client or auth — `os` is for public procedures only (session, health).

```ts
import { authed } from '../../builder'
import { unwrap } from '../../upstream-error'
import { throwError } from '../../errors'
import { requirePermission } from '../../middleware/auth'

export const listWidgets = authed.widgetCentral.widget.list
  .use(requirePermission('widget-management', 'read'))
  .handler(async ({ input, context, signal }) => {
    const data = await unwrap(
      context.api.GET('/v1/widgets', {
        signal,
        params: { query: { limit: input.limit } },
      }),
    )

    return {
      items: data.widgets ?? [],
      nextCursor: undefined, // wire pagination per upstream
    }
  })

export const findWidget = authed.widgetCentral.widget.find
  .use(requirePermission('widget-management', 'read'))
  .handler(async ({ input, context, signal }) => {
    const data = await unwrap(
      context.api.GET('/v1/widgets/{widgetId}', {
        signal,
        params: { path: { widgetId: input.id } },
      }),
    )

    if (!data.widget) {
      throwError({
        code: 'NOT_FOUND',
        errorKey: 'widget.not_found',
        params: { id: input.id },
        message: `Widget ${input.id} not found`,
      })
    }

    return data.widget
  })
```

**Mandatory rules:**

- **Always** wrap upstream calls in `unwrap(...)` — it converts HTTP errors into typed `ORPCError`s with `errorKey: 'upstream.*'` and records `upstream.*` span attributes.
- **Always** use `throwError({ code, errorKey, params?, message? })` for BFF-originated errors. Never construct `ORPCError` directly. Never hard-code English message strings the client will render — the client translates from `errorKey`.
- **Always** pass `signal` through to `context.api.*` so client aborts cancel upstream requests.
- Field-name remapping (e.g. upstream `rpxname` → contract `name`) belongs in `utils/<service>-mappers.ts` — keep handlers slim.

### 6. Router (`packages/orpc/src/router.ts`)

Import every named handler and wire it under the matching domain/service/action path. The router shape **must** mirror the contract shape exactly — TypeScript enforces this.

```ts
import {
  listWidgets,
  findWidget,
  createWidget,
  updateWidget,
  deleteWidget,
} from './procedures/widget-central/widgets'

const router = os.router({
  // ...existing
  widgetCentral: {
    widget: {
      list: listWidgets,
      find: findWidget,
      create: createWidget,
      update: updateWidget,
      delete: deleteWidget,
    },
  },
})
```

### 7. Error keys (if introducing any)

Any `errorKey` used in `throwError(...)` that is NOT already in `ErrorKey` requires:

1. Add literal to `@repo/core-contracts/src/types/error-key.ts`.
2. Add `errors.<key>: '<message>'` to **all four** locale files (`en`, `es`, `fr`, `de`).

Skip step 2 → the toast renders `errors.<domain>.<key>` literally at runtime (the path is built via `dynamicSelector()` and not compile-time-checked).

Use the `error-key` skill for this step.

### 8. Test (`packages/orpc/src/__tests__/<service>.test.ts`)

Use `createTestClient()` to exercise the procedure through the router. MSW handlers in `__tests__/msw/handlers.ts` mock the upstream API — extend them for new endpoints.

```ts
import { describe, expect, it } from 'vitest'
import { createTestClient } from './helpers/create-test-client'

const client = createTestClient()

describe('widgetCentral.widget', () => {
  it('lists widgets', async () => {
    const result = await client.widgetCentral.widget.list({})
    expect(result.items).toBeDefined()
  })
})
```

### 9. Verify

```bash
pnpm typecheck
pnpm test --filter=@syndigo/orpc
pnpm build --filter=@repo/core-contracts --filter=@syndigo/orpc
```

If `pnpm dev --filter=pxc-retail` is running, the TanStack Router route tree only regenerates when route files change — procedures don't trigger codegen.

## Client usage (for reference)

```tsx
import { orpc } from '#/integrations/orpc/client'
import { useSuspenseQuery } from '@tanstack/react-query'

const { data } = useSuspenseQuery(
  orpc.widgetCentral.widget.list.queryOptions({ input: {} }),
)
```

## Checklist

- [ ] Schemas in `core-contracts/src/schemas/`
- [ ] Contract file in `core-contracts/src/<domain>/contracts/`
- [ ] Domain group barrel updated (new domain → also `core-contracts/src/index.ts`)
- [ ] Handler file in `orpc/src/procedures/<domain>/`
- [ ] `throwError` used for every BFF error; `unwrap` wraps every `context.api.*` call
- [ ] Permission middleware applied (unless intentionally public)
- [ ] Router wired in `orpc/src/router.ts`
- [ ] Any new error keys added to `error-key.ts` + all 4 locale files
- [ ] Vitest test added; `pnpm typecheck` + `pnpm test --filter=@syndigo/orpc` pass
- [ ] No hard-coded user-facing strings; no `ORPCError` constructed directly

## Common mistakes

- Importing `oc` from `@orpc/contract` instead of `../../schemas/standard-errors` (strips the standard error map).
- Using `os.<domain>...` for an authed procedure — `context.api` won't exist; use `authed`.
- Forgetting `signal` on `context.api.*` calls (breaks request cancellation).
- Adding an `errorKey` literal without locale entries (build fails).
- Mismatched router shape vs. contract shape (TS error is verbose but root cause is path divergence).
