---
name: i18n-sync
description: Audit translation keys across en/es/fr/de locale files — find missing keys, extra keys, and mismatched interpolation placeholders. Use before PRs, after merges, or whenever a translation looks suspicious at runtime.
---

# i18n Sync Audit

The four locale files in `apps/pxc-retail/src/locales/{en,es,fr,de}/translation.ts` must mirror each other:

- Every key path in `en` must exist in `es`, `fr`, `de`.
- Every `{{placeholder}}` in a string must appear identically across all four locales.
- No extra keys should exist in non-`en` locales (silent dead translations).
- Pluralization variants (`key`, `key_one`) must travel together.

The `TranslationSelector` type is the i18next `SelectorParam` derived from `en` (see `src/integrations/i18n/config.ts`), so missing keys in `en` show up at compile time when written as selector callbacks (`t($ => $.foo.bar)`). **Missing keys in `es/fr/de` are silent at compile time** — they only manifest as raw English fallbacks at runtime. That's the gap this skill closes.

## When to use

- Before opening a PR that touches any locale file.
- After merging a branch that may have added translations to only one locale.
- When debugging a "raw English string rendered in Spanish" report.
- When `tsc` complains about a `TranslationSelector` type mismatch.

## What to check

| # | Check | Why it matters |
|---|---|---|
| 1 | Every leaf key in `en` exists at the same path in `es`, `fr`, `de` | Missing = raw English fallback at runtime in that language |
| 2 | No extra leaf keys in `es`/`fr`/`de` that aren't in `en` | Dead translations the type system doesn't expose |
| 3 | `{{var}}` placeholders match across all four locales for each key | Missing placeholder = raw `{{var}}` rendered to the user |
| 4 | Pluralization variants (`key` + `key_one`) appear together in each locale | i18next falls back to the wrong form silently |
| 5 | All four files parse as valid TS (`as const`) | Trailing comma, unclosed quote, etc. |
| 6 | Literal string duplicates across different key paths, cross-checked in all four locales | Candidates to consolidate into `common` — but only if the wording is *actually* identical in es/fr/de too, not just en |

## How to run the audit

Drop this script into a one-shot Node call from the repo root. It reads the four `.ts` files, strips the wrapper, parses the object, and walks the trees.

```bash
node --experimental-strip-types - <<'EOF'
import en from './apps/pxc-retail/src/locales/en/translation.ts'
import es from './apps/pxc-retail/src/locales/es/translation.ts'
import fr from './apps/pxc-retail/src/locales/fr/translation.ts'
import de from './apps/pxc-retail/src/locales/de/translation.ts'

const PLACEHOLDER = /\{\{([^}]+)\}\}/g

type Leaf = { path: string; value: string }
function walk(obj: any, prefix: string[] = []): Leaf[] {
  const out: Leaf[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = [...prefix, k]
    if (v && typeof v === 'object') out.push(...walk(v, path))
    else if (typeof v === 'string') out.push({ path: path.join('.'), value: v })
  }
  return out
}

const sources = { en, es, fr, de }
const leaves = Object.fromEntries(
  Object.entries(sources).map(([k, v]) => [k, walk(v)]),
)
const keysByLocale = Object.fromEntries(
  Object.entries(leaves).map(([k, ls]) => [k, new Set(ls.map((l) => l.path))]),
)

const enKeys = keysByLocale.en
const valuesByLocale = Object.fromEntries(
  Object.entries(leaves).map(([k, ls]) => [
    k,
    new Map(ls.map((l) => [l.path, l.value])),
  ]),
)

let issues = 0
for (const locale of ['es', 'fr', 'de'] as const) {
  const missing = [...enKeys].filter((k) => !keysByLocale[locale].has(k))
  const extra = [...keysByLocale[locale]].filter((k) => !enKeys.has(k))
  if (missing.length) {
    console.log(`\n[${locale}] missing ${missing.length} key(s):`)
    missing.forEach((k) => console.log(`  - ${k}`))
    issues += missing.length
  }
  if (extra.length) {
    console.log(`\n[${locale}] extra ${extra.length} key(s) not in en:`)
    extra.forEach((k) => console.log(`  + ${k}`))
    issues += extra.length
  }
}

for (const [path, enValue] of valuesByLocale.en) {
  const enPlaceholders = new Set(
    [...enValue.matchAll(PLACEHOLDER)].map((m) => m[1].split(',')[0].trim()),
  )
  for (const locale of ['es', 'fr', 'de'] as const) {
    const value = valuesByLocale[locale].get(path)
    if (value === undefined) continue
    const localePlaceholders = new Set(
      [...value.matchAll(PLACEHOLDER)].map((m) => m[1].split(',')[0].trim()),
    )
    const dropped = [...enPlaceholders].filter((p) => !localePlaceholders.has(p))
    const extra = [...localePlaceholders].filter((p) => !enPlaceholders.has(p))
    if (dropped.length || extra.length) {
      console.log(`\n[${locale}] placeholder mismatch at "${path}":`)
      if (dropped.length) console.log(`  missing: ${dropped.join(', ')}`)
      if (extra.length) console.log(`  extra:   ${extra.join(', ')}`)
      issues++
    }
  }
}

console.log(`\n${issues === 0 ? '✓ in sync' : `✗ ${issues} issue(s)`}`)
process.exit(issues === 0 ? 0 : 1)
EOF
```

