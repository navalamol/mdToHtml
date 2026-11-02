---
name: ux-reference-implementation
description: Implement features using a UX reference (Lovable submodule or screenshot), applying pxc-retail patterns and real API integration.
---

# UX Reference Implementation

Use a UX reference — either the Lovable submodule or a screenshot from an AI-generated mock app — along with an associated Jira ticket to implement features in pxc-retail with real APIs.

## Dev Servers

- **PXC Retail**: `http://localhost:3000` (apps/pxc-retail)
- **Lovable** (submodule only): `http://localhost:8080` (submodules/loveable)

## Accessing Lovable (Playwright — submodule only)

Use playwright-cli to view Lovable pages. Always start by opening browser and bypassing auth:

```bash
# Open browser at Lovable
npx --no-install playwright-cli open http://localhost:8080

# Bypass auth with localStorage
npx --no-install playwright-cli localstorage-set "auth-storage" '{"state":{"isAuthenticated":true,"username":"retailpxcadmin","displayName":"Retail PX Admin","initials":"RA","role":"business-admin"},"version":0}'

# Reload to apply auth
npx --no-install playwright-cli reload
```

## Workflow

### 1. Analyze Inputs

**Jira ticket** (always): Read the ticket for requirements, acceptance criteria, data/API expectations, and edge cases. This is the source of truth for what to build — the UX reference shows how it should look.

**If Lovable submodule**: Use Playwright to open `localhost:8080`, bypass auth, and navigate to the relevant page. Review for layout, components, interactions, visual states, and data shape.

**If screenshot**: Analyze the provided image for layout, component types, interactions, visible data shapes, and state variations (empty, loading, error, populated).

Reconcile any gaps or conflicts between the Jira ticket and the UX reference before proceeding — ask the user if intent is unclear.

### 2. Map Components

Map reference shadcn components to `@syndigo/design-system` (base-nova preset). Import individually: `@syndigo/design-system/components/<name>`.

**If component missing**: Ask user (add to design system, use alternative, build custom).

### 3. Wire API Data

**If API approach unclear**: Ask user (API-first or contract-first).

Create schemas and procedures. Transform rpx-prefixed fields (`rpxname`) to clean types (`name`).

**If property mismatch**: Ask user (add to mapper, remove from UI, use different field, make optional).

### 4. Implement UI

Use `useSuspenseQuery(orpc.<domain>.<service>.<action>.queryOptions())` for data, TanStack Form for forms, `useTranslation()` for text. Wrap in Suspense. Add route guards: `beforeLoad: requireModuleAccess()`.

Transfer the reference's layout/interactions. Apply path aliases (`#/*`), translations (en, es, fr, de), individual imports.

### 5. Test & Verify

Write Vitest tests for components and procedures. All must pass:

```bash
pnpm test --filter=pxc-retail
pnpm typecheck
pnpm build --filter=pxc-retail
```

## Rules

- UX reference is reference only (data is mocked)
- Ask when: API approach unclear, component missing, property mismatch
- Transform rpx-prefixed API responses
- Translations in all languages (en, es, fr, de)
- TanStack Form (not React Hook Form)
- Individual imports (no barrels)
- Tests required
- Verification must pass
