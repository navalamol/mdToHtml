# Improvement Plan

Four sections: architecture improvements, current known issues, gaps for AI-assisted development, and the plan to close them.

---

## 1. Architecture Improvements

Concrete, actionable improvements — not speculative refactors.

### 1.1 Wire Real Auth (Critical)

**Current:** `authMiddleware` in `packages/orpc/src/middleware/auth.ts` falls back to `DEFAULT_ROLES = ['syndigo-developer']` because the platform session cookie carries no role data yet. Every request runs as a superuser internally.

**What to do:**
1. Add a user-roles endpoint to the Riversand OpenAPI spec (or CSL Onboarding service)
2. Implement `fetchUserRoles(userId, tenantId)` in `packages/orpc/src/middleware/auth.ts`
3. Replace the `DEFAULT_ROLES` fallback with the real call, wrapped in `unwrap()`
4. The WeakMap cache scaffold is already in auth.ts — use it to avoid per-request fetches

**Why it matters:** Without this, production would grant every user every permission. No other work makes sense in prod before this is fixed.

---

### 1.2 Add a CI Pipeline

**Current:** No GitHub Actions workflow. `pnpm typecheck`, `pnpm lint`, `pnpm test` never run on PRs.

**What to do:** Run `/cicd-configure` skill. It will create `.github/workflows/ci.yml` with:
- `pnpm typecheck` (both apps + all packages)
- `pnpm lint`
- `pnpm test --filter=pxc-retail && pnpm test --filter=tenant-management`
- Turbo remote cache enabled

**Why it matters:** Type errors, lint violations, and test failures can merge undetected. A single broken import can fail a production build.

---

### 1.3 Add a `/health` Endpoint

**Current:** AKS has no liveness/readiness probe target. The app has no health route.

**What to do:** Add `apps/pxc-retail/src/routes/health.ts`:
```typescript
export const Route = createFileRoute('/health')({
  component: () => null,
})
// + server handler returning { status: 'ok', timestamp: Date.now() }
```
Same for `tenant-management`.

**Why it matters:** AKS will mark pods as unhealthy without a probe — required before Stage 8 (Deploy) of the AIDLC pipeline works.

---

### 1.4 Re-fetch After Save (Not Synthesize)

**Current:** After an attribute or vendor save, the UI merges the request body with local React Query state instead of re-fetching from the server. Server-side normalization, computed fields, and side effects are invisible until a full page reload.

**What to do:** After a successful mutation, call:
```typescript
await queryClient.invalidateQueries({
  queryKey: orpc.domain.procedure.find.queryKey({ input: { id } })
})
```
Not `setQueryData` with a local merge.

**Why it matters:** The server is the source of truth. Synthesized state drifts the moment the server applies any transformation the client didn't anticipate.

---

### 1.5 Consolidate Permissions Vocabulary

**Current:** `apps/tenant-management/src/lib/permissions/vocabulary.ts` defines its own `Module`/`Action` union types locally, not imported from `@repo/core-contracts`. If a third app is added, permissions fragment further.

**What to do:** Move `tenant-management`'s `Module`/`Action` types into `@repo/core-contracts/src/schemas/permission-schema.ts` alongside the existing retail vocabulary (use separate namespaced exports if the vocabularies differ).

**Why it matters:** Any AI agent writing cross-app code will assume permissions come from core-contracts. Inconsistency causes wrong imports and type errors.

---

### 1.6 Stub Lifecycle — Lint Gate

**Current:** Stub files (`*.mock.ts`) and the `context.stubsEnabled` gate exist and work, but there's no enforcement that stubs stay out of production environments.

**What to do:**
- Add a lint rule (or Turbo check) that fails if `ENABLE_BFF_STUBS=true` is set outside `NODE_ENV=development`
- Add a `// TODO(RPC-XXX): remove stub` comment to every `*.mock.ts` pointing to its replacement ticket

**Why it matters:** Stubs silently serving production data would be a data integrity bug.

---

### 1.7 E2E Test Smoke Suite

**Current:** Playwright skill and `@playwright/cli` are set up but no `.spec.ts` files exist. The type checker and unit tests don't verify visual or navigation regressions.

**What to do:** Start with three smoke tests:
1. Vendor list renders and paginates
2. Vendor detail loads from list click
3. Permission redirect: user without `vendor-management:read` hits `/no-access`

Use the `playwright-cli` skill to scaffold them. Even three tests would catch the most common regressions.

---

### 1.8 Stabilize Nitro Dependency

**Current:** `npm:nitro-nightly@latest` is in the lockfile. This works today but is a time bomb on `pnpm update`.

**What to do:** When a stable Nitro release ships with the features in use (TanStack Start compatibility), pin to it and remove `nightly`. Track via a ticket.

---

## 2. Current Known Issues

Issues that exist today and affect development.

