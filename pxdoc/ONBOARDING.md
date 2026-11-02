# Engineering Onboarding

Welcome to **pxc-retail** — the monorepo behind Syndigo's PXC (Product Experience Cloud) retail applications. This guide takes you from a fresh clone to your first meaningful change. It assumes no prior knowledge of this repo; skim the parts you already know.

If you only read one thing: this is a **pnpm + Turbo monorepo** of TypeScript/React apps sharing a **contract-first oRPC API** and a common **application shell**. Everything below expands on that sentence.

---

## 1. The mental model

There are two user-facing apps and a set of shared packages they both build on.

```
                 ┌─────────────────┐     ┌──────────────────────┐
   Browser  ───► │  apps/pxc-retail │     │ apps/tenant-management│
                 │   (port 3000)    │     │      (port 3001)      │
                 └────────┬─────────┘     └───────────┬──────────┘
                          │       both apps consume…  │
          ┌───────────────┴───────────────┬───────────┴────────────────┐
          ▼                               ▼                             ▼
  @syndigo/app-shell            @syndigo/design-system          @syndigo/orpc
  (shell chrome, permissions,   (UI components, Tailwind,       (RPC implementations
   navigation, i18n, toasts)     OKLch tokens)                   + the router)
                                                                       │
                                                             @repo/core-contracts
                                                        (Zod schemas + oRPC contracts
                                                         + inferred TypeScript types)
```

**The golden rule of this repo: types flow in one direction.** Contracts and schemas are
defined once in `@repo/core-contracts`, implemented in `@syndigo/orpc`, and consumed by the
apps. When you change an endpoint you start at the contract and let the type system push the
change outward. You never redefine a shape in the app that the contract already owns.

---

## 2. What lives where

### Apps (`apps/`)

| App                       | Port | What it does                                                                        |
| ------------------------- | ---- | ----------------------------------------------------------------------------------- |
| **`pxc-retail`**          | 3000 | The main retail app: merchandising, vendor central, insights, system admin.         |
| **`tenant-management`**   | 3001 | Tenant onboarding and feature-set / feature-definition management.                  |

Both apps are **TanStack Start** (SSR framework running on Nitro) + **React 19**, use **file-based
routing** via TanStack Router, and share almost all of their plumbing through `@syndigo/app-shell`.
Their structure is nearly identical:

```
apps/<app>/src/
├── routes/              # File-based routes. Path = URL. `_shell/` is the authenticated layout.
│   ├── __root.tsx       # Root document (html/head/body, providers). Hand-written.
│   ├── _shell.tsx       # Authenticated shell layout wrapper.
│   ├── _shell/          # Pages that live inside the shell chrome.
│   ├── rpc/$.ts         # oRPC JSON-RPC handler mounted at /rpc
│   ├── openapi/$.ts     # OpenAPI handler mounted at /openapi
│   └── routeTree.gen.ts # AUTO-GENERATED — never edit by hand (see §7)
├── lib/
│   ├── navigation-config.ts   # This app's menu groups + sub-tabs
│   └── permissions/index.ts   # Binds app-shell's generic permission engine to this app's Modules
├── integrations/        # orpc client, tanstack-query setup, i18n config
├── locales/{en,es,fr,de}/translation.ts   # All user-facing strings
├── env/{server,client}.ts   # T3 Env-validated environment variables
└── components/          # App-specific components
```

### Packages (`packages/`)

| Package                    | Import as                    | Purpose                                                                                   |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| **`core-contracts`**       | `@repo/core-contracts`       | Zod schemas, oRPC contract definitions, and inferred TS types. The single source of API shapes. |
| **`orpc`**                 | `@syndigo/orpc`              | Procedure implementations + the router. Talks to upstream services; maps their responses/errors. |
| **`app-shell`**            | `@syndigo/app-shell`         | Shared shell chrome, permissions engine, navigation types, i18n, error toasts, theme/timezone hooks. |
| **`design-system`**        | `@syndigo/design-system`     | Component library (shadcn preset `base-nova` + @base-ui/react + Tailwind 4 / OKLch tokens). |
| **`typescript-config`**    | `@repo/typescript-config`    | Shared strict tsconfig bases.                                                              |

