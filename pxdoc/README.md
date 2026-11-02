# pxc-retail

Monorepo for Syndigo's PXC (Product Experience Cloud) retail applications. Built with TypeScript, React, and the TanStack ecosystem.

## Overview

This monorepo contains the retail-facing PXC applications — the main retail app and a tenant-management app — along with shared packages for the application shell, design system components, type-safe RPC, and developer tooling configuration. A Lovable-generated submodule provides an AI-built retail interface that product integrates with as a push experience for agentic development context.

## Repository Structure

```
pxc-retail/
├── apps/
│   ├── pxc-retail/          # Main retail application (TanStack Start + React 19, port 3000)
│   └── tenant-management/   # Tenant onboarding + feature-set management (TanStack Start, port 3001)
├── packages/
│   ├── app-shell/           # Shared shell, permissions, navigation, i18n (@syndigo/app-shell)
│   ├── core-contracts/      # oRPC contracts + Zod schemas + inferred types (@repo/core-contracts)
│   ├── design-system/       # Component library (@syndigo/design-system, shadcn + @base-ui/react)
│   ├── orpc/                # Type-safe RPC implementations (@syndigo/orpc)
│   ├── telemetry/           # OTel SDK bootstrap, traces only (@syndigo/telemetry)
│   └── typescript-config/   # Shared TypeScript configurations (@repo/typescript-config)
└── submodules/
    └── loveable/            # Lovable-generated retail UI (git submodule)
```

## Tech Stack

| Category           | Technology                                         |
| ------------------ | -------------------------------------------------- |
| Language           | TypeScript 6                                       |
| Runtime            | Node.js >= 24                                      |
| Package Manager    | pnpm 11 (pinned 11.10)                             |
| Build Orchestrator | Turbo                                              |
| Bundler            | Vite 8                                             |
| Frontend           | React 19, TanStack (Router, Query, Form, Store)    |
| App shell          | @syndigo/app-shell (shell, permissions, nav, i18n) |
| Components         | @syndigo/design-system (shadcn + @base-ui/react)   |
| Styling            | Tailwind CSS 4 (OKLch color tokens)                |
| RPC                | oRPC (contract-first, isomorphic)                  |
| Auth               | hybrid RDP OAuth and local dev bearer token        |
| Validation         | Zod 4                                              |
| Testing            | Vitest                                             |
| i18n               | i18next (en, es, fr, de)                           |
| Observability      | OpenTelemetry (traces)                             |

## Getting Started

### Prerequisites

- Node.js >= 24
- pnpm 11+ (the repo pins `pnpm@11.10.0`; run `corepack enable` to use it)

### Install

```bash
pnpm install
```

### Configure local environment

Each app reads server config from its own gitignored `.env.local`. Generate it with the helper script — it pre-fills the dev defaults and prompts for the credentials that can't be defaulted (ask a teammate if you don't have them):

```bash
node apps/pxc-retail/scripts/setup-env.mjs
node apps/tenant-management/scripts/setup-env.mjs
```

Re-run any time to update credentials; existing values are preserved when you press Enter. Every supported variable is documented in the committed `apps/*/.env.example` files, which are the reference if you'd rather write `.env.local` by hand.

### Development

```bash
pnpm dev
```

Starts all apps and packages in development mode via Turbo.

### Build

```bash
pnpm build
```

### Other Commands

```bash
pnpm lint        # Lint all packages
pnpm format      # Format all files with Oxfmt
pnpm typecheck   # Type-check all packages
```

### Filtering

Run commands for a specific workspace:

```bash
pnpm dev --filter=pxc-retail
pnpm dev --filter=tenant-management
pnpm build --filter=@syndigo/design-system
```

## Observability

Both apps export **traces** over OTLP/HTTP. Metrics and logs are intentionally not wired up — the shared wiring in `@syndigo/telemetry` registers a trace exporter and nothing else, and each app's `instrumentation.mjs` is a thin wrapper that names the service. Prerequisite: Podman Desktop or other docker/podman installation.

### Local setup

Tracing is off unless you point it at a collector, so a plain `pnpm dev` never tries to export anything.

**1. Start the local backend.** `docker-compose.observability.yml` runs Grafana's LGTM image, which bundles an OTel Collector and Tempo behind a pre-provisioned Grafana:

```bash
docker compose -f docker-compose.observability.yml up -d

# Podman
podman compose -f docker-compose.observability.yml up -d

# Podman works too; neither `docker compose` nor podman-compose is required:
podman run -d --name pxc-otel-lgtm \
  -p 3100:3000 -p 4317:4317 -p 4318:4318 \
  -e GF_AUTH_ANONYMOUS_ENABLED=true -e GF_AUTH_ANONYMOUS_ORG_ROLE=Admin \
  docker.io/grafana/otel-lgtm:0.30.2   # keep in sync with the compose file
```