| # | Issue | Where | Severity | Ticket |
|---|-------|--------|----------|--------|
| 1 | **Auth middleware stubs all roles to `DEFAULT_ROLES`** | `packages/orpc/src/middleware/auth.ts` | P0 — blocks real auth | — |
| 2 | **No CI pipeline** | repo root | P1 — broken code can merge | — |
| 3 | **POST-save entity synthesized, not re-fetched** | mutation handlers | P1 — stale UI | — |
| 4 | **No `/health` endpoint** | both apps | P1 — AKS probe required | — |
| 5 | **ACR repo doesn't exist** | CI/CD | P1 — blocks automated deploy | — |
| 6 | **Nitro nightly pinned** | `package.json` | P2 — breaks on update | — |
| 7 | **AttributeConflictDialog not implemented** | `pxc-retail` | P2 — stub placeholder shown | RPC-148 |
| 8 | **RelationshipSearchDialog not implemented** | `pxc-retail` | P2 — stub placeholder | RPC-155 |
| 9 | **`shared/profiles/` in repo tree unexplained** | repo root | P3 — confusing to new devs | — |
| 10 | **`docs/architecture/` directory is empty** | docs/ | P3 — ADRs have no home | — |
| 11 | **Generated `.d.ts` types can drift from live API** | `packages/orpc/src/generated/` | P2 — silent type/runtime mismatch | — |
| 12 | **`tenant-management` permission vocab is local** | `apps/tenant-management/src/lib/permissions/` | P2 — fragmented | — |

---

## 3. Gaps for AI-Assisted Development

What's missing that causes Claude to generate incorrect, incomplete, or inconsistent code. These are not bugs — they're documentation and tooling gaps that reduce AI accuracy.

### Gap 1: Auth Stub Is Not in CLAUDE.md

**Problem:** `authMiddleware` stubs all users to `DEFAULT_ROLES`. Any code Claude writes that conditions on real user roles will appear to work locally but fail in production. CLAUDE.md doesn't mention this.

**Fix:** Add a callout to `CLAUDE.md` under the API Layer section:
> ⚠️ `authMiddleware` currently stubs all users to `DEFAULT_ROLES = ['syndigo-developer']`. Do not write code that relies on real role differentiation until this is replaced.

---

### Gap 2: Permission Module Names Not Visible Without File Read

**Problem:** The `Module` and `Action` string literal unions live in `@repo/core-contracts/src/schemas/permission-schema.ts`. Claude must read that file to know what module names are valid (`'vendor-management'`, `'system-admin'`, etc.). Without it, Claude invents plausible-but-wrong names.

**Fix:** Add the full module and action vocabulary to `.claude/knowledge/permissions/` (one section). Update `PATTERNS.md` to point there.

---

### Gap 3: Stub Fields Not Marked in Schemas

**Problem:** `TenantVendorSchema` has `.nullish()` fields (`category`, `displayId`, `location`, `capabilities`, etc.) that are only populated when `context.stubsEnabled` is true. A developer or Claude writing logic against these fields will get `null` in production.

**Fix:** Add a JSDoc comment to each stub-only field: `/** @stub — only populated when ENABLE_BFF_STUBS=true. Not a real API field. */`

Also add a section in `PATTERNS.md` listing stub-only fields and their replacement tickets.

---

### Gap 4: No Cross-Skill Recipe for "Add a Full Feature"

**Problem:** Adding a new page with data requires running 4–5 skills in sequence: `add-orpc-procedure` → `add-route` → `add-permission-check` → `i18n-sync` → `knowledge-sync`. There's no recipe that chains them. Claude tends to miss steps (especially `knowledge-sync` and `i18n-sync`).

**Fix:** Create `.claude/knowledge/recipes/add-feature.md` with the exact ordered steps, which skills to run, and what each produces. This becomes the default playbook for new feature work.

---

### Gap 5: `useSuspenseQuery` vs `useSuspenseInfiniteQuery` — No Rule

**Problem:** Both hooks exist. Claude sometimes uses `useSuspenseQuery` for paginated lists (wrong) or `useSuspenseInfiniteQuery` for single-item fetches (wrong). The correct rule is:
- **Single item or fixed list:** `useSuspenseQuery` + `queryOptions`
- **Paginated / infinite scroll:** `useSuspenseInfiniteQuery` + `infiniteOptions`

**Fix:** Add this rule to `PATTERNS.md` under the "Data Fetching" section.

---

### Gap 6: No Domain Glossary

**Problem:** Terms like `tenantVendor` (a vendor *relationship* scoped to a tenant) vs. `vendor` (the upstream Riversand entity), `Module` (RBAC permission noun), and `bolt` (AIDLC planning unit) are used without definition. Claude conflates them and generates incorrect schema references.

**Fix:** Create `.claude/knowledge/GLOSSARY.md` with 10–15 key terms and their precise meanings.

---

### Gap 7: ErrorKey Inventory Not in KB

**Problem:** The full `ErrorKey` union is in `@repo/core-contracts/src/types/error-key.ts`. Claude must read that file to know what error keys exist and whether one already covers a new case. Often Claude invents new keys that duplicate existing ones, which causes `pnpm typecheck` to fail.