Run from the repo root (`C:\Code\pxc-retail`). Requires Node 22+ for `--experimental-strip-types`. If on older Node, use `pnpm dlx tsx` instead.

## Interpreting the output

```
[es] missing 2 key(s):
  - vendor.actions.archive
  - vendor.actions.archive_confirm

[fr] placeholder mismatch at "vendor.not_found":
  missing: id

✗ 3 issue(s)
```

For each finding:

1. **Missing in non-`en` locale** — copy the English string to the matching path in `es/fr/de` and translate it. Match the surrounding object structure exactly.
2. **Extra in non-`en` locale** — either it was a typo (rename to match `en`) or genuinely dead (delete it).
3. **Placeholder mismatch** — open the offending locale file, find the key, and restore the `{{var}}` token. Placeholder names are NOT translated — `{{id}}` stays `{{id}}` in German.

## Manual fixes

```ts
// en/translation.ts
vendor: {
  not_found: 'Vendor {{id}} could not be found.',
  archive: 'Archive',
  archive_confirm: 'Archive vendor {{name}}?',
}

// es/translation.ts — must mirror exactly
vendor: {
  not_found: 'No se pudo encontrar el proveedor {{id}}.',
  archive: 'Archivar',
  archive_confirm: '¿Archivar el proveedor {{name}}?',
}
```

If the user doesn't speak the target language, leave the English string with a `// TODO translate` comment and flag it so they know — better a visible TODO than a silent missing key.

## Pluralization

`i18next` resolves plurals via parallel keys:

```ts
employees_count: '{{count}} employees',         // default / plural
employees_count_one: '{{count}} employee',      // singular
```

Both forms must exist in every locale. The audit script treats `key_one` as a regular leaf — if `en` has `key` and `key_one` but `es` only has `key`, the script reports `key_one` as missing in `es`. That's correct — fix by adding `_one` to `es` too.

## Common-namespace consolidation (optional dedup pass)

Every locale file has a `common` object for generic, context-free UI chrome (`cancel`, `save`, `delete`, `add`, `apply`, `edit`, `previous`, `next`, `loading`, `filters`, `yes`, `searchPlaceholder`, `keyRequired`, `duplicateKey`, etc. — the exact set differs per app). Run this pass when the audit above turns up a lot of repeated English strings, or periodically to keep the file from re-accumulating duplicates. It is **not** part of the routine pre-PR sync check — only run it as a deliberate cleanup.

**The core risk: an English collision does not mean the other three locales collide too.** Two keys can both say `'Save'` in `en` while one is `'Enregistrer'` and the other is `'Enregistrer les modifications'` in `fr` — the English text hid a real distinction the French translator already made. Merging that pair into `common` silently overwrites one of them with the other's wording. This has happened in this repo: `pxc-retail`'s French `admin.featuresPanel.save`/`admin.rolesPanel.save` are the bare verb *"Enregistrer"* while `vendor.edit.save` is *"Enregistrer les Modifications"*; `tenant-management`'s German `actions.saving` splits into *"Wird gespeichert…"* (passive) vs *"Speichern…"* (bare) depending on context; and its Spanish `toast_save_error`/`toast_delete_error` pair splits into *"No se pudo guardar/eliminar"* vs *"Error al guardar/eliminar"*. All three looked like clean duplicates in English alone.

Extend the audit script with a duplicate-value detector that checks cross-locale agreement, not just the `en` collision:

