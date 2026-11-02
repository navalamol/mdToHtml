# retail-pxc · Roadmap

<!--
CLAUDE SESSION BOOTSTRAP
────────────────────────
When a developer says "continue":
1. Read CURRENT SPRINT — find the first unchecked [ ] item
2. Read its linked detail section below for full context + action steps
3. Execute the work
4. Mark it [x], move the line to DONE
5. Append one row to SESSION LOG with today's date, who, and what was completed
6. If all sprint items are [x]: promote the next 3-4 BACKLOG items to CURRENT SPRINT

When a developer says "continue [item number]" — skip to that specific item.
When a developer says "status" — summarize what is done, in-progress, and next.
When a developer says "plan [item]" — show the full detail for that item without executing.

DO NOT re-read all docs on every session. This file + CLAUDE.md is sufficient context.
Reference docs (read only when the work requires it):
  - CLAUDE.md                        → project rules (read before any code change)
  - .claude/knowledge/INDEX.md       → area-specific deep context
  - docs/LOCAL-DEV-SETUP.md          → env setup + troubleshooting
  - docs/ARCHITECTURE.md             → architecture details
  - docs/TECH-EVALUATION.md          → tech stack evaluation
-->

---

## Project snapshot

**retail-pxc** is Syndigo's retail intelligence platform — two SSR React apps (`pxc-retail` on port 3000, `tenant-management` on port 3001) in a pnpm monorepo. Contract-first oRPC API, TanStack ecosystem (Router / Query / Form), TypeScript 6, Tailwind v4, mandatory i18n (en/es/fr/de), typed error keys. Architecture is sound. What it lacks is safety nets: no mocks, no hooks, no coverage gate, no E2E tests, no alerting.

**Active architect:** amol.naval@syndigo.com  
**Roadmap created:** 2026-10-15  
**Last session:** 2026-10-15 — see SESSION LOG

---

## Current sprint

> Work these in order. Each is self-contained; no dependencies on each other.

- [x] **02** · Git pre-commit hooks (`simple-git-hooks`: typecheck + lint on commit)
- [ ] **03** · Test coverage gate (measure baseline → set threshold in both `vitest.config.ts`)
- [ ] **04** · Error boundary audit (verify all `_shell/` routes have `errorComponent` set)
- [ ] **11** · Bundle size gate (`rollup-plugin-visualizer` + size budget in CI)

---

## Backlog

### Phase 1 — Stop (do before more features)
- [ ] **01** · MSW mock layer — credential-free local dev (biggest onboarding blocker)
- [ ] **05** · BFF stub drift — add schema-validation tests for every `*.mock.ts` file

### Phase 2 — Plan next quarter
- [ ] **06** · E2E test suite — Playwright golden paths, both apps, runs against MSW
- [ ] **07** · Accessibility baseline — axe-core audit + `eslint-plugin-jsx-a11y`
- [ ] **08** · Auth local dev — real `auth-session` cookie flow testable on localhost
- [ ] **09** · Error rate alerting — Grafana alert on `span.status = ERROR` rate spike

### Phase 3 — Improve anytime (orthogonal to features)
- [ ] **10** · Storybook — design-system top-10 components with variants + dark mode
- [ ] **12** · Design token audit — grep hardcoded Tailwind colors, replace with semantic tokens
- [ ] **13** · Loveable submodule — evaluate: remove or document clearly as optional
- [ ] **14** · Performance monitoring — Web Vitals → OTel + Lighthouse CI on PRs
- [ ] **15** · Dependency health — Dependabot enabled + quarterly update policy documented

### Phase 4 — Strategic watch (12-month horizon)
- [ ] **16** · BFF server-side caching — Redis + `cacheMiddleware` in oRPC builder stack
- [ ] **17** · API contract tests — nightly upstream OpenAPI spec compliance check
- [ ] **18** · TS6/Vite8 ecosystem — monitor `@ts-ignore` count, quarterly upgrade review
- [ ] **19** · Structured logging — `pino` + OTel traceId/spanId context injection

---

## Item detail

Each item has: WHY it matters · WHAT to do (concrete steps).

### 02 · Git pre-commit hooks
**Why:** Typecheck, lint, and knowledge-sync are skipped constantly. Broken main branch becomes normalized. Every skipped check creates a broken type or stale knowledge doc that someone else fixes later.  
**What:**
1. Add `simple-git-hooks` + `lint-staged` to root `package.json` dev deps
2. `pre-commit` hook: `pnpm typecheck && pnpm lint`
3. `pre-push` hook: `pnpm test` (tests are slow; push not commit)
4. `"prepare": "simple-git-hooks"` in scripts so hooks install on `pnpm install`
5. Add CI step: `python3 .claude/skills/knowledge-sync/scripts/kb_lint.py` — gates PRs on stale KB

