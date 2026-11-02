---
name: add-route
description: Scaffold a new TanStack Router route in pxc-retail with shell layout, permissions guard, oRPC loader pattern, i18n, and navigation registration. Thin overlay — defers to TanStack skills for framework mechanics.
---

# Add Route

Pxc-retail-specific conventions for adding a new file-based route. For TanStack Router mechanics (file naming, `beforeLoad`, search-param validation, loaders, layouts, code splitting), load the relevant `router-core` sub-skill from intent — this skill only encodes the project-specific glue.

## Framework knowledge — defer to these

Load via `pnpm dlx @tanstack/intent@latest load <ref>` before writing route code, when the topic applies:

- `@tanstack/router-core#router-core` — file naming, `createFileRoute`, route tree generation
- `@tanstack/router-core#router-core/auth-and-guards` — `beforeLoad`, `redirect`, layout routes
- `@tanstack/router-core#router-core/data-loading` — loaders, `loaderDeps`, staleTime
- `@tanstack/router-core#router-core/search-params` — `validateSearch` with Zod
- `@tanstack/router-core#router-core/path-params` — dynamic segments
- `@tanstack/router-core#router-core/not-found-and-errors` — `errorComponent`, `notFoundComponent`

## Required inputs (ask if not provided)

1. **Path** — file path under `src/routes/_shell/<domain>/<feature>.tsx`. The `_shell` layout is mandatory for any user-facing page (auth, nav, providers).
2. **Module** — `Module` value from `@repo/core-contracts/schemas/permission-schema` (e.g. `vendor-management`). Determines the permission guard.
3. **Action** — minimum permission action (`'read'` by default; `'admin'` for system-admin areas).
4. **Data needs** — does the route load data via oRPC? If yes, which procedure?
5. **Navigation** — should it appear in the top nav (`menuGroups`) or only as a sub-tab (`moduleSubTabs`)?

## File layout (mandatory)

```
src/routes/
├── __root.tsx                  # global providers + RouteErrorComponent
├── _shell.tsx                  # auth/session loading + ShellLayout — wraps all authed pages
├── _shell/
│   ├── <domain>.tsx            # OPTIONAL parent: pathless module guard if multiple sub-routes
│   ├── <domain>/
│   │   └── <feature>.tsx       # the page itself
├── no-access.tsx               # redirect target for permission failures
```

`__root.tsx` already wires `errorComponent: RouteErrorComponent` and `notFoundComponent: NotFoundPage` — don't redeclare them at the root level. Per-route `errorComponent` overrides are fine (the vendors page does this).

## Project-specific conventions

### Permission guard — every authed route

```ts
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireModuleAccess } from '#/lib/permissions/require-module-access'

export const Route = createFileRoute('/_shell/<domain>/<feature>')({
  beforeLoad: ({ context }) => {
    requireModuleAccess(context.resolvedPermissions, '<module>')
    // For admin-only modules: requireModuleAccess(ctx.permissions, '<module>', 'admin')
  },
  component: <FeaturePage>,
})
```

`requireModuleAccess` throws a redirect to `/no-access` when the permission is missing. Read it from `context.resolvedPermissions` — it's populated by `_shell.tsx`'s `beforeLoad` via `sessionQueryOptions()` and merged into route context. Never access permissions any other way inside `beforeLoad`.

### Layout route for multi-page modules

If the module has multiple pages, create a pathless parent that asserts the guard once:

```ts
// src/routes/_shell/system-admin.tsx
export const Route = createFileRoute('/_shell/system-admin')({
  beforeLoad: ({ context }) => {
    requireModuleAccess(context.resolvedPermissions, 'system-admin', 'admin')
  },
  component: () => <Outlet />,
})
```

Children at `src/routes/_shell/system-admin/<page>.tsx` then **don't** repeat the guard — TanStack runs the parent's `beforeLoad` first.

### Data loading with oRPC

The project uses `useSuspenseQuery` / `useSuspenseInfiniteQuery` inside the component, NOT route-level `loader`s. The component is wrapped in `<Suspense>` with a skeleton fallback. See `_shell/vendor-central/vendor-management/vendors.tsx` for the canonical pattern.

```tsx
import { Suspense } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { orpc } from '#/integrations/orpc/client'

function FeatureContent() {
  const { data } = useSuspenseQuery(
    orpc.<domain>.<service>.<action>.queryOptions({ input: {} }),
  )
  return <Layout>{/* render data */}</Layout>
}

function FeaturePage() {
  return (
    <Suspense fallback={<FeatureSkeleton />}>
      <FeatureContent />
    </Suspense>
  )
}
```

For paginated/infinite lists use `infiniteOptions`, not `queryOptions`. Per-route `errorComponent: RouteErrorComponent` is appropriate for pages that load data — the root error component is fine but per-page registration keeps the trace ID surface localized.

### Search params

Use Zod with `.catch(...)` defaults so invalid query strings don't throw. Pattern from `vendors.tsx`:

```ts
const searchSchema = SomeSchema.extend({
  view: z.enum(['grid', 'table']).catch('grid'),
})

export const Route = createFileRoute('/_shell/<domain>/<feature>')({
  validateSearch: (search) => searchSchema.parse(search),
  // ...
})
```

`navigate({ search: (p) => ({ ...p, key: value }) })` for updates — always preserve existing params.

### i18n — every user-facing string

```tsx
import { useTranslation } from '#/hooks/use-translation'

const { t } = useTranslation()
<h1>{t($ => $.pages.<feature>.title)}</h1>
```

Use selector callbacks (`t($ => $.path.to.key)`) — i18next's `enableSelector: 'optimize'` mode is configured and gives compile-time checking. For runtime-computed keys, use `dynamicSelector('foo.bar')` from `#/integrations/i18n/config`.

Add the key to all four locales (`en/es/fr/de/translation.ts`) — same rule as `error-key` skill. Page titles convention is `pages.<feature>.title` / `pages.<feature>.description`. Never hard-code English.

### Path aliases

Use `#/*` (preferred) for app-internal imports. `@/*` is an alias for the same root and works, but prefer `#/*` for new code. Cross-package imports use the explicit names: `@syndigo/design-system/components/<name>`, `@repo/core-contracts/...`, `@syndigo/orpc/...`.

### Navigation registration

Update `src/lib/navigation-config.ts` if the new route should appear in nav:

- **Top-level menu item or dropdown**: add to `menuGroups`. Use a `Module` value for `moduleKey` so the nav auto-filters via `useFilteredMenuGroups()`.
- **Sub-tab within a module**: add to `moduleSubTabs[<module>]`. Auto-filters via `useFilteredSubTabs(moduleKey)`.

`labelKey` MUST be a valid `TranslationSelector` selector (`$ => $.foo.bar`) — add the locale string first or TS fails.

### After adding routes

```bash
pnpm dev --filter=pxc-retail   # regenerates src/routeTree.gen.ts
```

`routeTree.gen.ts` is generated — never hand-edit it. The router plugin watches `src/routes/` and rewrites it. If you can't run dev, the build step also regenerates.

## Canonical template

```tsx
import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { requireModuleAccess } from '#/lib/permissions/require-module-access'
import { RouteErrorComponent } from '#/components/RouteErrorComponent'
import { useTranslation } from '#/hooks/use-translation'
import { orpc } from '#/integrations/orpc/client'

export const Route = createFileRoute('/_shell/<domain>/<feature>')({
  beforeLoad: ({ context }) => {
    requireModuleAccess(context.resolvedPermissions, '<module>')
  },
  component: FeaturePage,
  errorComponent: RouteErrorComponent,
})

function FeatureContent() {
  const { t } = useTranslation()
  const { data } = useSuspenseQuery(
    orpc.<domain>.<service>.<action>.queryOptions({ input: {} }),
  )
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t($ => $.pages.<feature>.title)}</h1>
      {/* render data */}
    </div>
  )
}

function FeaturePage() {
  return (
    <Suspense fallback={<FeatureSkeleton />}>
      <FeatureContent />
    </Suspense>
  )
}
```

The skeleton is a feature-specific component you write alongside the page (mirror `VendorContentSkeleton` in `vendors.tsx`) — render the page's chrome with placeholder bars so layout doesn't shift when data arrives.

## Verify

```bash
pnpm typecheck
pnpm test --filter=pxc-retail
# Manual: open http://localhost:3000/<path> with a session that has + lacks the permission
```

## Checklist

- [ ] Route file under `src/routes/_shell/<domain>/<feature>.tsx`
- [ ] `beforeLoad` calls `requireModuleAccess(context.resolvedPermissions, ...)` (unless a parent layout already does)
- [ ] Data loaded via `orpc.X.queryOptions(...)` + `useSuspenseQuery` inside `<Suspense>`
- [ ] All user-facing strings use `useTranslation()`; locale keys added to en/es/fr/de
- [ ] Path aliases used (`#/...`, `@syndigo/...`, `@repo/...`)
- [ ] `navigation-config.ts` updated if the route belongs in nav (with `moduleKey` for filtering)
- [ ] `pnpm dev` ran at least once to regenerate `routeTree.gen.ts`
- [ ] `pnpm typecheck` passes

## Common mistakes

- Putting an authed page outside `_shell/` — bypasses the session loader and `PermissionsProvider`.
- Reading permissions from a hook in `beforeLoad` — hooks aren't available there. Use `context.resolvedPermissions`.
- Duplicating `requireModuleAccess` in a child when a layout parent already enforces it (harmless but noisy).
- Calling oRPC in a route-level `loader` instead of via `useSuspenseQuery` in the component — the project pattern is suspense + skeleton, not loader-blocking.
- Hand-editing `routeTree.gen.ts` — the generator overwrites it.
- Adding a nav item without a matching `Module` value in `moduleKey` — it won't filter and users will see broken links.
- Hard-coded English strings — fails the no-i18n-text rule from CLAUDE.md.
