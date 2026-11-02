# Deploying retail-pxc — the GitOps model

This is the deployment model for retail-pxc. It's new, and it's different from a
"CI runs kubectl" pipeline, so this doc explains **what happens on merge**, **why the
app repo never touches the cluster**, and **how to promote to higher environments**.

> TL;DR — you merge to `main`; a container image is built and pushed; Argo CD (not
> this repo) deploys it. You never run `kubectl`. Higher environments are reached by
> **promoting the same image**, never by rebuilding.

## The split: this repo builds, Argo CD deploys

```
  ┌─────────────────────── retail-pxc (this repo) ───────────────────────┐
  │  merge to main                                                        │
  │      │                                                                │
  │      ▼   .github/workflows/deploy.yml                                 │
  │  build image  ──push──►  retailpxcacr.azurecr.io/retail-pxc:dev-<sha> │
  │      │                                                                │
  │      ▼   repository_dispatch (app-deploy)                             │
  └──────┼────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌─────────────────── global-devops-infra ──────────────────────────────┐
  │  deploy-dispatch.yml  ──►  rewrites gitops/.../pxc-retail/values.yaml  │
  │                            (image.tag = dev-<sha>)  ──►  opens a PR    │
  │                            (auto-merges for dev)                       │
  └──────┼────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌─────────────────── Argo CD (in the AKS cluster) ──────────────────────┐
  │  watches gitops/ → sees the new tag → syncs the Deployment            │
  └───────────────────────────────────────────────────────────────────────┘
```

### Two apps, two deploy workflows

This monorepo ships two apps, each with its own image repository in the same ACR and
its own deploy workflow. They are identical in shape — the diagram above describes
both; only the names change:

| App | Workspace | Deploy workflow | Image repository | `promote.yml` `app=` |
|-----|-----------|-----------------|------------------|----------------------|
| pxc-retail | `apps/pxc-retail` | `deploy.yml` | `retailpxcacr.azurecr.io/retail-pxc` | `retail-pxc` |
| tenant-management | `apps/tenant-management` | `deploy-tenant-management.yml` | `retailpxcacr.azurecr.io/tenant-management` | `tenant-management` |

Neither deploy workflow has a `paths:` filter: every merge to `main` rebuilds and
redeploys both apps, so the `dev` environment always runs two images built from the
same commit. Both use the repo root as the Docker build context
(`docker build -f apps/<app>/Dockerfile … .`) because the build needs the workspace
lockfile and the shared `packages/`.

**This repo contains zero Kubernetes manifests, zero Helm charts, zero cluster
credentials, and never runs `kubectl` or `helm`** (Syndigo standard D-012 S-012.5).
The only thing it does is build an image, push it, and send a `repository_dispatch`.
Everything about *how* the app runs on the cluster — replicas, probes, secrets,
ingress — lives in `global-devops-infra`:

- Infra (cluster, Key Vaults, workload identity): `azure/edgeaq/eng-dev/retailpxc-nonprod*/`
- The Helm chart every service shares: `gitops/charts/microservice/`
- This service's per-env values: `gitops/azure/retailpxc-nonprod/retailpxc-<env>/pxc-retail/`

Why this way? Argo CD continuously reconciles the cluster to what's in Git — so the
cluster can't drift, a bad deploy is reverted by reverting a commit, and app-repo CI
never holds the keys to production. (The org standard behind this is S-012.9 in
`global-devops-infra/standards/devops/infrastructure-as-code-stacks.md`.)

## Branches vs environments (read this — it's the surprising part)

retail-pxc is trunk-based on `main` — no `dev`/`stage` branches, and `dev/<user>/<feature>`
is already an established branch *prefix*, which means a branch literally named `dev`
couldn't exist here anyway (Git can't have both `refs/heads/dev` and `refs/heads/dev/...`).

This isn't a deviation from the org standard — it's one of the two patterns the standard
recognizes as compliant (D-003 §S-003.7: `main` is the only required branch; `dev`/`stage`
are optional per-product choices, not a requirement). retail-pxc is in fact cited as the
reference implementation for the trunk-based pattern in D-007 §S-007.10's promotion model,
and this repo's `deploy.yml`/`promote.yml` are what the `cicd-configure` skill's Silver
templates are now modeled on. So we map it like this, by design:

| Git | Deployment |
|-----|------------|
| feature branch → PR → merge to **`main`** | auto-deploys to the **`dev`** environment |
| `promote` (dev → qa) | qa environment |
| `promote` (qa → uat) | uat environment |
| `promote` (uat → prod) | prod environment |