### 03 · Test coverage gate
**Why:** Without a threshold, coverage degrades silently with every new feature. By the time it matters it's too late to recover cheaply.  
**What:**
1. Run `pnpm test --coverage` — note current % for both apps
2. Set threshold 2–3% below current in each app's `vitest.config.ts` (passes immediately; sets the floor)
3. Add `coverage: { reporter: ['text', 'lcov'] }` for CI artifacts
4. Raise threshold by 5% every quarter as part of backlog grooming

### 04 · Error boundary audit
**Why:** `useSuspenseQuery` requires an ancestor `ErrorBoundary`. Missing one = white screen of death when any query fails. Multiplies with every new route.  
**What:**
1. Check both apps' `_shell.tsx` — verify `errorComponent` is set on the layout route (catches all child errors)
2. Grep for `useSuspenseQuery` across `apps/*/src/routes/` — for any file that uses it, confirm an ancestor route has `errorComponent`
3. If the layout `_shell.tsx` already has it, mark done
4. Add to `add-route` skill checklist: "does this route or an ancestor have errorComponent?"

### 05 · BFF stub drift
**Why:** `*.mock.ts` stubs return fixed data when `ENABLE_BFF_STUBS=true`. If stub shape diverges from Zod schema, dev shows different data than production — silently.  
**What:**
1. Find all `*.mock.ts` in `packages/orpc/src/procedures/`
2. For each, add a Vitest test: `outputSchema.parse(mockData)` — must not throw
3. This runs in CI; any schema change that isn't reflected in the stub fails immediately

### 11 · Bundle size gate
**Why:** The architecture is correct for tree-shaking (no barrel files, `"sideEffects": false`). But nothing prevents a bad import from doubling the client bundle silently.  
**What:**
1. `pnpm build` → note current client chunk sizes
2. Add `rollup-plugin-visualizer` to both apps' `vite.config.ts` — generates `stats.html` build artifact
3. Add `bundlesize` check in CI: set limits at current size + 20% (generous floor)
4. Tighten limits quarterly

### 01 · MSW mock layer
**Why:** Every new developer spends 1–2 days blocked on credentials before running the app. Can't work offline. Biggest onboarding force multiplier.  
**What:**
1. Install `msw@latest` at repo root (dev dep)
2. Create `packages/orpc/src/mocks/<domain>.ts` — one per domain, handlers derived from output schemas
3. Each app: `src/mocks/browser.ts` activates MSW when `VITE_ENABLE_MOCKS=true`
4. Add `VITE_ENABLE_MOCKS=true` as default in each app's `.env.example`
5. Vitest setup: same handlers for unit tests
6. Target: `pnpm dev` works with zero credentials

### 06 · E2E test suite
**Why:** No regression safety net. Every significant refactor is a leap of faith.  
**What:**
1. `pnpm dlx playwright install chromium`
2. pxc-retail: vendor list loads → vendor detail page → one mutation (form save)
3. tenant-management: tenant onboarding happy path → feature set creation
4. CI: runs against MSW mock layer (item 01 prerequisite), not live dev env
5. Use `playwright-cli` skill: `/playwright-cli` then describe each flow

### 07 · Accessibility baseline
**Why:** WCAG AA is a B2B procurement requirement. Retrofitting is 5–10x more expensive than building correctly.  
**What:**
1. Install `@axe-core/playwright` — add one call per E2E test (item 06 prerequisite)
2. Add `eslint-plugin-jsx-a11y` to root Oxlint config
3. Priority fixes: keyboard navigation, focus management in dialogs, aria-labels on icon-only buttons

### 08 · Auth local dev
**Why:** `pnpm dev` bypasses the real `auth-session` cookie path. Production auth bugs are invisible until users hit them.  
**What:**
1. Write integration tests for `authMiddleware` covering both cookie path and fallback path
2. Medium term: Auth0 CLI local tenant so real session flow works on localhost
3. E2E test for session expiry behavior

### 09 · Error rate alerting
**Why:** Traces capture every error with trace ID. Nobody is alerted when error rate spikes. Discovery is reactive (support tickets).  
**What:**
1. In Grafana (from `docker-compose.observability.yml`): alert rule on `span.status = ERROR` rate > threshold over 5 min
2. Second alert on P99 latency
3. Wire to Slack/PagerDuty via Grafana notification channels in `global-devops-infra`
4. Largely config, not code

