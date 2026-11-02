# Knowledge Base — Router

Read this file first. It tells you which area doc answers your question, so you never have to
open every area README. Paths are relative to the repository root. Source lives under `apps/`
and `packages/` (monorepo with pnpm workspaces + Turbo).

Cross-area references: `PATTERNS.md` (repo-wide patterns), `recipes/` (task playbooks — none yet),
`kb-index.json` (module → area registry, machine readable).

## Areas

| Area | Owns (modules) | Entry point | Ask here when |
|---|---|---|---|
| [rpc-layer](rpc-layer/) | `packages/core-contracts/src/`, `packages/orpc/src/`, `apps/*/src/integrations/orpc/`, `apps/*/src/routes/rpc/` | `RPCHandler#handle` | you need to add a contract, procedure, or query option; understand the middleware builder stack; trace an RPC call end to end |
| [error-handling](error-handling/) | `packages/orpc/src/errors.ts`, `packages/orpc/src/middleware/error-recording.ts`, `packages/app-shell/src/error-toast.ts`, `apps/*/src/integrations/tanstack-query/error-cache.ts` | `throwError` | you need to add or change an error key, toast behavior, or understand how server errors reach the client |
| [permissions](permissions/) | `packages/app-shell/src/permissions/`, `packages/core-contracts/src/permissions/`, `apps/*/src/lib/permissions/` | `requireModuleAccess` | you need to add a route guard, filter navigation, resolve a landing route, or understand RBAC expansion |
| [forms](forms/) | `apps/*/src/components/**/use-*-form.ts`, `apps/*/src/components/**/*-schema.ts`, `packages/app-shell/src/components/UnsavedChangesGuard.tsx` | `useForm`, `UnsavedChangesGuard` | you need to add or modify a form, wire an unsaved-changes guard, understand dirtiness tracking, or handle per-step wizard validation |

## Question routing

| You need | Go to |
|---|---|
| Repo-wide pattern, or how to extend one | `PATTERNS.md` |
| Step-by-step wiring for a common task | `recipes/` (none yet — use the matching project skill, e.g. `add-orpc-procedure`) |
| Which area owns a file you are about to change | `kb-index.json`, or run `python3 .claude/skills/knowledge-sync/scripts/kb_impact.py --files <path>` |

## Last verified

2026-09-30 | commit `1cb0369` | branch `dev/jmarquardt/kb-bootstrap-2`
