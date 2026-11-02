# Repo-wide Patterns

Patterns that hold across more than one knowledge area. An area doc references a pattern here
instead of restating it. Each entry names the pattern, the classes that implement it, and the rule
a contributor must follow to extend it.

## Translation selector callbacks

**Shape:** `t($ => $.domain.key)` or `dynamicSelector('domain.key')` — never a bare string key.
**Where:** every React component and client-side error path in `apps/pxc-retail` and `apps/tenant-management`.
**To add one:** (1) Add the key to all four locale files under `apps/<app>/src/locales/{en,es,fr,de}/translation.ts`. (2) Use a selector callback in the component: `t($ => $.domain.key)`. For a closed union mapped to selectors, prefer `Record<Union, TranslationSelector>` over `dynamicSelector`. For a runtime-computed key there is no alternative — use `dynamicSelector('domain.key')`.
**Failure if skipped:** step 1 is required — tsc fails on a selector that references a key not present in the locale type.

## ErrorKey closed union

**Shape:** `ErrorKey` (union of `"domain.reason"` string literals) in `@repo/core-contracts/types/error-key`, mirrored by `errors.${errorKey}` entries in all four locale files.
**Where:** `throwError({ errorKey })` in `@syndigo/orpc`; `getErrorToast` in `@syndigo/app-shell`; locale files in each app.
**To add one:** (1) Add the string literal to the `ErrorKey` union in `packages/core-contracts/src/types/error-key.ts`. (2) Add `errors.<key>` to each of the four locale files for every app that surfaces it. Step 2 is required — tsc fails if the locale type is missing the key.
**Failure if skipped:** step 2 missing → tsc fails. Step 1 missing → `throwError` call won't type-check.

## Contract-first oRPC

**Shape:** `oc.<domain>.<procedure>.input(...).output(...)` in `@repo/core-contracts`; `implement(contract).<domain>.<procedure>(handler)` in `@syndigo/orpc`.
**Where:** `packages/core-contracts/src/<domain>/` (contracts); `packages/orpc/src/procedures/<domain>/` (implementations); `packages/orpc/src/router.ts` (assembly).
**To add one:** (1) Define input/output Zod schemas in `@repo/core-contracts/src/schemas/`. (2) Add the procedure to the contract tree in `@repo/core-contracts/src/<domain>/<domain>.ts` using the `oc` builder (not bare `ocBase`) so `standardErrors` are inherited. (3) Implement the handler in `packages/orpc/src/procedures/<domain>/` using the `authed` (or `os`) builder. (4) Wire it into the router in `packages/orpc/src/router.ts`.
**Failure if skipped:** a procedure added to the router without a contract entry will fail the TypeScript build. A contract entry without an implementation produces a router type error.

## Granular subpath exports, no package-root barrel

**Shape:** each package declares granular subpath exports in its `package.json` `exports` field; consumers import from the declared path. There is no package-root catch-all `index.ts`. A subpath may point at a scoped `index.ts` for a cohesive module (e.g. `@syndigo/app-shell/permissions` → `src/permissions/index.ts`).
**Where:** `@syndigo/design-system`, `@syndigo/app-shell`, `@syndigo/orpc`, `@syndigo/telemetry`, `@repo/core-contracts`.
**To add one:** add a new subpath export entry to the package's `package.json` `exports` field pointing at the module file. Do not create a package-root barrel or re-export unrelated modules through one subpath.
**Failure if skipped:** TypeScript will resolve the import but bundlers may include the entire package graph in the browser bundle, defeating the `"sideEffects": false` tree-shaking assertion on `@syndigo/orpc`.

## TanStack Form dirtiness via isDefaultValue

**Shape:** `!form.state.isDefaultValue` for "has unsaved changes"; never `form.state.isDirty`.
**Where:** all form components and unsaved-changes guards in both apps.
**To add one:** wherever you need "form has been touched and not restored", use `!state.isDefaultValue`. Reset the form with `form.reset()` to clear dirtiness.
**Failure if skipped:** `isDirty` latches `true` on first change and never returns to `false` without a manual `form.reset()`. Guards that use `isDirty` will block navigation even after the user restores the original values.