`main` is the trunk *and* the source of every environment. The environments are
`dev` / `qa` / `uat` / `prod` (matching the EdgeAQ convention, e.g. pcc-self-service) —
they are **not** git branches. Promotion is an explicit action, not a merge.

The coverage gate in `ci.yml` still reads branch names for its thresholds; on `main`
that resolves to the 90% (prod-grade) bar, which is the right floor for a trunk that
feeds every environment.

## Promotion — build once, promote many

`.github/workflows/promote.yml` (manual, `workflow_dispatch`) moves an image up one
environment by **retagging the exact same digest** — `az acr import` onto the same
registry, which copies the manifest by digest and cannot rebuild. So the artifact that
reaches prod is bit-for-bit the one that passed dev and qa.

One workflow promotes both apps. Its **first input is `app`** (required, a choice of
`retail-pxc` / `tenant-management`) and it drives both `IMAGE_REPOSITORY` and the
`app` field of the dispatch payload — so promoting is per-app, and promoting both means
running the workflow twice. The four inputs are:

| Input | Value |
|-------|-------|
| `app` | `retail-pxc` or `tenant-management` — which image repository to retag |
| `source_env` | environment to promote **from** (`dev` / `qa` / `uat`) |
| `target_env` | environment to promote **to** (`qa` / `uat` / `prod`) — must be exactly one step up; the workflow rejects skips |
| `source_sha` | full 40-char git SHA, i.e. the `<sha>` in `<source_env>-<sha>` |

Because both apps are built from every commit, the same `source_sha` is normally valid
for both — promote them with the same SHA to keep an environment on one commit.

```
dev-<sha>  ──promote──►  qa-<sha>  ──promote──►  uat-<sha>  ──promote──►  prod-<sha>
   (same image digest the whole way — only the tag changes)
```

Gates on promotion:
- **GitHub Environment reviewer gate** — the `promote` job runs in the target
  environment, so configuring required reviewers on the `qa`/`uat`/`prod` GitHub
  Environments makes a human approve each step.
- **Argo sync gating (infra side)** — for `uat`/`prod`, the values PR in
  global-devops-infra stays open for a reviewer and Argo does not auto-sync (S-012.9).
  For `dev`/`qa`, it auto-merges and auto-syncs.

## Health endpoints

The Helm chart wires two probes to routes served by this app:

- **`/health`** (liveness) — "is the process alive?" Reports only on this process;
  deliberately does not touch upstreams, so an upstream outage can't cause a restart
  loop. `apps/pxc-retail/src/routes/health.ts`.
- **`/deep-health`** (readiness) — reports upstream reachability as **diagnostics**
  but still returns `200` when an upstream is down (with `degraded: true`). Gating
  readiness on upstreams would pull every replica out of the Service at once and turn
  a partial degradation into a total outage — and would deadlock bring-up while the
  cluster has no private path to the internal RDP/MDM services yet.
  `apps/pxc-retail/src/routes/deep-health.ts`.

`/metrics` is intentionally **not** added yet — the app already exports telemetry via
OpenTelemetry (OTLP), nothing scrapes Prometheus in this cluster, and `prom-client`
isn't a dependency. Adding an OTel metrics exporter vs. a Prometheus endpoint is a
deliberate decision for the app team, tracked as a follow-up rather than shipped as an
unscraped stub.

## Prerequisites this PR does NOT create (need org/DevOps action)

These require privileges the author doesn't have; the workflows reference them but
can't run until they exist:

1. **ACR push identity** — an Azure workload identity / App Registration with
   `AcrPush` on `retailpxcacr`, federated to this repo's GitHub Actions OIDC. Provides
   the `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` secrets.
2. **Cross-repo dispatch app** — `DISPATCH_APP_ID` / `DISPATCH_APP_PRIVATE_KEY` for a
   GitHub App installed on `global-devops-infra` with `repository_dispatch`. (The same
   pattern the org already uses for its other deploy-dispatch apps.)
3. **GitHub Environments** `qa` / `uat` / `prod` with required reviewers (for the
   promotion gate).
4. **Real secrets** — `auth-client-secret` and `csl-entity-service-authorization` in
   each env's Key Vault (`kv-<env>-usc-retailpxc`). Dev currently holds obvious
   placeholders; real values must come from whoever owns the Auth0 / CSL integrations.

Until (1) and (2) exist, `deploy.yml` will fail at the Azure login / dispatch steps —
by design; it's wired correctly and waiting on the identities.