**Fix:** Add the full `ErrorKey` listing to `.claude/knowledge/error-handling/` (or generate it as a reference section in PATTERNS.md). Update automatically as part of the `error-key` skill.

---

### Gap 8: Lovable Component → Source File Mapping

**Problem:** `submodules/loveable/` contains the visual reference (UX mockups). The route/component files that implement each screen exist in `apps/pxc-retail/src/`. There's no documented mapping. Claude has to infer the relationship, which leads to working against the wrong file.

**Fix:** Create `.claude/knowledge/loveable-map.md` — a table mapping each Lovable screen name to its implementation route and primary component file. Update via the `update-loveable` skill.

---

### Gap 9: MSW Test Infrastructure Undiscoverable

**Problem:** `packages/orpc/src/__tests__/msw/` contains a complete MSW setup for mocking upstream HTTP in integration tests. This pattern is not mentioned in CLAUDE.md or PATTERNS.md. Claude writing tests uses `vi.mock()` or inline fixtures instead, producing tests that don't mirror real middleware behavior.

**Fix:** Add an "Integration Testing" section to `.claude/knowledge/rpc-layer/` describing how to use the MSW setup for procedure tests.

---

### Gap 10: `getOrpcServerPrefix` — Required for All `/rpc` URLs

**Problem:** In production, the app is served at `/pxc/`. The `/rpc` endpoint is at `/pxc/rpc`. If Claude hardcodes `/rpc` anywhere (links, fetch calls, test helpers), it breaks in production.

**Fix:** Add a rule to `CLAUDE.md`:
> **Never hardcode `/rpc`** as a URL. Always use `getOrpcServerPrefix('/rpc')` from `#/integrations/orpc/get-orpc-server-prefix`.

---

## 4. Autonomous Development Plan

Steps to make this system as accurate and autonomous as possible with AIDLC.

### Phase 1 — Knowledge Completeness (Do First)

These unblock AI accuracy before writing a single line of new feature code.

| Task | Owner | Skill |
|------|-------|-------|
| Add auth stub warning to CLAUDE.md | Developer | manual edit |
| Add `Module`/`Action` vocabulary to KB | Developer | `knowledge-sync` |
| Add domain glossary (`GLOSSARY.md`) | Developer | manual |
| Add `useSuspenseQuery` vs `infiniteQuery` rule to PATTERNS.md | Developer | manual |
| Add `ErrorKey` listing to KB | Developer | `knowledge-sync` after `error-key` |
| Add Lovable → source file mapping | Developer | `update-loveable` |
| Add cross-skill recipe `add-feature.md` | Developer | manual |
| Add MSW test pattern to rpc-layer KB | Developer | `knowledge-sync` |
| Add `getOrpcServerPrefix` rule to CLAUDE.md | Developer | manual edit |

Estimated effort: 2–4 hours. These are all documentation/KB edits, no code changes.

### Phase 2 — Gate Readiness (Enables CI)

AIDLC gates at Stage 4 run `tsgo --noEmit`, `oxlint`, `npm audit`. Before autonomous development can succeed end-to-end, these must pass clean on every PR.

| Task | Owner | Skill |
|------|-------|-------|
| Set up CI pipeline | Developer | `/cicd-configure` |
| Fix any existing lint violations | Developer | `pnpm lint` |
| Resolve any typecheck failures | Developer | `pnpm typecheck` |
| Add `/health` endpoint to both apps | Developer | `add-route` |
| Ensure `pnpm test` passes clean | Developer | `pnpm test` |

### Phase 3 — Auth Wiring (Enables Real Permissions)

Until this is done, Stage 8 (Deploy) AC verification cannot pass for any permission-sensitive feature.

| Task | Owner | Notes |
|------|-------|-------|
| Define user-roles API contract | Developer | Add to `@repo/core-contracts` |
| Implement `fetchUserRoles` in auth middleware | Developer | Replace `DEFAULT_ROLES` fallback |
| Update auth middleware tests | Developer | MSW-backed integration test |
| Update KB to reflect real auth flow | Developer | `knowledge-sync` |

### Phase 4 — AIDLC Profile Activation

Once Phases 1–3 are complete, the profile is accurate and AIDLC can run end-to-end.

| Task | Owner | Notes |
|------|-------|-------|
| Verify `retail-pxc.yml` profile matches current stack | Developer | Compare profile to actual package.json |
| Create ACR repo | DevOps | Required for Stage 5 (Build) |
| Configure AKS deployment | DevOps | Required for Stage 8 (Deploy) |
| Run a full AIDLC pipeline on a small ticket | Developer | Validate end-to-end |

### Ongoing — Knowledge Sync Discipline

After every code change under `apps/` or `packages/`, run `knowledge-sync` (as specified in CLAUDE.md). This keeps the KB accurate and prevents AI accuracy from degrading over time as the codebase evolves.

The `knowledge-sync` skill computes impacted areas from the staged diff and updates only the relevant KB documents — it does not require manual editing of every doc.
