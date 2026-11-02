---
name: update-loveable
description: Update the loveable submodule to the latest commit and produce a structured summary of UX changes for use as an implementation reference.
---

# Update Loveable Submodule

## Steps

1. **Capture old SHA**: `cd submodules/loveable && git rev-parse HEAD`
2. **Update**: `git submodule update --remote submodules/loveable`
3. **Get new SHA**. If unchanged, report "Already up to date" and stop.
4. **Get timestamps**: `git log --format="%H %ai %s" OLD NEW | grep -E "^(OLD_SHORT|NEW_SHORT)"` for both SHAs.
5. **Diff**: `git log --oneline OLD..NEW` and `git diff --name-status OLD NEW`
6. **Read changed `src/` files** (skip lock files, node_modules, config): `git diff OLD NEW -- <file>`
7. **Check pxc-retail implementation status**: for each changed loveable feature, search `apps/pxc-retail/src/` to determine if it is already implemented, a stub, or missing entirely.
8. **Produce summary** (see format below)
9. **Write summary** to `docs/loveable-updates/<YYYY-MM-DD>.md`
10. **Stage**: `git add submodules/loveable` — then ask user to confirm before committing

## Summary Format

```
# Loveable Update: OLD..NEW

| | SHA | Timestamp (UTC) | Message |
|---|---|---|---|
| **From** | `OLD_SHORT` | YYYY-MM-DD HH:MM:SS | <message> |
| **To**   | `NEW_SHORT` | YYYY-MM-DD HH:MM:SS | <message> |

---

## Commits
- <sha> <message>

## Changed Files
| File | Change | Domain |
|------|--------|--------|
| ...  | ...    | ...    |

---

## UX Changes by Domain

### <Domain>
- Layout, new/removed components, interactions, data shape

---

## Impacted pxc-retail Pages

| Loveable feature | pxc-retail route / file | Status |
|---|---|---|
| <feature> | <route or component path, or —> | **Already implemented** / **Stub only** / **Not implemented** — <one-line reason> |

---

## Implementation Notes
- API/schema changes needed
- Design-system component mappings required
- pxc-retail convention deviations
```

## Status values for "Impacted pxc-retail Pages"
- **Already implemented** — the feature exists and is functionally equivalent
- **Stub only** — the route/component exists but renders placeholder content
- **Not implemented** — no corresponding route or component exists
- **Not verified** — file exists but content was not inspected; note what to check

## Domain Map
`src/pages/` → page layout · `src/components/<domain>/` → domain component · `src/components/shared/` → shared · `src/components/layout/` → shell · `src/components/ui/` → primitive · `src/hooks/` → behavior

## Rules
- `submodules/loveable` is read-only reference — never modify it
- Do not run `pnpm install` inside the submodule
- Summary describes what changed in the diff; do not speculate about intent
- Always write the summary to `docs/loveable-updates/<YYYY-MM-DD>.md` (date = today)
