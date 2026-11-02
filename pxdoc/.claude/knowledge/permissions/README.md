# Permissions — Knowledge Base

**Modules owned:** `packages/app-shell/src/permissions/`, `packages/core-contracts/src/permissions/`, `apps/*/src/lib/permissions/`, `apps/*/src/lib/navigation-config.ts`
**Entry points:** `requireModuleAccess` (route guard), `createPermissionsContext` (React surface), `filterMenuGroups` (nav filter)
**Last verified:** 2026-09-30 | commit `1cb0369` | branch `dev/jmarquardt/kb-bootstrap-2`

Vocabulary-agnostic RBAC engine in `@syndigo/app-shell`. Each app instantiates it with its own `Module`/`Action` type unions — pxc-retail imports them from `@repo/core-contracts`; tenant-management defines a local `tenant-onboarding`-only vocabulary in `apps/tenant-management/src/lib/permissions/vocabulary.ts` and narrows the session's permissions to it — getting compile-time-safe hooks and guards while the underlying logic stays string-based. Permissions are `"module:action"` strings; `admin` implies `[read, write, delete]`, `delete` implies `[read, write]`, `write` implies `[read]`.

## Files

| Doc | Covers |
|---|---|
| `README.md` | scope, architecture, flow, reusable surface, related KB |
| `contracts.md` | `ACTION_HIERARCHY`, `RoleDefinition`, `PermissionsApi` signatures, sample resolved sets |

## Scope

**In scope:** permission resolution, action-hierarchy expansion, React context/hooks, navigation filtering, route guards, landing-route resolution.
**Out of scope:** authentication (→ `rpc-layer` `authMiddleware`), role definitions stored on the server (→ `rpc-layer` permissions procedures), error codes for unauthorized access (→ `error-handling`).

## Architecture

| Layer | Module | Export | Responsibility |
|---|---|---|---|
| Logic | `@syndigo/app-shell/permissions/logic` | `resolvePermissions`, `resolveRolePermissions`, `hasPermission`, `hasModuleAccess` | Pure string-based RBAC math; no React dependency |
| Context factory | `@syndigo/app-shell/permissions/context` | `createPermissionsContext<M, A>()` | Creates typed React context + hooks bound to app vocabulary |
| Navigation filter | `@syndigo/app-shell/permissions/navigation-filter` | `filterMenuGroups`, `resolveLandingRoute` | Pure filters over `MenuGroup[]` arrays |
| Route guard | `@syndigo/app-shell/permissions/require-module-access` | `requireModuleAccess` | Throws `redirect` in TanStack Router `beforeLoad` |
| App instantiation | `apps/*/src/lib/permissions/index.ts` | `PermissionsProvider`, `useHasPermission`, `useFilteredMenuGroups`, etc. | Binds generic engine to app's `Module`/`Action` unions; injects nav config into filter helpers |

## Flow

| Hop | Condition | Envelope | Mutates |
|---|---|---|---|
| `authMiddleware` resolves roles | authed RPC call | role strings from session | no |
| `resolveRolePermissions(roles, roleDefinitions)` | always | expands role → permission strings | no |
| `resolvePermissions(permissions, ACTION_HIERARCHY)` | always | expands each `module:action` by hierarchy | no |
| `PermissionsProvider` receives `resolved` set | React tree mount | `ReadonlySet<string>` stored in context | no |
| Route `beforeLoad` calls `requireModuleAccess(permissions, module, action)` | route navigation | checks `permissions.has('module:action')` | no |
| `requireModuleAccess` throws `redirect` | permission absent | `redirect({ to: '/no-access' })` | no |
| `filterMenuGroups(menuGroups, resolved)` | nav render | drops groups/items where `hasModuleAccess` is false | no |
| `resolveLandingRoute(menuGroups, resolved)` | root redirect | first `href` where `hasModuleAccess` is true | no |

## Design Patterns

**Generic context factory** — `createPermissionsContext<M, A>()` produces a closed `PermissionsApi<M, A>` whose hooks are typed to the app's `Module`/`Action` unions. Each app calls it once in `apps/*/src/lib/permissions/index.ts` and re-exports the typed surface. Add a new app by calling the factory with that app's union types — the logic is not duplicated.

**String-based core with typed shell** — the logic functions (`hasPermission`, `hasModuleAccess`, `resolvePermissions`) operate on plain strings so any app vocabulary works. The type safety is added at the instantiation boundary in `apps/*/src/lib/permissions/index.ts` via TypeScript generics, not inside the logic.

**Action hierarchy implied permissions** — granting `module:admin` automatically implies `module:read`, `module:write`, `module:delete`. Granting `module:delete` implies `module:read`, `module:write`. Granting `module:write` implies `module:read`. `hasModuleAccess` checks `module:read`, so it is true for any granted action.

## Reusable Components

| Export | From | Use |
|---|---|---|
| `requireModuleAccess` | `apps/*/src/lib/permissions/index.ts` | Call in TanStack Router `beforeLoad` with the route context's permission set |
| `useHasPermission(module, action)` | same | React hook; returns `boolean`; re-renders on permission change |
| `useHasModuleAccess(module)` | same | Shorthand for `useHasPermission(module, 'read')` |
| `useFilteredMenuGroups()` | same | Returns nav groups visible to the current user |
| `useFilteredSubTabs(moduleKey)` | same | Returns sub-tabs for a module, or `undefined` if inaccessible |
| `filterMenuGroups(resolved)` | same | Pure filter for the Roles & Permissions live preview |
| `resolveLandingRoute(resolved)` | same | First accessible route in the app's nav config |

## Related KB

- `rpc-layer` — `authMiddleware` is where roles are fetched and `resolveRolePermissions` is called; the resulting `ReadonlySet` is what `PermissionsProvider` receives
- `error-handling` — `UNAUTHORIZED` and `FORBIDDEN` `ORPCError` codes are surfaced when `authMiddleware` fails; `requireModuleAccess` redirects rather than throwing an error code

## Last verified

2026-09-30 | commit `1cb0369` | branch `dev/jmarquardt/kb-bootstrap-2`
