# Permissions — Contracts & Samples

**Last verified:** 2026-09-30 | commit `1cb0369` | branch `dev/jmarquardt/kb-bootstrap-2`

## Contracts & Signatures

### `resolvePermissions` — expand permission strings by hierarchy

```ts
// packages/app-shell/src/permissions/logic.ts
function resolvePermissions(
  permissions: readonly string[],
  hierarchy?: Readonly<Record<string, readonly string[]>>,
): Set<string>
```

Default hierarchy: `admin → [read, write, delete]`, `delete → [read, write]`, `write → [read]`, `read → []`.

### `resolveRolePermissions` — aggregate roles then expand

```ts
function resolveRolePermissions(
  roles: readonly string[],
  roleDefinitions: Readonly<Record<string, RoleDefinition>>,
  hierarchy?: Readonly<Record<string, readonly string[]>>,
): Set<string>

interface RoleDefinition {
  label: string
  description: string
  permissions: string[]  // e.g. ["vendors:read", "reports:admin"]
}
```

### `requireModuleAccess` — route guard (throws redirect)

```ts
// packages/app-shell/src/permissions/require-module-access.ts
// (type-narrowed wrapper in apps/*/src/lib/permissions/index.ts)
function requireModuleAccess(
  permissions: ReadonlySet<Permission> | undefined,
  module: Module,
  action?: Action,       // default: 'read'
  redirectTo?: string,   // default: '/no-access'
): void
```

Throws `redirect({ to: redirectTo })` when `permissions` is undefined or lacks `module:action`.

### `createPermissionsContext` — typed React context factory

```ts
// packages/app-shell/src/permissions/context.tsx
function createPermissionsContext<M extends string, A extends string>(): PermissionsApi<M, A>

interface PermissionsApi<M, A> {
  PermissionsProvider: (props: { resolved: ReadonlySet<string>; children: ReactNode }) => ReactNode
  useResolvedPermissions: () => ReadonlySet<string>
  useHasPermission: (module: M, action?: A) => boolean
  useHasModuleAccess: (module: M) => boolean
}
```

Called once per app in `apps/*/src/lib/permissions/index.ts`.

### Sample: resolved permission set from `vendors:admin` role

UNVERIFIED: Role definitions and permission assignments are currently mocked — the real server API that returns user roles does not exist yet. The shapes below reflect the engine's `RoleDefinition` interface and are illustrative; update this sample once the real permissions API lands.

Input role definition:

```json
{
  "vendors-admin": {
    "label": "Vendors Admin",
    "description": "Full access to vendor management",
    "permissions": ["vendors:admin", "reports:read"]
  }
}
```

After `resolveRolePermissions(["vendors-admin"], roleDefinitions)`:

```json
["vendors:admin", "vendors:read", "vendors:write", "vendors:delete", "reports:read"]
```

## Config / Forks

| Setting / Flag | Lookup | Values | Behavior |
|---|---|---|---|
| `hierarchy` argument | `resolvePermissions(permissions, hierarchy)` | omitted / custom `Record<string, string[]>` | Omitted → uses `ACTION_HIERARCHY` (standard 4-tier expand). Custom → app can define non-standard action sets with their own implied actions. |
| `action` argument | `requireModuleAccess(permissions, module, action)` | omitted (`'read'`) / explicit action string | Determines the exact `module:action` permission string checked against the set. |
| `redirectTo` argument | `requireModuleAccess(..., redirectTo)` | omitted (`'/no-access'`) / any route path | Controls the redirect destination when the guard fires. |
| `moduleKey` presence on `MenuGroup` | `filterMenuGroups` checks `group.moduleKey` | defined / undefined | Undefined → group is always visible (no permission guard). Defined → hidden when `hasModuleAccess(resolved, moduleKey)` is false. |
