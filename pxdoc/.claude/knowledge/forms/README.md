# Forms — Knowledge Base

**Modules owned:** `apps/*/src/components/**/use-*-form.ts`, `apps/*/src/components/**/*-schema.ts`, `packages/app-shell/src/components/UnsavedChangesGuard.tsx`, `apps/*/src/components/_shared/UnsavedChangesGuard.tsx`, components that call `useForm` directly (vendor profile dialogs, tenant-management feature/mapping/entitlement forms; full list in the registry)
**Entry points:** `useForm` (TanStack Form), `UnsavedChangesGuard`
**Last verified:** 2026-10-26 | commit `f57ed86` | branch `feature/RPC-135-document-management-core`

TanStack Form usage patterns across both apps. Larger forms (wizards, forms whose state is shared across sibling components) extract a `use-*-form.ts` factory that wraps `useForm`, plus a `*-schema.ts` for Zod validation and form ↔ API shape conversion. Self-contained forms and dialogs call `useForm` directly in the component. The shared `UnsavedChangesGuard` blocks navigation when a form has unsaved changes.

## Files

| Doc | Covers |
|---|---|
| `README.md` | scope, architecture, flow, patterns, reusable surface, related KB |
| `contracts.md` | factory hook signatures, guard props, schema shape samples |

## Scope

**In scope:** `useForm` factory pattern, `defaultValues` + Zod schema structure, dirtiness via `isDefaultValue`, submit-button disabled conditions, `UnsavedChangesGuard`, per-step wizard validation.
**Out of scope:** i18n for form labels (→ `PATTERNS.md`), route `beforeLoad` access guards (→ `permissions`), mutation error toasts on submit failures (→ `error-handling`).

## Architecture

| Layer | Module | Export | Responsibility |
|---|---|---|---|
| Form factory (optional) | `apps/*/src/components/**/use-*-form.ts` | `useXxxForm`, `XxxForm` type | Wraps `useForm`; owns `defaultValues` and `onSubmit` adapter |
| Schema | `apps/*/src/components/**/*-schema.ts` | Zod schemas, default-value objects, transform fns | Input validation; form ↔ API shape conversion |
| Guard (base) | `packages/app-shell/src/components/UnsavedChangesGuard.tsx` | `UnsavedChangesGuard` | Blocks route navigation when `when` is true via `useBlocker`; arms native `beforeUnload` |
| Guard (app) | `apps/*/src/components/_shared/UnsavedChangesGuard.tsx` | `UnsavedChangesGuard` (localized) | Supplies translated strings; exposes only `when` and `blockedSearchParams` to callers |

## Design Patterns

**Factory + derived type (when shared)** — extract a `useXxxForm` hook that returns the `useForm` instance when the form spans several components or wizard steps (e.g. `useBankingForm` in `BankingCard.tsx`, whose `BankingEditForm` child takes the form as a prop); a self-contained dialog or form can call `useForm` inline (e.g. `FeatureDefinitionForm.tsx`). A `type XxxForm = ReturnType<typeof useXxxForm>` alias is exported so sibling components accept the form as a prop without importing the hook.

**`isDefaultValue` for dirtiness, never `isDirty`** — `isDefaultValue` is a live deep-equality check that returns to `true` when the user restores the original value. `isDirty` latches on first change and never self-corrects without an explicit `form.reset()`. See `PATTERNS.md`.

**`form.Subscribe` for reactive reads** — always read `form.state.*` inside a `form.Subscribe` selector so only the subscribing subtree re-renders. Do not read `form.state` directly in the component body.

**Per-step validation in wizards** — call `form.validateField(name, 'change')` for each field in the current step and gate the "Next" button on all calls returning empty-error arrays. A single flat `useForm` instance spans all wizard steps; `stepFieldNames` maps step numbers to their field keys.

**Action dialogs are the exception to the submit gate** — a dialog whose submit runs an action on its default values rather than saving edits (`DownloadAuditHistoryDialog`: export with default filters) disables submit only while the mutation is pending, not on `isDefaultValue`. Saving dialogs keep the full gate in `contracts.md`.

