---
name: add-permission-check
description: Add or audit a permission check at the correct layer (oRPC procedure, route guard, or component UI). Covers Module/Action types, requirePermission, requireModuleAccess, useHasPermission/useHasModuleAccess, and the action hierarchy.
---

# Add Permission Check

Pxc-retail has three permission enforcement layers. Use this skill when adding or auditing a check — picking the wrong layer leaks data or duplicates work.

## The model

Permissions are `<module>:<action>` strings — `Permission = ${Module}:${Action}`.

- **Modules** (12, in `@repo/core-contracts/schemas/permission-schema`): `dashboard`, `assortment`, `product-catalog`, `ratings-reviews`, `promotions`, `vendor-management`, `product-intake`, `commerce-loyalty`, `supply-and-orders`, `performance-insights`, `system-admin`, `tenant-management`.
- **Actions** (4): `read`, `write`, `delete`, `admin`.
- **Hierarchy** (`ACTION_HIERARCHY`): `admin` implies `read`/`write`/`delete`; `write` implies `read`; `delete` implies `read`/`write`. A user with `admin` automatically has `read` — no need to check `read` separately when granting `admin`.

The session loader in `_shell.tsx` resolves the raw role permissions through the hierarchy and stores the expanded set in `context.resolvedPermissions`. The `PermissionsProvider` makes the same set available to components via hooks. **Never re-resolve the hierarchy at the check site** — always look up the specific `module:action` you need.

## Three layers, three primitives

| Layer | Where | Primitive | What it does on failure |
|---|---|---|---|
| **BFF** (server) | `@syndigo/orpc` procedure | `.use(requirePermission(module, action))` | Throws `FORBIDDEN` `ORPCError` with `errorKey: 'auth.permission_denied'` |
| **Route** | `beforeLoad` in `_shell/*` | `requireModuleAccess(context.resolvedPermissions, module, action?)` | Redirects to `/no-access` |
| **Component UI** | Inside the React tree | `useHasPermission(module, action?)` / `useHasModuleAccess(module)` | Returns `boolean` — you decide whether to render |

**Always check at the BFF layer.** The other two are UX layers — they hide pages and buttons but a determined client can still issue the RPC. The server is the only authority.

## Layer 1 — BFF procedure (mandatory for any data-touching endpoint)

In `packages/orpc/src/procedures/<domain>/<service>.ts`:

```ts
import { authed } from '../../builder'
import { requirePermission } from '../../middleware/auth'

export const listWidgets = authed.widgetCentral.widget.list
  .use(requirePermission('vendor-management', 'read'))
  .handler(async ({ input, context, signal }) => { /* ... */ })
```

Rules:

- Chain `.use(requirePermission(...))` immediately after `authed.<domain>.<service>.<action>`, before `.handler(...)`.
- Pick the **least permissive** action that's still correct: `read` for queries, `write` for mutations, `delete` for destructive actions, `admin` for cross-tenant/feature-flag operations.
- The middleware throws via `throwError({ code: 'FORBIDDEN', errorKey: 'auth.permission_denied', params: { permission } })` — no custom error handling needed.
- Public procedures (session, health) use `os.` not `authed.` and skip the permission check entirely.

## Layer 2 — Route guard (mandatory for any authed page)

In `src/routes/_shell/<domain>/<feature>.tsx`:

```ts
import { requireModuleAccess } from '#/lib/permissions/require-module-access'

export const Route = createFileRoute('/_shell/<domain>/<feature>')({
  beforeLoad: ({ context }) => {
    requireModuleAccess(context.resolvedPermissions, '<module>')
    // requireModuleAccess(ctx.resolvedPermissions, 'system-admin', 'admin')
  },
  component: FeaturePage,
})
```

Rules:

- Defaults to `'read'` action — only pass an explicit action when the entire page is restricted to that action level (e.g. `'admin'` for system-admin children).
- If a pathless parent layout (`_shell/<domain>.tsx`) already enforces the guard, child routes **don't** need to repeat it.
- Throws a `redirect({ to: '/no-access' })` — never reaches the component, never fetches data, never flashes content.
- Read permissions from `context.resolvedPermissions` only. Hooks aren't available in `beforeLoad`.

