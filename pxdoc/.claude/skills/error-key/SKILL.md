---
name: error-key
description: Add a new BFF ErrorKey literal and the matching errors.<key> string to all four locale files (en/es/fr/de) atomically. Use when introducing a new throwError variant or whenever tsc complains that an errorKey isn't a valid TranslationSelector.
---

# Add Error Key

The BFF discriminates error variants by stable `<domain>.<reason>` keys. Adding one is a two-file-set change — the literal in core-contracts AND a matching entry in every locale. Skip either side and `tsc` fails.

## Why both sides are mandatory

`apps/pxc-retail/src/lib/error-toast.ts` declares:

```ts
function toTranslationSelector(key: ErrorKey): TranslationSelector {
  return dynamicSelector(`errors.${key}`)
}
```

`dynamicSelector` builds a runtime selector — it does not enforce the path at compile time (that's the trade-off for accepting a `string`). The link is enforced **at runtime**: a missing `errors.<key>` resolves to `undefined` and the toast falls back to the raw key. Therefore: do not add an `ErrorKey` literal without adding the matching locale entry, or the toast will render `errors.vendor.archive_blocked` literally to the user.

Static call sites that don't go through `toTranslationSelector` (e.g. `t($ => $.errors.something_went_wrong)` in `error-toast.ts`) ARE checked at compile time by the i18next selector type.

## Required inputs (ask if not provided)

1. **Key name** — `<domain>.<reason>`, snake_case reason. Examples: `vendor.not_found`, `attribute.entity_create_failed`. Do NOT prefix with `errors.` (the client applies that).
2. **English message** — the actual sentence. Use `{{paramName}}` for interpolation.
3. **Interpolation params** (if any) — list the variable names used in the message.
4. **Translations for es / fr / de** — ask the user, or offer to translate (they should review).

## Files to touch (all four required)

```
packages/core-contracts/src/types/error-key.ts    # add literal to the union
apps/pxc-retail/src/locales/en/translation.ts     # add errors.<domain>.<reason>
apps/pxc-retail/src/locales/es/translation.ts     # add same path
apps/pxc-retail/src/locales/fr/translation.ts     # add same path
apps/pxc-retail/src/locales/de/translation.ts     # add same path
```

## Step-by-step

### 1. Add the literal (`packages/core-contracts/src/types/error-key.ts`)

The file groups keys by domain via comments. Slot new keys under the matching domain or add a new domain block.

```ts
export type ErrorKey =
  // ...existing
  // Vendor domain
  | 'vendor.not_found'
  | 'vendor.create_missing'
  | 'vendor.archive_blocked'   // ← new
```

### 2. Add the string to ALL four locales

Each locale file has the same nested shape under `errors`. The path must exactly mirror the key — `vendor.archive_blocked` → `errors.vendor.archive_blocked`.

**English** (`apps/pxc-retail/src/locales/en/translation.ts`):

```ts
errors: {
  // ...
  vendor: {
    not_found: 'Vendor {{id}} could not be found.',
    create_missing: 'The vendor could not be created. Please try again.',
    archive_blocked: 'Vendor {{id}} cannot be archived while active orders exist.',
  },
}
```

Repeat the same path with the same `{{interpolation}}` placeholders in `es`, `fr`, `de`. **Placeholder names must match across all four files** — `{{id}}` in English MUST be `{{id}}` (not `{{identifier}}`) in German.

### 3. Verify

```bash
pnpm typecheck
```

Type-check is necessary but not sufficient — `dynamicSelector('errors.${key}')` accepts any string at compile time. Smoke-test the toast for the new key in the running app to confirm the locale entry resolves (raw `errors.vendor.archive_blocked` rendered in the toast = the locale entry is missing in that language).

## Naming conventions

- **Format**: `<domain>.<reason>` — snake_case for both parts.
- **Domain**: matches the contract domain or a logical grouping (`vendor`, `attribute`, `role`, `auth`, `upstream`). Reserve `upstream.*` for keys emitted by `mapUpstreamError` — handler code should not emit `upstream.*` directly.
- **Reason**: a noun-phrase describing the variant — `not_found`, `create_missing`, `update_failed`, `archive_blocked`. Avoid generic suffixes like `error` (every key is an error).
- **Status code** is independent of the key. Two keys can share a status code (`vendor.not_found` and `role.not_found` are both `NOT_FOUND`) — that's the whole point of the discriminator.

## Translation guidance

- Keep messages short and user-facing — these render as toast titles, not log lines.
- Match the tone of existing entries in each locale (formal "Sie" in German, etc.).
- Always include the same interpolation placeholders. Missing `{{id}}` in one locale means an untranslated raw ID will appear in that language.
- If you don't speak the target language, ask the user or use a placeholder English string with a `// TODO translate` comment — but flag it so the user knows.

## Checklist

- [ ] Literal added to `ErrorKey` union in correct domain block
- [ ] English `errors.<key>` added at the correct nested path
- [ ] Spanish, French, German entries added at the same path
- [ ] Interpolation placeholders identical across all four locales
- [ ] `pnpm typecheck` passes

## Common mistakes

- Adding the literal but forgetting one locale → runtime toast renders `errors.<domain>.<key>` literally in that language.
- Path mismatch — e.g. `vendor.notFound` literal but `errors.vendor.not_found` string.
- Different placeholder names across locales (build passes, runtime renders raw `{{id}}`).
- Including the `errors.` prefix in the `ErrorKey` literal (it's a client convention only).
- Putting `upstream.*` keys in handler `throwError` calls — those are reserved for the upstream-error mapper.
