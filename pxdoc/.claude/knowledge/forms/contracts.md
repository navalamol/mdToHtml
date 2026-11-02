# Forms — Contracts & Samples

**Last verified:** 2026-10-19 | commit `74782bc` | branch `feature/RPC-89-activity-log-tracker`

## Contracts & Signatures

### `useXxxForm` factory pattern

```ts
// apps/*/src/components/**/use-*-form.ts
function useXxxForm(options: UseXxxFormOptions): FormApi<XxxFormValues>

// Derived type exported alongside the hook:
type XxxForm = ReturnType<typeof useXxxForm>
```

Every form hook passes `defaultValues` and an `onSubmit` adapter to `useForm`. The adapter transforms the flat form values to the API's expected shape before calling the mutation.

### `UnsavedChangesGuard` props (app wrapper)

```ts
// apps/*/src/components/_shared/UnsavedChangesGuard.tsx
interface UnsavedChangesGuardProps<TSearch extends Record<string, unknown> = never> {
  when: boolean
  blockedSearchParams?: [TSearch] extends [never] ? never : (keyof TSearch & string)[]
}
```

The base component in `packages/app-shell` additionally requires `title`, `description`, `keepLabel`, and `discardLabel` — the app wrapper supplies localized strings for those automatically.

### Submit-button disabled conditions

Three conditions must all be false to enable submit:

```ts
disabled={isSubmitting || isDefaultValue || !isValid}
```

Read via `form.Subscribe` selector, not directly from `form.state`:

```tsx
<form.Subscribe selector={(s) => ({ isSubmitting: s.isSubmitting, isDefaultValue: s.isDefaultValue, isValid: s.isValid })}>
  {({ isSubmitting, isDefaultValue, isValid }) => (
    <Button disabled={isSubmitting || isDefaultValue || !isValid}>Save</Button>
  )}
</form.Subscribe>
```

### Sample: multi-step wizard schema structure

Source: `apps/pxc-retail/src/components/vendor/onboarding/onboarding-schema.ts`

Single flat `useForm` instance, per-schema defaults merged:

```json
{
  "addressLine1": "",
  "addressLine2": "",
  "city": "",
  "stateProvince": "",
  "postalCode": "",
  "countryCode": "",
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "legalName": "",
  "website": "",
  "bankName": "",
  "accountType": "checking",
  "accountNumber": "",
  "routingNumber": "",
  "taxId": "",
  "paymentTerms": "NET30",
  "currency": "USD",
  "invoiceMethod": "electronic",
  "termsAccepted": false,
  "privacyAccepted": false,
  "accuracyCertified": false
}
```

`stepFieldNames` maps step → field keys for per-step `form.validateField` calls:

```json
{
  "1": ["addressLine1", "addressLine2", "city", "stateProvince", "postalCode", "countryCode", "firstName", "lastName", "email", "phone", "legalName", "website"],
  "2": [],
  "3": ["bankName", "accountType", "accountNumber", "routingNumber", "taxId", "paymentTerms", "currency", "invoiceMethod"],
  "4": ["termsAccepted", "privacyAccepted", "accuracyCertified"]
}
```

## Config / Forks

| Setting / Flag | Lookup | Values | Behavior |
|---|---|---|---|
| `UnsavedChangesGuard.when` | prop | `true` / `false` | `true` → `useBlocker` activates; navigation to any other pathname is intercepted. `false` → guard is off; navigation proceeds freely. Pass `canWrite && !form.state.isDefaultValue` in read-only contexts so the guard never fires for view-only users. |
| `UnsavedChangesGuard.blockedSearchParams` | prop | omitted / `string[]` | A pathname change always triggers the dialog, whether or not this is set. Omitted → same-path search changes never trigger it. Provided → a same-path search change triggers it only when one of those keys changes. Used on pages with tab-style search-param navigation where only specific param changes mean unsaved work would be lost. |
| `form.validateField(name, 'change')` | per-step wizard | called per step field | Per-step validation; does not validate other steps' fields. Gate "Next" on all calls returning `[]`. The full form's `isValid` reflects all Zod constraints across every step. |
