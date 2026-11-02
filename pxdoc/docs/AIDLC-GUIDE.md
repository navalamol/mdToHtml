# AIDLC Guide

**Agentic AI-Driven Lifecycle** — Syndigo's autonomous software delivery platform. This document explains what it is, how it connects to this repo, and how to work with it.

---

## What Is AIDLC?

AIDLC is an autonomous software delivery system built on the Claude Agent SDK. Its job is to take a Jira ticket from `sdlc-ready` state to deployed code with a human gate only at PR review.

```
Jira ticket (sdlc-ready)
    ↓
AIDLC reads ticket + platform profile
    ↓
11-stage autonomous pipeline:
  0.5 Run Sizer → measure blast radius (XS/S/M/L/XL)
  1   Initiation → write acceptance criteria back to Jira
  2   Planning   → write ADR to Confluence ARCH space
  3   Design     → write ADD to Confluence
  4   Development → write code; run gates (typecheck, lint, audit)
  5   Build      → docker build, push to ACR
  7   Test       → vitest run
  8   Deploy     → kubectl rollout; pod health check; AC verification
  9   Release    → tag + release notes
  10  Close      → Jira update + cost report
    ↓
PR opened for human review
```

---

## Repository Location

```
D:\Work\1_Retail_PXC\setup\aidlc
```

This is a separate git repository, cloned alongside `retail-pxc`. It contains:

```
aidlc/
├── agents/                      Individual specialized Claude agents
│   ├── sdlc/                    Main SDLC orchestrator agent
│   ├── sdlc-trigger/            Webhook-triggered entry point
│   ├── build/                   Build & push agent
│   ├── profile-builder/         Generates platform profiles from repos
│   ├── discovery/               Codebase analysis agent
│   ├── coordination-mcp/        MCP server for agent-to-agent coordination
│   ├── readiness-mcp/           MCP server for gate checks
│   └── lovable-mcp-gateway/     MCP gateway to Lovable reference UI
├── shared/
│   └── profiles/                Platform profiles — one YAML per repo/service
│       ├── retail-pxc.yml       Profile for THIS repo (pxc-retail app)
│       └── retail-pxc-plan.yml  Planning-only variant (stages 1-3, no code)
├── docs/                        Operations docs, migration guides, architecture
├── .claude/                     Skills and configs consumed by AIDLC's own sessions
└── agents/sessions/             Curated session logs (AIDLC-NNN-*.md = internal)
```

---

## The Platform Profile: `retail-pxc.yml`

The profile is the connection point between AIDLC and this repo. It tells AIDLC everything it needs to build, test, and deploy code autonomously.

Key things the profile declares:

| Field | Value |
|-------|-------|
| Repo | `syndigo/retail-pxc` |
| Jira project | `RPC` |
| Stack | TypeScript 5.9, TanStack Start 1.x, Nitro SSR, Node 22 |
| Database | None — pure BFF proxy to upstream APIs |
| Multi-tenancy | App-level, subdomain-based |
| Auth | Session cookie pass-through to Riversand |
| Build cmd | `pnpm build --filter=pxc-retail` |
| Test cmd | `pnpm test --filter=pxc-retail` |
| Typecheck cmd | `pnpm typecheck` |
| Lint cmd | `pnpm lint` |
| Deploy | Docker 3-stage → AKS, Azure East US |
| Dev URL | `pxcretaildev.syndigo.com/pxc/` |

### Stage 4 Auto-Injected Skills

When AIDLC runs Stage 4 (Development) for this repo, it automatically injects the `ux-reference-implementation` skill. This skill enforces:
- Component imports from `@syndigo/design-system/components/<name>` (not hand-rolled HTML)
- Reuse of existing components rather than inline primitives
- Consistent use of the design system's CVA variants and color tokens

### Known Issues Baked Into the Profile

The profile documents critical blockers that every developer (and AIDLC) must know:

| Issue | Impact | Status |
|-------|--------|--------|
| **Auth middleware is stubbed** | `authMiddleware` falls back to `DEFAULT_ROLES = ['syndigo-developer']` for all requests. Real user roles are not loaded yet. | Hard blocker for production |
| **No CI pipeline** | `pnpm typecheck`, `pnpm lint`, `pnpm test` never run automatically on PRs | Broken builds can merge |
| **Nitro nightly dependency** | `npm:nitro-nightly@latest` — deterministic today but will break on next update | Medium risk |
| **No `/health` endpoint** | AKS liveness/readiness probes have nothing to call | Required before prod deploy |
| **POST-save entity synthesized** | After attribute save, UI merges request body with local state instead of re-fetching | Stale data until page reload |
| **ACR repo doesn't exist** | Stage 5 (Build/Push) is blocked | Required before automated deploy |
| **Multiple feature stubs** | AttributeConflictDialog, RelationshipSearchDialog, and others are pending tickets | RPC-148, RPC-155, etc. |

---

## The Planning-Only Variant: `retail-pxc-plan.yml`

This profile runs only stages 1–3 (Initiation, Planning/ADR, Design/ADD). It writes to local Markdown files (`stories.md`, `decisions.md`, `design.md`) without touching Jira or Confluence.

Use this for:
- Sprint-by-sprint story breakdown offline
- Architecture decisions that aren't ready for Jira
- Exploring design options before committing

Sprint source: `roadmap` — reads the active sprint from the `roadmap.md` file in the resolved output folder.

---

## Roadmap MCP Access

AIDLC uses Claude's **Model Context Protocol (MCP)** to connect to external systems. The Roadmap MCP is one of these connections.

**What it does:**
1. Reads the active roadmap for the project (features, sprints, bolts)
2. Resolves sprint labels and active work items
3. Writes planning artifacts back to the correct output folder

**The tools visible in this Claude Code session:**
- `mcp__roadmap__authenticate` — initiates auth with the Roadmap MCP server
- `mcp__roadmap__complete_authentication` — completes the OAuth flow

These appear as deferred tools in Claude Code's context — they're the client side of the Roadmap MCP connection that AIDLC uses during the planning stages.

**Flow during `/sdlc --profile retail-pxc`:**
```
AIDLC skill starts
  → reads retail-pxc.yml profile
  → if sprint_source: roadmap → calls Roadmap MCP to get active sprint
  → resolves output folder (e.g. docs/sprints/2026-Q4/)
  → runs pipeline stages, writing artifacts to resolved paths
  → Stage 4: spawns a Claude Code session with the retail-pxc profile baked in
  → that session runs the skills (add-orpc-procedure, add-route, etc.) to write code
```

---

## How to Run AIDLC Against This Repo

### Full autonomous pipeline
```bash
# From the AIDLC repo directory:
/sdlc --profile retail-pxc --ticket RPC-XXX
```
This reads the Jira ticket `RPC-XXX`, runs all 11 stages, and opens a PR.

### Planning only (no code, no Jira writes)
```bash
/sdlc --profile retail-pxc-plan --ticket RPC-XXX
```
Writes `stories.md`, `decisions.md`, `design.md` to the local output folder.

### Generate/update the profile
```bash
/profile-builder syndigo/retail-pxc
```
Introspects the repo and generates/updates `shared/profiles/retail-pxc.yml`.

---

## AIDLC Session Logs

Past AIDLC sessions for this repo appear in `aidlc/agents/sessions/` as `RPC-NNN-*.md` files. These are curated logs showing how AIDLC approached a specific ticket — useful context for understanding previous design decisions.

`GDI-NNNN-*.md` files are sessions for other repos (Global DevOps Infra and others) — ignore them for retail-pxc work.

---

## What AIDLC Needs From This Repo to Work Well

For AIDLC to write accurate code autonomously, the following must be in place:

| Need | Current State | Fix |
|------|---------------|-----|
| Platform profile | `retail-pxc.yml` exists | Keep updated as stack changes |
| Knowledge base | `.claude/knowledge/` exists | Run `knowledge-sync` after changes |
| CI pipeline | Not yet set up | `/cicd-configure` skill |
| Auth stub resolved | Stubbed | Wire real role fetch before Stage 8 AC verify |
| Recipes directory | Empty | Add cross-skill recipes as patterns emerge |

The more accurate and up-to-date the knowledge base is, the more accurately AIDLC will generate code that compiles and passes gates on the first attempt.