```ts
// --- common-namespace candidates: en duplicates, verified against es/fr/de ---
function groupByValue(ls: Leaf[]) {
  const groups = new Map<string, string[]>()
  for (const { path, value } of ls) {
    if (!groups.has(value)) groups.set(value, [])
    groups.get(value)!.push(path)
  }
  return [...groups.entries()].filter(([, paths]) => paths.length > 1)
}

console.log('\n--- common-namespace candidates ---')
for (const [value, paths] of groupByValue(leaves.en)) {
  if (paths.every((p) => p.startsWith('common.'))) continue // already shared
  const agreesInLocale = (locale: 'es' | 'fr' | 'de') => {
    const vals = paths.map((p) => valuesByLocale[locale].get(p))
    return vals.every((v) => v !== undefined && v === vals[0])
  }
  const safe = (['es', 'fr', 'de'] as const).every(agreesInLocale)
  console.log(
    `\n"${value}" (${paths.length}×)${safe ? '' : '  ⚠ locale wording diverges — do NOT merge as-is'}`,
  )
  paths.forEach((p) => console.log(`  - ${p}`))
}
```

Before merging any flagged group into `common`:

1. **Judge relevance, not just text.** Exclude coincidences that aren't really the same concept — a table column header, a form field label, or an enum/permission-tier value (e.g. `rolesPanel.levels.delete` = the access level "Delete", not a delete action) that happens to share English text with an unrelated UI action. Only merge genuine generic UI chrome.
2. **Require the `safe` flag from the script above** — if any locale's values diverge within the group, either drop the divergent path(s) from the merge or leave the whole group alone. Never force one locale's existing wording onto another context to make the merge cleaner.
3. **Grep every call site** for each path being removed — including non-`t()` usages, like a raw key string handed to a `dynamicSelector`-based form validator (`'features.validation.key_required'` as a plain string, not `t($ => …)`). Missing one leaves a dead/broken key reference.
4. **One coordinated change**: add the key to `common` in all four locale files, remove it from its original location in all four, and repoint every call site — same discipline as the `ErrorKey` two-step change, just wider (4 files + N components instead of 1 contract + 4 files).
5. **Never hoist across apps.** `pxc-retail` and `tenant-management` each have their own independent `common` — even a byte-for-byte identical string in both apps' `en/translation.ts` is not a signal to share it via `@syndigo/app-shell` or any other cross-app package. Translations stay app-scoped so each app only ships the keys it uses and the set isn't capped by whatever the other app happens to need.
6. Run `pnpm typecheck --filter=<app>` after — it catches any call site still pointing at a now-deleted key.

## Verify

```bash
pnpm typecheck         # catches missing keys in en (used by TranslationSelector)
node --experimental-strip-types <audit script>   # catches drift across locales
pnpm test --filter=pxc-retail   # any locale-related tests
```

The audit script exits with code 1 on any issue — wire it into a pre-commit hook if drift becomes recurring.

## Checklist

- [ ] Ran the audit script — exit 0
- [ ] No missing keys reported for any of `es`/`fr`/`de`
- [ ] No extra dead keys in `es`/`fr`/`de`
- [ ] All placeholders match across locales
- [ ] `pnpm typecheck` passes (catches `en` issues + any `TranslationSelector` consumers)
- [ ] If consolidating into `common`: every merged key's value was verified identical in es/fr/de, not just en
- [ ] If consolidating into `common`: no cross-app sharing was introduced — each app's `common` stays independent

## Common mistakes

- **Adding a key only to `en`** because that's where the type derives from — types pass, runtime silently falls back to English in non-English sessions.
- **Translating the placeholder name** (`{{id}}` → `{{identifier}}` in German) — build passes, runtime renders raw `{{id}}` because i18next doesn't know what `identifier` is.
- **Renaming a key in `en` but not in `es/fr/de`** — leaves three dead keys plus three missing keys, doubling the issue count.
- **Deleting a key from `en` only** — leaves dead keys in the other three locales.
- **Adding a plural form (`key_one`) to `en` only** — non-English users see the plural form for singular counts.
- **Hand-editing JSON-style without trailing commas** — these are `.ts` files with `as const`. Use the same trailing-comma style as the rest of the file (oxfmt enforces it).
- **Merging a duplicate into `common` on the strength of the English text alone** — es/fr/de may have already drawn a distinction the English collision hides (see the divergent examples in the consolidation section above). Verify all three before merging, not just skim the `en` file.
- **Treating a matching field label, column header, or enum value as a `common` candidate** — `status`, `name`, `delete` (as a permission tier), etc. repeat across unrelated domains for good reason; only generic UI actions/chrome belong in `common`.
- **Proposing a shared translation module across `pxc-retail` and `tenant-management`** (e.g. via `@syndigo/app-shell`) — even when the strings are byte-for-byte identical in both apps. Translations are deliberately app-scoped; don't suggest hoisting them.