**Two-phase submit with an acknowledgement dialog** — for forms with soft (non-blocking) warnings after hard validation passes (`AddressDialog`, `ContactDialog`). In `onSubmit`: (1) run hard rules and return on violations via `applyIssuesToFields`; (2) collect soft warnings → stash the pending save, open the warnings dialog. The dialog has a checkbox and an "Ignore & save" button gated on the checkbox; "Fix issues" clears the pending save and closes. The rule functions live in a pure, unit-tested sibling module — `validateAddressRules`/`computeAddressWarnings` for addresses, and `contact-validation.ts` (`findDuplicateEmail` as the CT-004 hard block, `collectContactWarnings` for the CT-005/CT-014 soft set) for `ContactDialog`. Two minor variants of stashing the pending save coexist: `AddressDialog` stores the mutation callback in a `useRef`; `ContactDialog` stores the normalized values in `useState` and calls a `persist(values)` helper. Reuse this pattern for any future acknowledgement-gated save. **Inline variant** — `DocumentUploadDialog` (vendor document upload / new-version) keeps the warnings inline rather than in a separate dialog: a `form.Subscribe` on the file renders a warnings panel with an `acknowledge` checkbox when a duplicate filename is detected (DC-002), and the submit button is gated on `warnings.length === 0 || acknowledge`. Its hard rules (DC-001/004–006/010–017, including the type-specific CoI / FDA / GFSI / W-9 fields chosen by `documentType` and rendered via a `form.Subscribe` on it) run in a local `validate()` on submit through `applyIssuesToFields`; the Zod resource schema lives in `@repo/core-contracts` (`TenantVendorDocumentSchema`), not a local `*-schema.ts`.

**Save-time validation with an error summary** — the single Banking profile (`BankingCard`, card-level edit, not the page `EditModeProvider`) validates on Save rather than per-field blur: it runs `validateBankingRules` on the form values, applies per-field errors via `applyIssuesToFields`, shows an error-count toast (`"N errors must be fixed before saving"`) and focuses the first invalid field. Account Number and Tax ID are write-only — blank means "leave blank to keep ••••NNNN" and skips their rules (`accountNumberRequired` / `taxIdRequired`). Soft warnings (BK-002/004/015) reuse the acknowledgement dialog via `BankingWarningsDialog`. A validation-state banner shows "All banking details passed validation" / "Bank details failed validation" (no AI — the prior "verified by AI" wording was withdrawn). **INTERIM**: these rules move server-side under RPC-150.

**Blur validation with cross-field rules** — when a form has multi-field validation logic (e.g. `validateAddressRules` checks addressType together with both street lines), add `validators.onBlur` to each validated field. The blur validator reads `fieldApi.form.state.values` to access sibling field values and returns the translation key of the first matching violation, or `undefined` when clean. Errors only surface once a field is touched: `fieldError` (in `field-utils.ts`) gates on `field.state.meta.isTouched`, so `onBlur` alone is sufficient — no `onChange` guard is needed to suppress errors on untouched fields. When one field's value affects another field's rules (e.g. addressType affects the PO Box check on both street lines), call `void form.validateField('fieldName', 'blur')` inside the first field's `onValueChange` so the dependent fields re-evaluate without marking them as touched artificially.

## Flow

| Hop | Condition | Envelope | Mutates |
|---|---|---|---|
| Component mounts | always | `useXxxForm` returns instance; `isDefaultValue: true`, guard off, submit disabled | no |
| User edits a field | value ≠ default | `isDefaultValue → false`; guard arms; submit enabled if also valid | form state |
| User restores original value | value === default | `isDefaultValue → true`; guard disarms; submit disabled | form state |
| User clicks submit | `!isDefaultValue && isValid && !isSubmitting` | `form.handleSubmit()` → `isSubmitting: true`; submit disabled | form state |
| `onSubmit` resolves | success | mutation fires; caller resets form or remounts with new defaults | form state |
| User navigates away dirty | `when === true` | guard dialog: "Keep" → `guard.reset()` (stay); "Discard" → `guard.proceed()` (navigate) | router |

## Reusable Components

| Export | From | Use |
|---|---|---|
| `UnsavedChangesGuard` | `apps/*/src/components/_shared/UnsavedChangesGuard.tsx` | Render inside the form; pass `when={canEdit && !form.state.isDefaultValue}` |
| `DateRangeField` | `apps/pxc-retail/src/components/vendor/_shared/forms/DateRangeField.tsx` | `Popover` + `Calendar(mode="range")` date-range input; pass `disabled={{ after: today }}`-style clamps through props |
| Base `UnsavedChangesGuard` | `packages/app-shell/src/components/UnsavedChangesGuard.tsx` | Starting point for a new app's guard wrapper; supply translated label props |

## Related KB

- `error-handling` — mutation error toasts on submit failures; `meta.errorToast` for per-mutation suppression or override
- `permissions` — route `beforeLoad` access guards that block the page before the form renders; separate from the unsaved-changes guard

## Last verified

2026-10-26 | commit `f57ed86` | branch `feature/RPC-135-document-management-core`