For fine-grained per-page action checks (e.g. a read-only page that gates a destructive button), keep the route at `'read'` and use Layer 3 for the button.

## Layer 3 — Component UI (UX polish, not security)

Inside any component under `_shell/`:

```tsx
import {
  useHasPermission,
  useHasModuleAccess,
} from '#/lib/permissions'

function VendorActions() {
  const canEdit = useHasPermission('vendor-management', 'write')
  const canDelete = useHasPermission('vendor-management', 'delete')

  return (
    <>
      {canEdit && <EditButton />}
      {canDelete && <DeleteButton />}
    </>
  )
}
```

Rules:

- `useHasPermission(module, action = 'read')` — specific action.
- `useHasModuleAccess(module)` — any access. Equivalent to `useHasPermission(module, 'read')` under the current hierarchy, but the intent is "module is visible to me" — use it for nav and module-level toggles.
- For **navigation rendering**, use the dedicated `useFilteredMenuGroups()` / `useFilteredSubTabs(moduleKey)` helpers — they already filter by module access and read from `navigation-config.ts`. Don't reimplement the filter logic.
- These hooks must be used under `PermissionsProvider`, which is mounted in `_shell.tsx` — so any component rendered under `_shell/` works. Outside (`/no-access`, `__root.tsx` providers themselves) they will throw.

## Picking the right layer

| Use case | Layer(s) |
|---|---|
| List endpoint | **BFF** `read` (always) |
| Mutation endpoint | **BFF** `write` or `delete` |
| Whole page restricted | **BFF** + **Route** guard |
| Whole module restricted | **Route** guard on parent layout + **BFF** for each procedure |
| Hide a button or section | **Component** hook (BFF still enforces) |
| Hide a nav entry | `useFilteredMenuGroups` (auto from `navigation-config.ts`) |
| Sub-tabs inside a module | `useFilteredSubTabs` |

## Adding a new module

If the permission you need doesn't fit any existing module, you're adding a module — bigger change:

1. Add the literal to `ALL_MODULES` in `packages/core-contracts/src/schemas/permission-schema.ts`.
2. Update `role-definitions.ts` so the appropriate roles get the new permission.
3. Add a nav entry to `apps/pxc-retail/src/lib/navigation-config.ts` with `moduleKey: '<new-module>'` (if it has a UI).
4. Run `pnpm test --filter=@repo/core-contracts` — the role test snapshot will need updating.

Don't add modules casually. The default is: reuse an existing module + a more specific action, not create a new module.

## Checklist

- [ ] BFF procedure has `.use(requirePermission(module, action))` chained on `authed.`
- [ ] Route file under `_shell/` has `requireModuleAccess(context.resolvedPermissions, module, action?)` in `beforeLoad` (unless parent layout already does)
- [ ] Component-level checks use `useHasPermission` / `useHasModuleAccess` — never read `context.resolvedPermissions` directly from a component
- [ ] Nav entries reference a `Module` value via `moduleKey` (auto-filter)
- [ ] Action chosen is the **least permissive** that's still correct
- [ ] `pnpm typecheck` passes (`Module` and `Action` are closed unions — typos fail at compile time)

## Common mistakes

- **Relying on Layer 2 or 3 alone** — the client can call the RPC directly. Layer 1 must always be present.
- **Checking `admin` when `write` would do** — overly restrictive permissions surface as inexplicable 403s for legitimate users.
- **Re-resolving the hierarchy at the call site** — `context.resolvedPermissions` is already expanded. Just check `permissions.has('module:action')` (or use the helpers).
- **Reading `context.resolvedPermissions` from a component** — use the hooks. Direct reads bypass `PermissionsProvider`'s memoization and may pull stale values during rerenders.
- **Duplicating `requireModuleAccess` on a child of a layout that already enforces it** — harmless but noisy.
- **Hard-coding a permission string literal** — pass `module` and `action` separately so the closed unions enforce validity. `requirePermission('vendor-managment', 'read')` (typo) won't compile; `'vendor-managment:read'` would.
- **Building a custom nav filter** — `useFilteredMenuGroups` / `useFilteredSubTabs` already handle this and read from `navigation-config.ts`.