> **No barrel files.** Import the exact subpath, e.g.
> `@syndigo/design-system/components/button`, `@syndigo/app-shell/permissions`. Look at a
> package's `package.json` `exports` field to see what's available.

### Submodule (`submodules/loveable/`)

A git submodule ([syndigo/retail-pxcloud](https://github.com/syndigo/retail-pxcloud)) holding a
Lovable-generated retail UI. Product uses it as a **UX reference / push experience** for agentic
development — it is *not* shipped. You generally don't touch it; run
`git submodule update --init --recursive` after cloning if you need it.

---

## 3. Prerequisites

| Tool    | Version         | Notes                                                              |
| ------- | --------------- | ------------------------------------------------------------------ |
| Node.js | **>= 24**       | Check `.nvmrc` if present; `node -v`.                              |
| pnpm    | **11.x**        | Enable via `corepack enable` (the repo pins `pnpm@11.10.0`).       |
| Git     | any recent      | Submodule support needed for the loveable reference.               |

We use **pnpm workspaces** (not npm/yarn) and **Turbo** as the task orchestrator. You almost
always run scripts from the **repo root**; Turbo fans them out to the right packages in dependency
order and caches results.

---

## 4. First-time setup

```bash
# 1. Clone and enter
git clone <repo-url> pxc-retail && cd pxc-retail
git submodule update --init --recursive        # optional: pulls the loveable reference

# 2. Enable the pinned package manager
corepack enable

# 3. Install everything (all workspaces)
pnpm install

# 4. Generate local env files (prompts for the Auth client id/secret — ask a teammate)
node apps/pxc-retail/scripts/setup-env.mjs
node apps/tenant-management/scripts/setup-env.mjs
```

Each app reads server config from its own `apps/<app>/.env.local`. The `setup-env.mjs` scripts
pre-fill sensible dev defaults and prompt only for the credentials you can't guess. Re-run them any
time to update credentials. Env vars are validated at boot by **T3 Env** (`src/env/server.ts` and
`src/env/client.ts`) — a missing required var fails fast with a clear message rather than a
mysterious runtime error.

---

## 5. Everyday commands

All run from the repo root:

```bash
pnpm dev          # Start every app + package in watch mode (Turbo TUI)
pnpm build        # Build everything
pnpm lint         # Oxlint across all packages
pnpm format       # Oxfmt (formatter) across all files
pnpm typecheck    # Type-check everything (tsgo)
pnpm test         # Run all test suites (Vitest)
```

Scope to one workspace with `--filter`:

```bash
pnpm dev --filter=pxc-retail            # just the retail app → http://localhost:3000
pnpm dev --filter=tenant-management     # just tenant-management → http://localhost:3001
pnpm test --filter=pxc-retail           # only this app's Vitest suite
pnpm build --filter=@syndigo/design-system
```

**Tooling note:** we use **Oxlint** (linter) and **Oxfmt** (formatter), not ESLint/Prettier.
Code style is: no semicolons, single quotes, trailing commas — all enforced automatically, so let
the tools do it rather than hand-formatting.

---

## 6. How a request actually works (contract-first)

This is the most important concept in the codebase. Follow the flow for a hypothetical
`vendor.list` endpoint:

1. **Schema + contract** live in `@repo/core-contracts` — a Zod schema for input/output and an
   oRPC contract that declares the shape and the standard error codes.
2. **Implementation** lives in `@syndigo/orpc` (`src/procedures/…`). It `implement(contract)`s the
   procedure, calls the real upstream service, and returns typed data. It is wired into
   `src/router.ts`.
3. **The app** calls it through an **isomorphic client** (`src/integrations/orpc/client.ts`): on
   the server it invokes the router directly; in the browser it goes over HTTP to `/rpc`.
4. **React** consumes it via TanStack Query utils:

   ```ts
   import { orpc } from "#/integrations/orpc/client";
   import { useSuspenseQuery } from "@tanstack/react-query";

   const { data } = useSuspenseQuery(
     orpc.vendorCentral.vendor.list.queryOptions({ input: {} }),
   );
   ```

### Errors never leak

The BFF never sends raw upstream errors to the browser. Server code throws with
`throwError({ code, errorKey, params })` where `errorKey` is a typed union like
`vendor.not_found`. The client turns `errorKey` into a localized message
(`errors.${errorKey}`) and shows a toast (mutations) or an error page (queries/loads). To add a
new error you must (1) add the literal to `ErrorKey` in `@repo/core-contracts` **and** (2) add
`errors.<key>` to all four locale files — skip step 2 and `tsc` fails.

### Upstream specs are the source of truth

The upstream service OpenAPI specs live in `packages/orpc/specs/`. The BFF's Zod schemas,
contracts, handlers, and tests are derived **from** those specs (there's a `generate` Turbo task
and a dedicated `absorb-openapi-changes` skill for propagating spec drift). When an upstream API
changes, you start at the spec, not at the app.

---

## 7. Routing & the generated route tree

Routes are files under `src/routes/`. The filename maps to the URL; `_shell/` is the authenticated
layout, and pages under it render inside the shared shell chrome. Access is guarded in a route's
`beforeLoad` with `requireModuleAccess(...)`, and the nav is filtered with
`useFilteredMenuGroups` / `useFilteredSubTabs` (both from the app's `#/lib/permissions`, which wrap
`@syndigo/app-shell`). Unauthorized users are redirected to `/no-access`.

**`src/routeTree.gen.ts` is auto-generated. Do not edit it.** After adding, removing, or renaming a
route file, regenerate it by running that app's dev server once:

```bash
pnpm dev --filter=pxc-retail          # or --filter=tenant-management
```

You'll see this file show up as "modified" in git fairly often; that's expected.

---

## 8. Internationalization (never hard-code text)

**All** user-facing text — component copy and error messages alike — must go through translations.
Strings live in `apps/<app>/src/locales/{en,es,fr,de}/translation.ts`.

```tsx
import { useTranslation } from "@syndigo/app-shell/hooks/use-translation";

const { t } = useTranslation();
<p>{t($ => $.errors.not_found)}</p>
<p>{t($ => $.vendor.display.employees_count, { count: 5 })}</p>   // interpolation + pluralization
```

Keys are **selector callbacks** (`t($ => $.a.b)`), not strings — this gives compile-time checking
and avoids TS depth-limit issues. For a runtime-computed key use
`dynamicSelector('a.b.c')`, but prefer a `Record<Union, TranslationSelector>` lookup when the set
of keys is closed. The `i18n-sync` skill audits the four locale files for missing/mismatched keys.

---

## 9. Making your first change — worked examples

Pick the pattern that matches your task. Each has a dedicated skill (see §10) that walks the exact
steps; here's the shape so you know what "done" looks like.

- **New UI component** → add it to `@syndigo/design-system` (CVA + Tailwind + @base-ui/react, OKLch
  tokens, `cn()` for class merging, no barrel export). Skill: `add-design-component`.
- **New API endpoint** → schema in `core-contracts` → contract → implement in `orpc` → wire into
  the router → add error keys + locale strings. Skill: `add-orpc-procedure`.
- **New page/route** → add a file under `src/routes/_shell/`, add a permission guard, register it in
  `navigation-config.ts`, add locale strings, regenerate the route tree. Skill: `add-route`.
- **New permission check** → decide the layer (procedure / route guard / component) and use the
  matching helper. Skill: `add-permission-check`.
- **New error variant** → `ErrorKey` literal + `errors.<key>` in all four locales. Skill: `error-key`.

### The pre-PR checklist

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Then confirm your change in a running app (`pnpm dev --filter=<app>`). Commit on a feature branch
(not `main`); regenerated `routeTree.gen.ts` changes belong in the same commit as the route change
that caused them.

---

## 10. Skills — the repo's built-in playbooks

This repo ships **skills**: focused, step-by-step guides for recurring tasks, living in
`.claude/skills/`. They're written for **Claude Code** — invoke one by typing `/<skill-name>` in
the Claude Code prompt (or just describe your task and Claude will load the matching skill). If a
skill matches what you're doing, follow it: it encodes the exact conventions this guide only
summarizes.

The skills currently available in this repo:

| Skill                        | Use it when you're…                                                          |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `add-orpc-procedure`         | Adding a new server endpoint (schema → contract → implementation → router).  |
| `add-route`                  | Adding a new page/route to an app.                                           |
| `add-design-component`       | Adding a component to `@syndigo/design-system`.                              |
| `add-permission-check`       | Adding or auditing an access check at the right layer.                       |
| `error-key`                  | Adding a new `ErrorKey` and its `errors.<key>` strings across all locales.   |
| `i18n-sync`                  | Auditing the four locale files for missing/mismatched keys.                  |
| `absorb-openapi-changes`     | Propagating an upstream OpenAPI spec change through the BFF stack.           |
| `shadcn`                     | Working with shadcn components / the component registry.                     |
| `update-loveable`            | Updating the loveable submodule and summarizing the UX changes.             |
| `ux-reference-implementation`| Implementing a feature using the loveable submodule as a UX reference.       |
| `playwright-cli`             | Driving a browser / writing Playwright tests.                                |
| `find-skills`                | Discovering whether a skill exists for something not listed here.            |

> Not sure one exists for your task? Run the `find-skills` skill, or browse `.claude/skills/` —
> each folder has a `SKILL.md` describing exactly what it does and when to reach for it.

---

## 11. Glossary for newcomers

| Term            | Meaning in this repo                                                                        |
| --------------- | ------------------------------------------------------------------------------------------- |
| **Monorepo**    | One git repo holding multiple apps and shared packages.                                     |
| **pnpm workspace** | How the packages link to each other locally (`workspace:*` deps).                        |
| **Turbo**       | Task runner that orders and caches `build`/`lint`/`test` across the workspace.              |
| **oRPC**        | The type-safe RPC layer. "Contract-first": shapes defined once, enforced end-to-end.        |
| **BFF**         | Backend-for-frontend — `@syndigo/orpc` is our BFF; it fronts upstream services.             |
| **Contract**    | The typed declaration of an endpoint (input/output/errors) in `@repo/core-contracts`.       |
| **TanStack Start** | The SSR React framework the apps are built on (routing, server functions, on Nitro).     |
| **Shell**       | The authenticated app frame (nav, chrome) shared via `@syndigo/app-shell`.                  |
| **Module / Action** | The vocabulary of the permission system (what area, what capability).                   |
| **Selector callback** | The `t($ => $.a.b)` form for translation keys — compile-time-checked.                 |
| **Isomorphic client** | An oRPC client that calls the router directly on the server and over HTTP in the browser. |

---

## 12. Where to get unstuck

1. **`CLAUDE.md`** (repo root) — the authoritative, detailed conventions reference. When this guide
   and `CLAUDE.md` disagree, `CLAUDE.md` wins; it's kept closest to the code.
2. **`README.md`** — the quick project overview and tech-stack table.
3. **Skills** (§10) — task-specific playbooks.
4. **The code itself** — a package's `package.json` `exports` tells you its public surface; an
   existing route/procedure/component is the best template for the next one.
5. **Your team** — for the Auth client credentials and anything environment-specific.

Welcome aboard. Your first PR is usually a small, well-scoped change (a copy fix, a new sub-tab, a
single procedure) — that's the fastest way to exercise the whole loop in §9 end to end.