### 10 · Storybook
**Why:** No visual catalogue → developers don't know what components exist → build duplicates → design system drifts.  
**What:**
1. Add Storybook 8 to `packages/design-system/`
2. Stories for top 10 components: Button, DataTable, Input, Select, Dialog, Badge, Tabs, Skeleton, Toast, DataTable pagination
3. Each story: default, all CVA variants, empty/loading/error states, dark mode
4. Deploy to GitHub Pages on merge to main

### 12 · Design token audit
**Why:** OKLch tokens are correct but app code may contain hardcoded Tailwind colors (`text-gray-500`, `bg-white`) that don't adapt to theme.  
**What:**
1. Grep `apps/*/src/components/` for `text-gray-`, `bg-white`, `bg-black`, `text-black`
2. Replace with semantic design system tokens (`text-foreground`, `bg-background`, etc.)
3. Add Oxlint rule warning on non-semantic color utilities in app code

### 13 · Loveable submodule
**Why:** Git submodule for a "UX reference only" source — never shipped — creates detached HEAD confusion and PR noise for every developer.  
**What:**
1. Decision: does the reference add enough value for submodule friction? If yes: document clearly as optional. If no: `git rm submodules/loveable`, replace with a link to the external repo in README.md.
2. A link provides 95% of the reference value at zero workflow cost.

### 14 · Performance monitoring
**Why:** OTel measures server spans. Core Web Vitals (LCP, INP, CLS) from real browsers are unmeasured. SSR doesn't guarantee good UX performance.  
**What:**
1. Add `web-vitals` to both apps
2. Send vitals to OTel collector as custom span attributes — no new infra
3. Add `@lhci/cli` to CI: Lighthouse check on built app for critical routes

### 15 · Dependency health
**Why:** Running TS6 + Vite8 + React19 needs active maintenance. Falling behind means a "big bang" update that breaks everything at once.  
**What:**
1. Enable Dependabot: auto-merge patches, review required for minor/major
2. Pin TS and Vite to exact versions (not ranges) in `package.json`
3. Monthly `pnpm outdated` review
4. Document upgrade policy in `CONTRIBUTING.md`

### 16 · BFF server-side caching
**Why:** Every SSR page load hits upstream for every procedure. At scale, rate limits and latency become blockers.  
**What:**
1. Add Redis to the deployment stack
2. `cacheMiddleware` in oRPC builder: keyed on `procedureName + serializedInput`, configurable TTL per procedure
3. Start with highest-volume reads: vendor list, product catalog

### 17 · API contract tests
**Why:** Upstream API specs in `packages/orpc/specs/` are the source of truth. Nothing verifies the running upstream still matches them.  
**What:**
1. Nightly CI job: fetch current OpenAPI spec from each upstream's `/openapi`, diff against pinned spec
2. Breaking changes → fail + Slack notification + PR to run `absorb-openapi-changes`
3. Tool: `openapi-diff` or Spectral

### 18 · TS6/Vite8 ecosystem risk
**Why:** Stack is 6–12 months ahead of ecosystem median. Library compatibility surprises accumulate as `@ts-ignore` comments.  
**What:**
1. Track `@ts-ignore` / `@ts-expect-error` count — if growing, investigate
2. Quarterly: test latest TS + Vite minor release in a branch before committing
3. Brief ADR for each major version upgrade decision

### 19 · Structured logging
**Why:** `console.*` is fine now. Degrades when you need to query/filter/alert on server output.  
**What:**
1. Add `pino` as server logger when the need arises
2. Wire OTel traceId/spanId into every log line automatically
3. Replace `console.*` calls incrementally; don't do a big-bang refactor

---

## Done

- [x] **02** · Git pre-commit hooks — 2026-10-15 by amol.naval — `simple-git-hooks` + `lint-staged` installed; pre-commit runs typecheck+lint, pre-push runs tests; CI `knowledge-gate` job added; both build jobs gate on it

---

## Session log

| Date | Who | Work completed | Notes |
|------|-----|----------------|-------|
| 2026-10-15 | amol.naval | Initial project setup: onboarding guide artifact, LOCAL-DEV-SETUP.md, ARCHITECTURE.md, TECH-EVALUATION.md, debt report artifact, ROADMAP.md | First session — project onboarding and evaluation |
| 2026-10-15 | amol.naval | **02** Git pre-commit hooks: `simple-git-hooks` + `lint-staged` added to root package.json; pre-commit=typecheck+lint, pre-push=test; CI knowledge-gate job added, both build jobs gate on it | |