First start takes a minute or two. It's ready when the logs say `The OpenTelemetry collector and the Grafana LGTM stack are up and running`.

**2. Point the app at it** in `apps/<app>/.env.local`:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
ALLOW_DEV_FALLBACK_USER=true        # see below — required for the built server
```

`ALLOW_DEV_FALLBACK_USER` is what lets the app stand in for the platform
`auth-session` cookie, which isn't present locally. `pnpm dev` infers that from
`NODE_ENV=development`, but the built server runs as `production` even on your
laptop, so without this flag every request fails with `'auth-session' cookie not
found` — rendered as a 500 page. Never set it in a deployed environment; a real
session is required there.

**3. Run the built server.** Instrumentation is loaded via `node --import`, which only happens in the production server — **`pnpm dev` produces no traces**:

```bash
pnpm build --filter=pxc-retail
pnpm --filter=pxc-retail start:local
```

**4. Browse [http://localhost:3100](http://localhost:3100)** and go to Explore → Tempo.

### What you get

HTTP server and outbound fetch/undici spans, plus one span per oRPC procedure named after it (`vendorCentral.vendor.list`). Authed spans carry `enduser.id` + `app.tenant_id` from `spanAttributesMiddleware`.

Errors are attached to the span rather than to a log line. `errorRecordingMiddleware` records each escaping error once — `recordException`, `setStatus(ERROR)`, and `error.code` / `error.key` attributes — and `recordValidationError` adds `validation.*` attributes when a contract schema rejects a payload, which is the usual signature of upstream drift. The same trace ID is returned to the client in `ErrorPayload`, so a support ticket links straight to the trace.

There is no structured logger in the repo; server code that needs to print something uses `console.*`. If logs or metrics are wanted later, they are separate signals to add back to `startTelemetry` — not something to bolt onto the tracing path.

### Deployed environments

`OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) must be injected per environment via Argo CD / Kubernetes config in `global-devops-infra`. Nothing is hardcoded in this repo, and with no endpoint set the SDK never starts — so a missing value shows up as silence, not as errors. `OTEL_SDK_DISABLED=true` is the kill switch if tracing needs turning off without a rebuild.

## Submodules

The `submodules/loveable/` directory is a git submodule pointing to [syndigo/retail-pxcloud](https://github.com/syndigo/retail-pxcloud). This is a Lovable-generated retail interface that product uses as a push experience context for agentic development.

To initialize the submodule after cloning:

```bash
git submodule update --init --recursive
```

## Code Style

- No semicolons
- Single quotes
- Trailing commas
- Oxfmt + Oxlint enforced across all packages

## Internationalization (i18n)

All user-facing text must use i18next translations. The application supports four languages:

- **English** (en) - primary language
- **Spanish** (es)
- **French** (fr)
- **German** (de)

### Translation Files

Located at `apps/pxc-retail/src/locales/{lang}/translation.ts`

### Usage

**Frontend Components:**

```tsx
import { useTranslation } from "#/hooks/use-translation";

function MyComponent() {
  const { t } = useTranslation();
  return <p>{t(($) => $.errors.not_found)}</p>;
}
```

Translation keys are written as selector callbacks (`t($ => $.path.to.key)`), which i18next's `enableSelector: 'optimize'` mode checks at compile time. For keys that must be computed at runtime, use `dynamicSelector('foo.bar.baz')` from `#/integrations/i18n/config`.

**With Interpolation:**

```tsx
<p>{t(($) => $.vendor.display.employees_count, { count: 5 })}</p>
```

**With Number Formatting:**

```tsx
// In translation file: "{{count, number}} employees"
<p>{t(($) => $.path.to.key, { count: 1000 })}</p> // "1,000 employees"
```

**Pluralization:**

```tsx
// Define both forms in translation files:
// "key": "{{count, number}} items"        // plural/default form
// "key_one": "{{count, number}} item"     // singular form
<p>{t(($) => $.path.to.key, { count: items.length })}</p>
```

### Guidelines

- ✅ Always use translation keys for user-facing text
- ✅ Use interpolation for dynamic values
- ✅ Use `{{variable, number}}` for numeric values
- ✅ Define plural forms with `_one` suffix (singular), default key is plural
- ❌ Never hard-code text strings in components
- ❌ Never hard-code error messages in ORPC procedures
