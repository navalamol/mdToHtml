# Local Development Setup

This guide focuses on getting a working local environment. For the conceptual overview, see `ONBOARDING.md`. For architecture details, see `docs/ARCHITECTURE.md`.

---

## Prerequisites

| Tool    | Required version | How to install                                         |
| ------- | ---------------- | ------------------------------------------------------ |
| Node.js | >= 24            | [nodejs.org](https://nodejs.org) or via nvm/fnm        |
| pnpm    | 11.x (pinned 11.10.0) | `corepack enable` — the repo uses corepack to pin it |
| Git     | any recent       | needed for submodule support                           |

Check your versions:

```bash
node -v      # must print v24.x.x or higher
pnpm -v      # must print 11.x.x
```

If `pnpm` is not found: run `corepack enable` and try again.

---

## Initial setup

```bash
# 1. Clone
git clone <repo-url> retail-pxc
cd retail-pxc

# 2. Pull the loveable submodule (optional — only needed for UX reference work)
git submodule update --init --recursive

# 3. Install all workspace dependencies
pnpm install
```

---

## Configure local environment — critical step

> **Skip this and both apps will fail on startup.** `pxc-retail` errors with `ENOTFOUND nginx` because its default `VENDOR_API_URL` points to a Docker container hostname. `tenant-management` errors with `Unauthorized` because the CSL service has no auth header.

Each app reads its configuration from a gitignored `.env.local` file in its own directory. The setup scripts create these files, pre-filling sensible defaults and prompting for the credentials you cannot guess.

### pxc-retail

```bash
node apps/pxc-retail/scripts/setup-env.mjs
```

The script prompts for:

| Prompt                          | What to enter                                     |
| ------------------------------- | ------------------------------------------------- |
| `AUTH_CLIENT_ID`                | Auth0 M2M client ID for the dev tenant — ask a teammate |
| `AUTH_CLIENT_SECRET`            | Corresponding secret — ask a teammate             |
| `CSL_ENTITY_SERVICE_AUTHORIZATION` | Bearer token for the CSL entity service — ask a teammate |
| `MARKETPLACE_TENANT_ID`         | Press Enter to accept the default UUID            |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | Leave blank unless you want local tracing (see Observability in README) |
| `ALLOW_DEV_FALLBACK_USER`       | `n` for `pnpm dev`; `y` only if you need `start:local` |

Everything else is pre-filled from `defaults` in the script:

| Variable           | Default written to .env.local                                |
| ------------------ | ------------------------------------------------------------ |
| `VENDOR_API_URL`   | `https://pxcretaildev.syndigo.com/api2/vendor-service/`      |
| `MDM_API_URL`      | `https://pxcretaildev.syndigo.com/api/`                      |
| `X_RDP_VERSION`    | `8.1`                                                        |
| `X_RDP_CLIENT_ID`  | `rdpclient`                                                  |
| `X_RDP_TENANT_ID`  | `pxcretaildev`                                               |
| `X_RDP_USER_ROLES` | `"admin"` (quoted string)                                    |
| `X_RDP_USER_ID`    | `pxcretaildev@syndigo.com`                                   |
| `VITE_APP_TITLE`   | `Retail PX Cloud`                                            |
| `CSL_ENTITY_SERVICE_URL` | `https://cxhapi-qa.edgenet.com/coreplatform/entity/`  |

### tenant-management

```bash
node apps/tenant-management/scripts/setup-env.mjs
```

The script prompts for:

| Prompt                               | What to enter                                  |
| ------------------------------------ | ---------------------------------------------- |
| `CSL_ONBOARDING_SERVICE_AUTHORIZATION` | Bearer token for the CSL onboarding service — ask a teammate |

Everything else defaults to the QA environment:

| Variable                    | Default                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `CSL_ONBOARDING_SERVICE_URL` | `https://cxhapi-qa.edgenet.com/api/enterprisedataplatform/`  |

### Writing .env.local manually

If you prefer not to use the interactive script, copy the `.env.example` file in each app directory and fill in the blanks:

```bash
cp apps/pxc-retail/.env.example apps/pxc-retail/.env.local
cp apps/tenant-management/.env.example apps/tenant-management/.env.local
# then edit the files
```

The `.env.example` files are committed and document every supported variable with inline comments.

### Updating credentials

Re-run the setup script at any time — it preserves existing values when you press Enter:

```bash
node apps/pxc-retail/scripts/setup-env.mjs
node apps/tenant-management/scripts/setup-env.mjs
```

---

## Running the apps

```bash
# Start all apps and packages in watch mode (Turbo TUI)
pnpm dev

# Or start individual apps
pnpm dev --filter=pxc-retail          # http://localhost:3000
pnpm dev --filter=tenant-management   # http://localhost:3001
```

---

## Verification checklist

After `pnpm dev` starts:

- [ ] Terminal shows no `ENOTFOUND nginx` errors
- [ ] Terminal shows no `Unauthorized` / `upstream.unauthorized` errors
- [ ] `http://localhost:3000` loads the pxc-retail app
- [ ] `http://localhost:3001` loads the tenant-management app
- [ ] No React error boundaries are triggered on page load
- [ ] Browser dev tools console shows no uncaught errors

If any of these fail, see the troubleshooting table below.

---

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `Error: getaddrinfo ENOTFOUND nginx` in console | `.env.local` missing in `apps/pxc-retail/` — default `VENDOR_API_URL` points to a Docker hostname | Run `node apps/pxc-retail/scripts/setup-env.mjs` |
| `ORPCError: Unauthorized` / `errorKey: 'upstream.unauthorized'` on tenant-management | `CSL_ONBOARDING_SERVICE_AUTHORIZATION` not set in `apps/tenant-management/.env.local` | Run `node apps/tenant-management/scripts/setup-env.mjs` and enter the CSL token |
| `ORPCError: Could not reach upstream service` on pxc-retail | `VENDOR_API_URL` or `MDM_API_URL` is wrong, or the dev environment is down | Verify the URL in `.env.local`; check if `pxcretaildev.syndigo.com` is reachable |
| TypeScript errors in `routeTree.gen.ts` | Route tree not regenerated after adding/removing a route file | Run `pnpm dev --filter=<app>` once; it regenerates `routeTree.gen.ts` automatically |
| TypeScript errors after a `git pull` | New packages added to the workspace | Run `pnpm install`, then `pnpm typecheck` |
| `command not found: pnpm` | corepack not enabled | Run `corepack enable`, then retry |
| `'auth-session' cookie not found` when running the built server | `NODE_ENV=production` + no platform session cookie | Add `ALLOW_DEV_FALLBACK_USER=true` to `.env.local`. Only valid for `start:local`; never in a deployed environment |
| `pnpm install` fails with peer dep errors | Node version too old | Verify `node -v` prints `v24.x.x` or higher |
| Blank page / route not found | Route tree stale after renaming a file | Run `pnpm dev --filter=<app>` to regenerate `routeTree.gen.ts` |
| `Missing required env variable: X` | T3 Env validation failed at boot | Add the variable to `.env.local`; see the `.env.example` for its description |

---

## Full environment variable reference

### apps/pxc-retail

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `VENDOR_API_URL` | yes | `http://nginx:8080/{tenantId}/api2/vendor-service/` (Docker default — override in .env.local) | Vendor service base URL. Must end with `/`. |
| `MDM_API_URL` | yes | `http://rdp-rest:8085/{tenantId}/api/` (Docker default — override in .env.local) | MDM API base URL. Must end with `/`. |
| `X_RDP_VERSION` | no | `8.1` | Forwarded as `x-rdp-version` header to upstream |
| `X_RDP_CLIENT_ID` | no | `rdpclient` | Forwarded as `x-rdp-clientId` |
| `X_RDP_TENANT_ID` | no | — | Forwarded as `x-rdp-tenantId`; set to `pxcretaildev` for local dev |
| `X_RDP_USER_ROLES` | no | `["admin"]` | Forwarded as `x-rdp-userRoles`; the default grants admin access in dev |
| `X_RDP_USER_ID` | no | `system` | Stand-in user ID when no real session is present |
| `AUTH_CLIENT_ID` | no* | — | Auth0 M2M client ID. *Required once you need real auth |
| `AUTH_CLIENT_SECRET` | no* | — | Auth0 M2M client secret |
| `CSL_ENTITY_SERVICE_URL` | no | `https://cxhapi-qa.edgenet.com/coreplatform/entity/` | CSL entity service base URL |
| `CSL_ENTITY_SERVICE_AUTHORIZATION` | no | — | Bearer token for CSL entity service |
| `CSL_ONBOARDING_SERVICE_URL` | no | `https://cxhapi-qa.edgenet.com/api/enterprisedataplatform/` | CSL onboarding service base URL |
| `CSL_ONBOARDING_SERVICE_AUTHORIZATION` | no | — | Bearer token for CSL onboarding service |
| `MARKETPLACE_TENANT_ID` | no | `5277ba0c-791a-4d7a-92ad-4e1bbe342154` | Tenant that owns the Syndigo marketplace catalog |
| `ALLOW_DEV_FALLBACK_USER` | no | — | Set to `true` only when running `start:local`. Never in deployed environments. |
| `ENABLE_BFF_STUBS` | no | — | Set to `true` to serve stub data from `*.mock.ts` files. For dev instances only. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | OTLP collector base URL. Tracing is disabled when unset. |
| `VITE_APP_TITLE` | no | `Retail PX Cloud` | Browser tab title |

### apps/tenant-management

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `CSL_ONBOARDING_SERVICE_URL` | no | `https://cxhapi-qa.edgenet.com/api/enterprisedataplatform/` | CSL onboarding service base URL |
| `CSL_ONBOARDING_SERVICE_AUTHORIZATION` | yes | — | Bearer token for CSL onboarding service. Missing = Unauthorized on every page load. |
| `ALLOW_DEV_FALLBACK_USER` | no | — | Same as pxc-retail — for `start:local` only |
| `ENABLE_BFF_STUBS` | no | — | Same as pxc-retail |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | Same as pxc-retail |
| `VITE_APP_TITLE` | no | `Tenant Management` | Browser tab title |

---

## Security notes

`.env.local` is listed in `.gitignore` and must never be committed. It may contain:

- Auth0 client secrets
- Service bearer tokens
- Internal API URLs

If you accidentally stage it, run `git reset HEAD apps/<app>/.env.local` before committing. If it was committed to a branch, rotate the credentials immediately and treat them as compromised.

The `.env.example` files are safe to commit — they contain only comments, placeholder values, and public defaults. Never put a real credential in `.env.example`.