## TanStack tables render through DataTable

**Shape:** `useTable({ features, ... })` in the app owns state; `<DataTable table={table} />` from `@syndigo/design-system/components/data-table` owns the markup. Satellites: `data-table-pagination` (plain-prop Previous/Next pager, client- or server-side), `data-table-view-options` (column-visibility menu), `data-table-column-header` (sortable header). All labels/empty states are passed in already translated — the design system has no i18n.
**Where:** VendorTable (pxc-retail); the feature, entitlement and onboarding tables (tenant-management). Plain `components/table` stays for static tables that need no TanStack state (previews, dialogs, skeletons).
**To add one:** define columns + `useTable`, render `<DataTable>`. Extend through `emptyState`, `onRowClick`, `getRowProps`/`getHeaderProps`, `renderSubRow` (expanded content) or `className` — don't hand-roll a `flexRender` loop.
**Failure if skipped:** a hand-rolled loop iterating `row.getAllCells()` misaligns cells against headers once `columnVisibilityFeature` hides a column; `DataTable` iterates visible leaf headers instead.

## Server-only dependencies load lazily inside the handler

**Shape:** `const { default: lib } = await import('lib')` inside an async function body in `packages/orpc`; never a top-level `import` of a Node-only or heavy library.
**Where:** `packages/orpc/src/utils/activity-export/writers.ts` (`toXlsx` → `write-excel-file/node`, `toPdf` → `pdfkit`), reached from `exportVendorHistory` via `await import('../../utils/activity-export/writers')`.
**To add one:** (1) Add the dependency to `packages/orpc/package.json` only, never to an app. (2) Import it with `await import(...)` inside the function that uses it. (3) After `pnpm build --filter=<app>`, grep `apps/<app>/.output/public/` for the library name; it must not appear.
**Failure if skipped:** each app's `src/integrations/orpc/client.ts` statically imports `@syndigo/orpc/router`, and the server graph only drops out of the browser bundle because `@syndigo/orpc` is `"sideEffects": false`. A top-level import of a library with import-time effects, or one Rollup cannot prove droppable, ships it to the browser.

## Stubbed response fields behind `context.stubsEnabled`

**Shape:** when the UI needs fields the upstream API does not expose yet, the procedure merges a deterministic stub over the mapped response, gated on `context.stubsEnabled` (ADR RPC-43 D8). The stub lives in a `*.mock.ts` sibling, is lazy-imported inside the handler, and keys off a stable id so the same input always yields the same output (safe for test assertions).
**Where:** `packages/orpc/src/procedures/vendor-central/tenant-vendors.ts` (`listTenantVendors` merges `mockVendorCardFields(v.id)` from `tenant-vendor-card-fields.mock.ts` — tile-card `category`/`displayId`/`location`/`capabilities`/`onTimeDeliveryRate`/`onTimeDeliveryTrend`/`orderVolume`); precedent `mockVendorPerformanceKpis`. Schema fields are declared `.nullish()`/`.optional()` on the response schema so the non-stub path stays valid.
**To add one:** (1) Add the field(s) to the response Zod schema as `.nullish()`/`.optional()`. (2) Put the deterministic generator in a `*.mock.ts` sibling. (3) In the handler, `if (context.stubsEnabled) { const { fn } = await import('./x.mock'); ... }` and spread the stub over the mapped row. (4) File a Jira ticket to build the real upstream field and delete the stub (here RPC-148) — every mock gets a ticket.
**Failure if skipped:** without `.nullish()`/`.optional()` the non-stub response fails output validation; without the `stubsEnabled` gate, fabricated data leaks into environments pointed at the real API.

## Last verified

2026-10-21 | commit `64707a7` | branch `feature/RPC-121-vendor-tile-card`
