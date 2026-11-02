# React Rewrite: AttributeManage, AttributeList, AttributeItem

## Source Repository

> **At the start of any session working on this rewrite, ask the user for the path to the `ui-platform-business-components-v2` checkout** — e.g. "What's the local path to the ui-platform-business-components-v2 repo?"

Key files to read once the path is known:
- `<root>/src/elements/rock-attribute-manage-v2/rock-attribute-manage-v2.js` — 4,279 lines
- `<root>/src/elements/rock-attribute-list-v2/rock-attribute-list-v2.js` — 3,507 lines
- `<root>/src/elements/rock-attribute-v2/rock-attribute-v2.js` — 5,034 lines
- `<root>/src/helpers/` — DataRequestHelper, DataTransformHelper, DataHelper, ReferenceEntityHelper

---

## Target Location

This rewrite lives directly in the **`apps/pxc-retail`** app under:

```
apps/pxc-retail/src/components/attribute-manager/
  types.ts
  context/
  components/
    AttributeManage/
    AttributeList/
    AttributeItem/
  test/
```

No separate package — it is co-located app code, not a publishable library. Conventions:
- Inherits pxc-retail's TypeScript config, ESLint config, and Vitest setup
- Import via the `#/` alias: `import { AttributeManage } from '#/components/attribute-manager/...'`
- Consumes `@syndigo/design-system/components/*` for UI primitives

---

## Context

These three LitElement web components form the core attribute editing UI in the Riversand MDM platform. They are being rewritten in React inside the retail-pxc monorepo. No LitElement infrastructure, no Polymer/RUF managers. The goal is to replicate all behaviors (attribute display/edit, validation, save/revert, grouping, filtering, AI features, dependent attributes, conflict resolution) using idiomatic React with modern tooling.

**Stack decisions:** TypeScript + Tailwind, TanStack Query + fetch, useReducer + Context for state, `@syndigo/design-system` (shadcn/base-nova preset) for UI primitives.

**Architecture notes:**
- **AttributeLov is layered.** The reusable UI lives in `@syndigo/design-system` (`SearchableCombobox` — generic search-driven combobox built on base-ui Combobox + `ComboboxVirtualList`). The TanStack-Query wiring (debounce, open-gated fetch, page flattening) lives in `apps/pxc-retail/src/components/query-combobox.tsx` (`QueryCombobox`). Domain glue (`RefEntity` ↔ `NormalizedAttributeValue` adapters, `AttributeManageContext` dispatch, oRPC procedure) stays in `AttributeLov.tsx`. The same `QueryCombobox` is reusable for any other "click → search server-side → pick" pattern in the app.

---

## What These Components Do

### rock-attribute-manage-v2 (orchestrator)
- Fetches entity data and composite attribute models via REST API on context change
- Manages the full edit lifecycle: dirty state → sync validation → save → post-save refresh
- Handles attribute conflict detection (server auto-updates vs. user changes)
- Owns the save/cancel bar visibility and DQS (Data Quality Score) dirty state signaling
- Triggers AI content generation and content translation workflows
- Checks for duplicate entities before save (when `checkDuplicatesOnUpdate` is set)

### rock-attribute-list-v2 (presentational grouping layer)
- Groups attributes by `groupName` into collapsible panels
- Renders each attribute via `rock-attribute-v2` in a 1–3 column grid or PDP layout
- Handles virtual scrolling for large attribute lists (`attributesChunkLength` threshold)
- Accumulates client-side and server-side validation errors, tracks error counts per group
- Manages dependent attribute updates when source attribute values change
- Supports filtering: by attribute names, search text, empty values, content-gen filters

### rock-attribute-v2 (individual attribute input)
- Renders a single attribute input appropriate to its `dataType` + `displayType`
- Supports view and edit modes, with inline mode switching
- Shows validation errors, revert icon, history icon, clear icon
- Handles locale-aware display (coalesced values from other locales/contexts)
- Handles reference attribute lookups (LOV with search and pagination)
- Supports marketplace source display, AI suggestion highlighting, image analysis integration
- Fires `attribute-value-changed` events that bubble up through the list to the manage component

---

## TypeScript Types

> The raw Riversand API shapes are complex (see the lit source). Below are the **normalized types** we actually use in `packages/attribute-manager/src/types.ts`. They strip Riversand-specific metadata and flatten the value structure for React consumption.

### AttributeModelProperties

```typescript
type AttributeDataType = 'string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'nested' | 'deeplynested'

type AttributeDisplayType = 'textbox' | 'textarea' | 'richtexteditor' | 'dropdown' | 'boolean'
  | 'date' | 'datetime' | 'referencelist' | 'path' | 'nestedgrid' | 'address'

type AttributeModelProperties = {
  name: string
  externalName: string
  dataType: AttributeDataType
  displayType?: AttributeDisplayType
  isLocalizable?: boolean
  isCollection?: boolean
  readOnly?: boolean
  required?: boolean
  groupName?: string
  referenceEntityTypes?: string[]
  allowedValues?: Array<{ id: string; value: string }>       // dropdown options
  nestedAttributes?: AttributeModelProperties[]              // nested grid children
  // UOM — populated on numeric attributes that carry a unit of measure
  uomEntityInfo?: Array<{ uomEntityType: string }>
  uomAllowedUnitSymbols?: string[]
  defaultUom?: string
  // Deeply-nested children — array of records keyed by child attribute name.
  // Children may themselves be `deeplynested`, hence the recursion. The Zod
  // schema uses `z.lazy` + an explicit `z.ZodType<AttributeModelProperties>`
  // annotation, because Zod can't infer output types of recursive schemas.
  group?: Array<Record<string, AttributeModelProperties>>
  properties?: Record<string, unknown>
}
```

### NormalizedAttributeValue (runtime value)

```typescript
type NormalizedAttributeValue = {
  locale: string
  source: string
  value: unknown
  uom?: string | string[]
  referenceDataId?: string | string[]
  properties?: Record<string, unknown>
  action?: 'delete'
}
```

### GovernMessage

```typescript
type GovernMessage = {
  messageCode: string
  messageType: 'error' | 'warning' | 'info'
  attributeName?: string
  message?: string
  // Path to the offending cell inside a deeply-nested attribute. Alternates
  // row-index (number) and child attribute name (string), root-to-leaf.
  // Empty / omitted for flat attributes.
  //   [1, 'ingredient_name']             → row 1, ingredient_name field
  //   [0, 'audits', 1, 'auditor']        → row 0, audits row 1, auditor field
  path?: Array<string | number>
}
```

### DnaRow / DnaValue (deeply-nested value shape)

```typescript
// One record inside a deeply-nested attribute — child attribute name → cells.
type DnaRow = Record<string, NormalizedAttributeValue[]>

// Runtime payload for a `deeplynested` attribute value, stored as the `value`
// of a single NormalizedAttributeValue:
//   isCollection: true  → value is DnaRow[]
//   isCollection: false → value is a single DnaRow
type DnaValue = DnaRow | DnaRow[]
```

### ValueContext

```typescript
type ValueContext = {
  locale: string
  source: string
  channel?: string
}
```

### NormalizedEntity

```typescript
type NormalizedEntity = {
  id: string
  type: string
  attributes: Record<string, NormalizedAttributeValue[]>
}
```

### AttributeConflict

```typescript
type AttributeConflict = {
  attributeName: string
  serverValues: NormalizedAttributeValue[]
  userValues: NormalizedAttributeValue[]
}
```

### Raw Riversand → normalized name map

| Riversand (lit source) | Normalized (our types) |
|---|---|
| `AttributeModelObject` | `AttributeModelProperties` |
| `AttributeObject` | `NormalizedAttributeValue[]` (array per attribute) |
| `ValidationMessage` | `GovernMessage` |
| `ConflictAttribute` | `AttributeConflict` |
| `valueContexts[].locale + source + channel` | `ValueContext` |

### DataType → Input mapping

✅ = implemented · ❌ = falls through to read-only placeholder · 🔲 = planned component not yet built

| dataType | displayType | React component | Status |
|----------|-------------|-----------------|--------|
| string | textbox | `<Input type="text">` | ✅ |
| string | textarea | `<Textarea>` | ✅ |
| string | dropdown | `<Select>` from `allowedValues` | ✅ |
| string | referencelist | `<AttributeLov>` — Combobox, single + multi | ✅ |
| string | richtexteditor | no component yet — falls to textbox | 🔲 needs design-system component first |
| integer | textbox | `<Input type="number" step="1">` | ✅ |
| decimal | textbox | `<Input type="number" step="any">` | ✅ |
| integer / decimal | + UOM | `<UomInput>` | ✅ |
| boolean | boolean | `<Checkbox>` | ✅ |
| date | date | `<Input type="date">` | ✅ |
| datetime | datetime | `<Input type="datetime-local">` | ✅ |
| nested | nestedgrid | `<NestedAttributeGrid>` — tabular, add/delete rows | ✅ |
| path | path | `<PathSelector>` | ❌ |
| deeplynested | — | `<DnaManage>` modal | ✅ recursive at any depth — level 0 uses split-panel (tab sidebar + form), level > 0 uses vertical accordion stack (no width consumed per level). Lazy mount via controlled open state makes circular model references safe. Empty collections allowed. |

---

## API Interactions

All Riversand API calls are exposed as oRPC procedures in `@syndigo/orpc`, following the same contract-first pattern as `vendorCentral`. The `packages/attribute-manager` React package consumes them via the isomorphic oRPC client (`orpc.attributeManager.*`) using TanStack Query.

### API Stack

```
specs/riversand-attribute-api.yaml      ← OpenAPI spec for Riversand pass-through API
       ↓  pnpm generate:attribute-api
src/generated/riversand-attribute-api.d.ts   ← auto-generated TS types
       ↓
src/clients/riversand-attribute-api.ts  ← openapi-fetch client (RiversandAttributeApiClient)
       ↓
src/middleware/api-client.ts            ← injects context.attributeApi alongside context.api
       ↓
src/procedures/attribute-manager/*.ts  ← call context.attributeApi, map raw → normalized
       ↓
@repo/core-contracts attributeManager  ← Zod contracts define clean input/output types
       ↓
orpc.attributeManager.*                ← consumed in packages/attribute-manager via useSuspenseQuery / useMutation
```

### Regenerating types

`generate` runs automatically before `build` and `typecheck` via the Turbo pipeline. To regenerate in isolation (e.g. while iterating on the spec):

```bash
pnpm --filter=@syndigo/orpc generate:attribute-api
```

### RPC procedure surface

```typescript
orpc.attributeManager.entity.get           // fetch entity + optional govern data
orpc.attributeManager.entity.create        // create new entity
orpc.attributeManager.entity.update        // update attribute values
orpc.attributeManager.entity.validate      // debounced server-side validation (300ms)
orpc.attributeManager.compositeModel.get   // fetch attribute model definitions
orpc.attributeManager.reference.getData    // fetch reference entities for LOV
orpc.attributeManager.reference.getModel   // fetch reference entity model
orpc.attributeManager.aiContent.generate   // AI content generation
orpc.attributeManager.duplicate.check      // pre-save duplicate detection
orpc.attributeManager.uom.getEntityData    // fetch UOM symbol → unitname map for a UOM entity type
```

### Query usage in product-catalog components

```ts
import { orpc } from '#/integrations/orpc/client'
import { useSuspenseQuery, useMutation } from '@tanstack/react-query'

// Fetch entity + model in parallel
const [{ data: entityData }, { data: modelData }] = useSuspenseQueries({
  queries: [
    orpc.attributeManager.entity.get.queryOptions({
      input: { entityId, entityType, valueContexts, loadGovernData: true },
    }),
    orpc.attributeManager.compositeModel.get.queryOptions({
      input: { entityType, valueContexts },
    }),
  ],
})

// Save
const { mutate: save } = useMutation(
  orpc.attributeManager.entity.update.mutationOptions(),
)
```

### Base URL pattern: `/data/pass-through/<service>/<action>`

### API Call Inventory

#### 1. Fetch entity attributes + govern data

Combined request (entityservice + entitygovernservice in one call):

```typescript
// POST /data/pass-through/combinedservice/get
{
  params: { isCombinedQuerySearch: true },
  entity: {
    id: 'combinedGet', name: 'combinedGet', type: 'config',
    data: {
      jsonData: {
        searchQueries: [
          {
            serviceName: 'entitygovernservice',
            action: 'get',
            searchSequence: 1,
            searchQuery: {
              params: {
                query: {
                  ids: ['entity-id'],
                  filters: { typesCriterion: ['entityType'] },
                  contexts: [{ self: 'self' }],
                  valueContexts: [{ locale: 'en-US', source: 'internal' }]
                },
                fields: { attributes: ['_ALL'] }
              }
            }
          },
          {
            serviceName: 'entityservice',
            action: 'get',
            searchSequence: 2,
            searchQuery: { /* same shape */ }
          }
        ]
      }
    }
  }
}

// Response
{
  response: {
    status: 'success',
    content: {
      entities: [{
        id: string, type: string,
        data: {
          attributes: Record<string, {
            values: Array<{ source: string; locale: string; value: unknown }>
            properties?: Record<string, unknown>
          }>
        }
      }]
    }
  }
}
```

#### 2. Fetch composite attribute models

```typescript
// POST /data/pass-through/entitymodelservice/getcompositemodel
{
  params: {
    query: {
      name: 'entityTypeName',
      filters: { typesCriterion: ['entityCompositeModel'] },
      contexts: [{ self: 'self' }],
      valueContexts: [{ locale: 'en-US', source: 'internal', channel: 'web' }]
    },
    fields: { attributes: ['_ALL'] }
  }
}

// Response
{
  data: {
    attributes: Record<string, {
      properties: {
        externalName: string; dataType: string
        isLocalizable: boolean; isCollection: boolean
        referenceEntityInfo?: [{ refEntityType: string }]
      }
    }>
  }
}
```

#### 3 & 4. Save entity (update / create)

```typescript
// POST /data/pass-through/entityservice/update  (or /create)
{
  entities: [{
    id: string,
    type: string,
    data: {
      attributes: Record<string, {
        values: Array<{ source: string; locale: string; value: unknown }>
      }>
    }
  }],
  clientState?: {
    notificationInfo: { showNotificationToUser: boolean; userId?: string }
    updateCacheId?: string
  }
}

// Response
{
  dataObjectOperationResponse: {
    status: 'success',
    statusDetail: { messages: ValidationMessage[] },
    dataObjects: [{ id: string; type: string; data: { attributes: Record<string, unknown> } }]
  }
}
```

#### 5. Fetch entity post-save (getbyids, no govern)

```typescript
// POST /data/pass-through/entityservice/getbyids
{
  params: {
    query: {
      ids: ['entity-id'],
      filters: { typesCriterion: ['entityType'] },
      valueContexts: [{ locale: 'en-US', source: 'internal' }]
    },
    fields: { attributes: ['_ALL'] },
    options: { maxRecords: 200 }
  }
}
// Response: same shape as op 1 entity portion
```

#### 6. Sync validation (debounced 300ms)

```typescript
// POST /data/pass-through/entitygovernservice/validate
{
  entity: {
    id: string, type: string,
    data: {
      attributes: Record<string, { values: Array<{ value: unknown }> }>
    }
  }
}

// Response
{
  response: {
    status: 'success',
    statusDetail: {
      messages: Array<{ messageCode: string; messageType: 'error'|'warning'|'info'; attributeName: string }>
    }
  }
}
```

#### 7. Duplicate match check

```typescript
// POST /data/pass-through/matchservice/getMatchEntityInfo
// Same entity body shape as update/create (op 3)
// Response
{
  matchList: Array<{
    matchFound: boolean
    matchFailure: boolean
    response: {
      statusDetail: { probabilisticMatch?: boolean }
      response: unknown
    }
  }>
}
```

#### 8. Reference entity data (LOV population)

```typescript
// POST /data/pass-through/entityservice/getbyids
{
  params: {
    query: {
      ids: string[],
      filters: { typesCriterion: ['referenceEntityType'] },
      valueContexts: [{ locale: 'en-US', source: 'internal' }]
    },
    fields: { attributes: ['externalNameAttr', 'entityIdentifierAttr'] }
  }
}
// Response: standard entities array
```

#### 8b. Reference entity search (LOV browse + filter)

```typescript
// POST /data/pass-through/entityservice/get
{
  params: {
    query: {
      filters: {
        typesCriterion: string[],            // one or more reference entity types
        attributesCriterion?: Array<Record<string, { eq: string }>>, // prefix-wildcard search
        isAttributesCriterionOR?: boolean
      },
      valueContexts: [{ locale, source }]
    },
    fields: { attributes: ['_ALL'] },
    options: { from: number, maxRecords: number }   // page * pageSize, pageSize
  }
}
// Response: { entities: [...], totalRecords: number }
// Procedure also computes hasMore so the consumer doesn't have to.
```

#### 9. Reference entity model

Same as op 2 but for the reference entity type — returns composite model with `externalNameAttr` and `entityIdentifierAttr` property names.

#### 10. AI content generation

```typescript
// POST /data/pass-through/attributerservice/generate
{
  tenant: string, domain: string, entityType: string,
  contexts: Array<{ self: string; locale: string; channel: string; role: string; user: string }>,
  attributes: Record<string, { values: Array<{ source: string; value: unknown }> }>,
  getnearestPath: string,
  coalesceOptions?: Record<string, unknown>
}

// Response
{
  dataObjectOperationResponse: {
    status: 'success',
    dataObjects: [{
      data: {
        jsonData: {
          attributes: Record<string, { values: Array<{ value: unknown; uom?: string }> }>
        }
      }
    }]
  }
}
```

#### 11. Enhancer attribute names

Synchronous — returned from cached composite model data (no HTTP call). Returns `Record<string, string>` of enhancer attribute names for filtering.

#### 12. Source entity lookup

Same shape as op 5 (getbyids) with `maxRecords: 1`.

---

## Component Tree

```
<AttributeManage>                   → replaces rock-attribute-manage-v2
  ├── AttributeManageContext         → React context: state + dispatch + callbacks
  ├── <SaveCancelBar />              → Save / Cancel buttons
  ├── <AttributeConflictDialog />    → Conflict resolution modal
  └── <AttributeList>               → replaces rock-attribute-list-v2
      ├── <AttributeListHeader />    → PDP layout header (isPDPLayout mode)
      ├── <AttributeGroup />         → collapsible group panel, error count badge
      │   └── <AttributeItem />      → replaces rock-attribute-v2
      │       ├── <input> / <Select> / <DatePicker> / <Switch> (by dataType)
      │       ├── <AttributeLov />   → reference/LOV selector with search
      │       ├── <UomInput />       → numeric + unit selector
      │       ├── <NestedAttributeGrid /> → nested children (rock-nested-attribute-grid-v2)
      │       └── validation error display + revert/clear/history icons
      └── (100+ attributes → @tanstack/virtual row virtualizer)
```

---

## State Architecture

### AttributeManageContext

```typescript
type AttributeManageState = {
  mode: 'view' | 'edit'

  // Data
  entity: NormalizedEntity | null
  originalEntity: NormalizedEntity | null              // immutable snapshot for revert
  attributeModels: Record<string, AttributeModelProperties>
  changedAttributes: Record<string, NormalizedAttributeValue[]>

  // Validation
  governMessages: Record<string, GovernMessage[]>      // from govern service on load
  syncValidationMessages: Record<string, GovernMessage[]>
  clientValidationMessages: Record<string, GovernMessage[]>

  // Save lifecycle
  showSaveCancel: boolean
  isSaving: boolean
  conflictData: AttributeConflict[] | null             // non-null when conflict dialog open
}

// isLoading is managed by TanStack Query, not stored in reducer state.
// Feature flags (doSyncValidation, checkDuplicatesOnUpdate, etc.) are props on <AttributeManage>,
// not stored in reducer state.

type AttributeManageAction =
  | { type: 'INIT'; payload: { entity: NormalizedEntity; governMessages: Record<string, GovernMessage[]> } }
  | { type: 'SET_MODELS'; payload: Record<string, AttributeModelProperties> }
  | { type: 'ATTRIBUTE_CHANGED'; payload: { attributeName: string; values: NormalizedAttributeValue[] } }
  | { type: 'REVERT_ATTRIBUTE'; payload: { attributeName: string } }
  | { type: 'REVERT_ALL' }
  | { type: 'SET_SYNC_MESSAGES'; payload: Record<string, GovernMessage[]> }
  | { type: 'SET_CLIENT_MESSAGES'; payload: Record<string, GovernMessage[]> }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; payload: NormalizedEntity }
  | { type: 'SAVE_ERROR' }
  | { type: 'SET_CONFLICT'; payload: AttributeConflict[] }
  | { type: 'CLEAR_CONFLICT' }
  | { type: 'SET_MODE'; payload: 'view' | 'edit' }
```

---

## Infrastructure Replacements

| Old (LitElement/RUF) | New (React) |
|---|---|
| `DataObjectManager` | TanStack Query `queryFn` + plain `fetch` |
| `DataRequestHelper` | Request builder functions in `src/api/requestBuilders.ts` |
| `DataTransformHelper` | Transform functions in `src/api/responseTransformers.ts` |
| `EntityCompositeModelManager` | `useQuery` hook wrapping a fetch |
| `BedrockValidatorV2` | Zod schema validation |
| `MixinManager / RufElement / ComponentContextBase` | Props + custom hooks, no class inheritance |
| `ToastManagerV2.showToast()` | `@syndigo/design-system` toast (Sonner-backed) |
| `DialogManager.openConfirm()` | `@syndigo/design-system` `<Dialog>` controlled by state |
| `SettingsManager.appSetting()` | React context or props |
| `LoggerManager` | Console |
| `Debouncer` | `useDebouncedCallback` from `use-debounce` |
| ACI event bus (cross-app) | Callback props from host React app |
| `@lit-labs/virtualizer` | `@tanstack/virtual` row virtualizer |
| SCSS element styles | Tailwind utility classes |
| `LocaleManager` | Props or context |
| `BinaryStreamObjectManager` | Direct fetch for binary asset URLs |
| `DependentAttributesUtils` | `useDependentAttributes` hook |

---

## Key Files to Create

### Already implemented in this repo

| File | Package | Purpose |
|------|---------|---------|
| [specs/riversand-attribute-api.yaml](../packages/orpc/specs/riversand-attribute-api.yaml) | `@syndigo/orpc` | OpenAPI spec for Riversand pass-through API |
| [src/generated/riversand-attribute-api.d.ts](../packages/orpc/src/generated/riversand-attribute-api.d.ts) | `@syndigo/orpc` | Auto-generated TypeScript types |
| [src/clients/riversand-attribute-api.ts](../packages/orpc/src/clients/riversand-attribute-api.ts) | `@syndigo/orpc` | `openapi-fetch` client |
| [src/schemas/attribute-schema.ts](../packages/core-contracts/src/schemas/attribute-schema.ts) | `@repo/core-contracts` | Zod schemas for normalized types |
| [src/attribute-manager/contracts/entity.ts](../packages/core-contracts/src/attribute-manager/contracts/entity.ts) | `@repo/core-contracts` | get/create/update/validate contracts |
| [src/attribute-manager/contracts/composite-model.ts](../packages/core-contracts/src/attribute-manager/contracts/composite-model.ts) | `@repo/core-contracts` | composite model contract |
| [src/attribute-manager/contracts/reference.ts](../packages/core-contracts/src/attribute-manager/contracts/reference.ts) | `@repo/core-contracts` | LOV data + model contracts |
| [src/attribute-manager/contracts/ai-content.ts](../packages/core-contracts/src/attribute-manager/contracts/ai-content.ts) | `@repo/core-contracts` | AI content generation contract |
| [src/attribute-manager/contracts/duplicate.ts](../packages/core-contracts/src/attribute-manager/contracts/duplicate.ts) | `@repo/core-contracts` | Duplicate check contract |
| [src/utils/attribute-manager-mappers.ts](../packages/orpc/src/utils/attribute-manager-mappers.ts) | `@syndigo/orpc` | Raw API ↔ normalized type mappers — round-trips `referenceDataId` + `referenceEntityType` so reference attributes keep their id link, not just the display label |
| [src/procedures/attribute-manager/entity.ts](../packages/orpc/src/procedures/attribute-manager/entity.ts) | `@syndigo/orpc` | Entity CRUD + validate procedures |
| [src/procedures/attribute-manager/composite-model.ts](../packages/orpc/src/procedures/attribute-manager/composite-model.ts) | `@syndigo/orpc` | Composite model procedure |
| [src/procedures/attribute-manager/reference.ts](../packages/orpc/src/procedures/attribute-manager/reference.ts) | `@syndigo/orpc` | LOV data + model procedures + `reference.search` (paged `entityservice/get` with `attributesCriterion`) |
| [src/procedures/attribute-manager/ai-content.ts](../packages/orpc/src/procedures/attribute-manager/ai-content.ts) | `@syndigo/orpc` | AI generation procedure |
| [src/procedures/attribute-manager/duplicate.ts](../packages/orpc/src/procedures/attribute-manager/duplicate.ts) | `@syndigo/orpc` | Duplicate check procedure |
| [src/components/searchable-combobox.tsx](../packages/design-system/src/components/searchable-combobox.tsx) | `@syndigo/design-system` | Generic search-driven combobox: button/chips trigger, search input *inside* popover, virtualized list, empty/loading states, `onLoadMore` from scroll- and keyboard-driven prefetch |
| [src/components/combobox-virtual-list.tsx](../packages/design-system/src/components/combobox-virtual-list.tsx) | `@syndigo/design-system` | `@tanstack/react-virtual`-backed list inside `Combobox.Popup`. Adds `onEndReached`/`endReachedThreshold` for infinite-scroll wiring |
| [src/components/combobox.tsx](../packages/design-system/src/components/combobox.tsx) | `@syndigo/design-system` | Adds `ComboboxButtonTrigger` (select-style trigger that displays the current value with optional clear button) and exports `ComboboxClear` |
| [src/components/query-combobox.tsx](../apps/pxc-retail/src/components/query-combobox.tsx) | `pxc-retail` | TanStack-Query adapter for `SearchableCombobox` — owns the 300ms debounce, the open-gated `useInfiniteQuery`, and page flattening |

### apps/pxc-retail/src/components/attribute-manager — current status

#### Done ✅

```
apps/pxc-retail/src/components/attribute-manager/
  types.ts                         → AttributeModelProperties, NormalizedAttributeValue, etc.

  test/
    setup.ts                       → @testing-library/jest-dom/vitest
    test-utils.tsx                 → renderWithProviders, i18n stub, QueryClientProvider

  context/
    AttributeManageContext.tsx     → context + useReducer + provider, all action types,
                                     valueContexts wired through. Also exposes the
                                     `AttributeBinding` override: `AttributeBindingProvider`
                                     + `useAttributeBinding(model)` let a parent supply
                                     {values, messages, isChanged, isReadOnly, onChange,
                                     onRevert} for a single attribute. AttributeItem,
                                     AttributeLov, UomInput and UomDisplay all read through
                                     this hook, so the same components render against a
                                     cell deep inside a DNA tree (no separate input
                                     implementations). When no override is in scope the
                                     hook falls through to store-backed defaults, so
                                     existing call sites need no changes.
    AttributeManageStore.ts        → `attributeChanged` is content-aware: if the new
                                     values deep-equal the entity baseline it drops the
                                     entry from `changedAttributes` instead of pinning it.
                                     Editing a value and then typing it back to the
                                     original correctly leaves the attribute clean.
                                     `acceptServerValues` patches `entity` +
                                     `originalEntity` with `serverValues` from each
                                     `AttributeConflict` in a single atomic update, then
                                     clears `changedAttributes` and `conflictData` — used
                                     by the "Use System Values" conflict resolution path.
    AttributeManageContext.test.ts → 32 tests: full reducer + buildContextValue coverage

  components/
    AttributeManage/
      AttributeManage.tsx          → context provider, data hooks wired, save/revert handlers,
                                     success/error toasts on save. `_devConflict` prop
                                     (dev/POC only) seeds the conflict dialog with mock
                                     `AttributeConflict[]` via a `useEffect` → `setConflict`
                                     call; used by the product-catalog POC page to exercise
                                     the conflict dialog without a live WebSocket push.
      SaveCancelBar.tsx            → save / cancel buttons; cancel triggers a
                                     "Discard changes?" confirmation dialog before
                                     dispatching REVERT_ALL
      hooks/
        useEntityData.ts           → TanStack Query: fetch entity + govern data (op 1)
        useAttributeModels.ts      → TanStack Query: fetch composite models (op 2)
        useSyncValidation.ts       → debounced server validation (op 6, 300ms)
        useEntitySave.ts           → TanStack Mutation: update/create entity (op 3/4)

    AttributeList/
      AttributeList.tsx            → dispatches between two paths — non-PDP renders
                                     card-style AttributeGroup components inside a
                                     flex-1 overflow-y-auto container; PDP delegates
                                     to PDPAttributeList (virtualized via @tanstack/
                                     react-virtual: flat row model of header + attribute
                                     rows, lifted group-collapse state, scrollToIndex
                                     used by the header for group navigation)
      AttributeListHeader.tsx      → PDP layout header — group navigation dropdown (with
                                     scroll-to-group via index when virtualized, DOM-id
                                     fallback otherwise), debounced search, filter popover
                                     (empty / mandatory / error), filter count chip
      AttributeGroup.tsx           → AttributeGroup: collapsible card panel (ghost Button
                                     + ChevronDown icon), error count badge, anchor `id`
                                     for scroll-to-group, switches inner layout for PDP.
                                     AttributeGroupHeader: stateless header row used by
                                     the virtualized PDP list (collapse state owned by
                                     the parent so virtualization can elide rows)
      hooks/
        useAttributeGrouping.ts    → group + text filter; supports activeFilters
                                     (empty / mandatory / error) and entityAttributes
                                     for the empty-attribute predicate

    AttributeItem/
      AttributeItem.tsx            → input router: text, number, boolean, dropdown,
                                     referencelist, nested, deeplynested; revert button;
                                     validation display. Reads its data through
                                     `useAttributeBinding(model)` — defaults to the
                                     store, but a parent (e.g. DnaManage) can supply an
                                     `AttributeBindingProvider` to bind the same input
                                     UI to a nested-tree cell. In PDP mode: horizontal
                                     `[label | input | revert]` grid row with per-row
                                     borders + min-h, padding tuned to source SCSS, and
                                     inline-edit override (state.mode 'view' is treated
                                     as 'edit'; model.readOnly still wins). Revert
                                     button reserves space via `invisible` toggling to
                                     avoid layout shift.
      AttributeItem.test.tsx       → 18 tests
      AttributeLov.tsx             → thin shells (single + collection) over QueryCombobox.
                                     Adapts NormalizedAttributeValue ↔ RefEntity (with _label
                                     synthesis so the trigger renders without a fetch),
                                     dispatches ATTRIBUTE_CHANGED, persists referenceDataId +
                                     referenceEntityType alongside the label, and applies the
                                     "(no label)" fallback (i18n `attributeManager.missing_label`)
                                     when neither the stored value nor the fetched entity carries
                                     a human-readable name. UI behaviors (button/chips trigger,
                                     in-popover search, virtualized list, scroll/keyboard
                                     prefetch, fixed-height popup with no-results screen) live in
                                     SearchableCombobox + QueryCombobox.
      AttributeValue.tsx           → view-mode value display
      NestedAttributeGrid.tsx      → nested children grid, view + edit, add/delete rows
      NestedAttributeGrid.test.tsx → 11 tests
      DnaManage.tsx                → modal frame for `deeplynested` attributes. Trigger
                                     button on AttributeItem shows record count; clicking
                                     opens a Dialog. Owns the modal-level concerns:
                                     baseline snapshot at open, content-aware dirty
                                     tracking (deep-equal vs. baseline), cancel vs.
                                     "Discard changes?" routing, and seeding for
                                     initially-empty attributes (seed is reverted off
                                     the store on cancel so empty-then-cancel doesn't
                                     leave a phantom row). Editing is **live-bound**
                                     to the store on every keystroke so the existing
                                     `useSyncValidation` picks up the new tree with no
                                     special plumbing.
      DnaEditor.tsx                → entry point and layout router. At level 0
                                     (dialog root): split panel — `DnaTabList` sidebar
                                     on the left, `DnaForm` on the right. At level > 0
                                     with `isCollection`: delegates to
                                     `VerticalRecordStack` so no new side column is
                                     added per nesting level. At level > 0 without
                                     `isCollection`: renders `DnaForm` directly.
                                     `DnaEditor` is only mounted when its parent
                                     collapsible is opened (controlled open state +
                                     conditional render), so circular model references
                                     are safe and nesting is unbounded. Empty
                                     collections are valid — no phantom row is forced.
      DnaForm.tsx                  → row field rendering. Flat children (string /
                                     number / boolean / date / dropdown / LOV / UOM)
                                     render through `AttributeItem` wrapped in an
                                     `AttributeBindingProvider` — no duplicate input
                                     implementations. `deeplynested` children render
                                     as `DnaNestedSection` collapsibles.
      DnaNestedSection.tsx         → collapsible wrapper for a nested `deeplynested`
                                     child attribute. Normalizes value → `DnaRow[]`,
                                     tracks open state, and delegates to `DnaEditor`
                                     (which selects the right layout based on level).
                                     Forms the closing link of the cycle:
                                     DnaEditor → DnaForm → DnaNestedSection → DnaEditor.
      DnaVerticalStack.tsx         → `VerticalRecordStack` (list + add button) and
                                     `VerticalRecord` (collapsible accordion per row)
                                     used by `DnaEditor` at level > 0. Each record
                                     lazily mounts its `DnaForm` on expand.
      DnaTabList.tsx               → record selector for collection-mode DNA. Per-row
                                     error-count badge counting messages whose path
                                     begins at this row (cascades through nesting via
                                     `pathStartsWith`), inline delete button as a real
                                     sibling button (no nested-button HTML).
      dna-utils.ts                 → pure helpers (no React): `getChildModels`,
                                     `emptyRow`, `normalizeStoredValue`, `rowTitle`,
                                     `describeTrigger`, `rowsEqual`, `cellsEqual`,
                                     `messagesAt`, `countMessagesUnder`, internal
                                     `pathEquals` / `pathStartsWith` (string-coerce
                                     path segments so server-emitted numeric row
                                     indices and string child names compare correctly)
      DnaManage.test.tsx           → 19 tests covering happy path, path-keyed
                                     messages with cascading badge counts (tab +
                                     section header + dialog title badges without
                                     expansion; cell-level error with expansion),
                                     cancel paths (with / without edits, with /
                                     without pre-existing changes), seed-then-cancel
                                     cleanup, per-cell revert button on flat +
                                     nested-DNA children, type-back-to-baseline
                                     leaves the dialog clean (cancel + save paths),
                                     recursive nested DNA save round-trip,
                                     non-collection mode, deleting all records from
                                     a nested collection leaves it empty (no phantom
                                     row), add record via vertical stack, circular
                                     (self-referential) model renders without crashing
      UomInput.tsx                 → numeric + unit selector for integer/decimal attributes
                                     with uomAllowedUnitSymbols. Single mode: InputGroup
                                     with numeric input + inline Select for unit. Multi
                                     mode (isCollection): chips of "value unit" with
                                     remove buttons + add row (value + unit + plus icon,
                                     Enter to commit). Defaults to model.defaultUom; falls
                                     back to first allowed symbol. Exports UomDisplay for
                                     read-only rendering ("value unit, value unit, …").
```

#### Still to implement ❌

```
  components/
    AttributeList/
      hooks/
        useDependentAttributes.ts  → dependent attr update triggers

```

#### Done ✅ (AttributeManage additions)

```
      AttributeConflictDialog.tsx  → conflict resolution modal. Dialog (disablePointerDismissal)
                                     shows a design-system Table of attribute name / your value /
                                     system value rows. "Use System Values" calls acceptServerValues
                                     (patches entity + originalEntity, clears changedAttributes).
                                     "Keep My Changes" calls clearConflict then re-fires handleSave.
                                     Escape still dismisses via onOpenChange → clearConflict.
                                     Conflict detection (calling setConflict) requires a WebSocket
                                     push — see Known Gaps.
```

#### Known gaps / future work

**Save lifecycle**
- **`AttributeConflictDialog` implemented, but conflict detection is not wired** — the dialog UI, resolution handlers ("Use System Values" / "Keep My Changes"), and all store actions (`setConflict` / `clearConflict`) are complete. Nothing calls `setConflict` yet because conflict detection requires a real-time notification subscription (see below).
- **Conflict detection requires a WebSocket push, not a post-save re-fetch** — in the Lit source, `rock-attribute-manage-v2` never calls `getbyids` immediately after save. Instead it waits for a `govern-complete` notification pushed over Socket.IO. The full chain: RDF backend → HTTP POST `/api/notify` → Node.js `NotificationService` → Socket.IO server emits `event:notification` to the user's room → `bedrock-notification-receiver-v2` dispatches `dataobject-notification` into the ACI bus → `bedrock-dataobject-notification-handler-v2` maps `GovernComplete` → `govern-complete` → `rock-attribute-manage-v2.actionCallback` → `_refreshAttributes` → `_fetchEntityData` → diff fresh values against baseline, filtering out the user's own changes → populate `_autoUpdatedAttributes`. The conflict dialog is then shown on the user's *next* save attempt if `_autoUpdatedAttributes` is non-empty. Calling `getbyids` immediately after the save HTTP response would race the governance engine and return stale data. To wire conflict detection in React, a WebSocket/SSE subscription to the Riversand notification endpoint is needed; on a `GovernComplete` event for the current entity, re-fetch, diff, and call `setConflict`.
- **Post-save entity is synthesized, not re-fetched** — `saveSuccess` is dispatched with the merged request attributes rather than a fresh server fetch (`getbyids`); the server may normalize or transform values differently. This is intentional for now given the async governance timing above.
- **Duplicate check not wired** — `orpc.attributeManager.duplicate.check` procedure exists but is never called; `checkDuplicatesOnUpdate` feature not implemented

**Attribute inputs**
- **`richtexteditor` display type** — no `RichTextEditor` component exists in `@syndigo/design-system` yet; currently falls through to plain textbox; the lit source renders it in a dialog in list view
- **`revert` disabled in view mode** ✅ — revert button is omitted from the DOM when `isReadOnly` is true. `isEditMode = isPDPLayout || mode === 'edit'` is derived first; `isReadOnly = isEditMode ? Boolean(model.readOnly) : true`. Both the input renderer and the revert button key off `isReadOnly`, so PDP inline-edit override, `model.readOnly`, and view mode are all handled in one place.

**DNA / deeplynested**
- **Empty collection divergence from source** — the Lit source (`rock-dna-tab.js`) hardcodes a minimum of 1 row: it disables the delete button when only one new record remains, and re-seeds an empty row if deletion somehow reaches zero. Our implementation deliberately allows truly empty collections; the "new attribute" case is handled by `DnaManage.handleOpenChange` seeding one row on first open. If Riversand's API rejects a zero-length DNA collection, this will need to match source behavior.

**List / display**
- **`AttributeValue` coalesce styling** — view-mode coalesced values (from other locales/contexts) need the blue / italic fallback styling
- **`deeplynested` / DNA modal — recursive editor shipped** — covers the common case at any depth via the four-file split ([DnaManage](../apps/pxc-retail/src/components/attribute-manager/components/AttributeItem/DnaManage.tsx) modal frame, [DnaEditor](../apps/pxc-retail/src/components/attribute-manager/components/AttributeItem/DnaEditor.tsx) recursive trio, [DnaTabList](../apps/pxc-retail/src/components/attribute-manager/components/AttributeItem/DnaTabList.tsx) record selector, [dna-utils](../apps/pxc-retail/src/components/attribute-manager/components/AttributeItem/dna-utils.ts) pure helpers). Flat children of every supported type (string / textarea / dropdown / integer / decimal / boolean / date / datetime / **LOV / UOM**) render through the existing `AttributeItem` via an `AttributeBindingProvider` override — no duplicate input implementations. Nested `deeplynested` children render inline as `Collapsible`-wrapped DnaEditors at level+1. Sync validation works through the store (every keystroke live-pushes, so `useSyncValidation` picks up the tree). Path-keyed govern messages render at the offending cell, with cascading error-count badges on parent tabs + collapsible section headers + dialog title. Cancel routes through the "Discard changes?" confirm dialog when dirty (content-aware: type back to baseline = no prompt). **Not yet ported:** drag-reorder, clone, marketplace integration, source/coalesce info popovers, `displaySequence`-driven row title resolution
- **LOV label resolution on stale data** — when a stored reference value carries no label (bulk import, missing translation), we currently render `<id> (no label)` matching the source's "(Missing translation)" pattern. A one-shot `orpc.reference.getData({ ids })` on mount could batch-resolve missing labels for any synthesized entries; not worth doing until someone reports it
- **Locale-switch label refresh** — the lit source re-resolves labels via `getReferenceEntityData(refIds, ...)` when the user switches locale. We don't ship multi-locale switching yet; revisit when that lands
- **PDP layout — partial parity** — `isPDPLayout` is wired through `AttributeManage → AttributeList → AttributeGroup → AttributeItem` and covers: inline header (group nav / search / filters), fixed-header + scrollable groups container, forced single-column, side-by-side row layout with per-row borders + tuned spacing, and inline-edit override. **Not ported:** boolean blur auto-toggle (needs per-attribute focus state), focus tracking / restore (no equivalent infra), `noLabelFloat` ignore (no float-label feature), AI-generation / marketplace icons in the actions block (those features aren't ported yet)


---

## Implementation Order

1. **Types** — `src/api/types.ts` and `src/components/AttributeItem/types.ts` from the type definitions above
2. **API layer** — `requestBuilders.ts` (12 ops), `responseTransformers.ts`, `entityApi.ts`, `referenceApi.ts`
3. **Context + reducer** — `AttributeManageContext.tsx` with full state shape and all action types
4. **`AttributeManage`** — context provider, data hooks, save/revert handlers, conflict dialog
5. **`AttributeList`** — grouping, filtering, virtualized PDP list (`@tanstack/react-virtual` flat row model, always active in PDP mode regardless of attribute count)
6. **`AttributeItem`** — individual inputs by dataType/displayType, validation display, revert/clear icons
7. **`AttributeLov`** — reference entity lookup, search pagination, tag selection

---

## Verification

1. Render `<AttributeManage contextData={...} />` with a real entity — attributes load and group correctly
2. Edit an attribute — `showSaveCancel` appears, `changedAttributes` updates, dirty DQS callback fires
3. Save — correct API request sent, success toast shows, post-save refresh fetches updated values
4. Sync validation (if `doSyncValidation`) — debounce fires 300ms after change, server errors display on attribute
5. Revert all — attributes return to original snapshot
6. 100+ attributes — virtual scrolling renders correctly without DOM overflow
7. Conflict dialog — simulate server auto-update race; dialog appears with diff table; resolve works
8. Dependent attributes — changing source attribute triggers dependent attribute updates
9. Reference/LOV attribute — clicking the button trigger (or chips area, multi mode) opens a fixed-height popover with a search input at the top and a virtualized list below; typing debounces 300ms then re-queries the server; scrolling near the bottom (pointer or keyboard) fetches the next page; selecting commits a value carrying both `referenceDataId` and `referenceEntityType`; closing the popover resets the search; an empty result shows the no-results screen with the "Try another keyword" hint
10. Locale coalesce — coalesced values show fallback styling (blue `#0bb2e8` / italic font)
11. `noOfColumns` — 1/2/3 column grid layouts render correctly
12. `functionalMode` — contentonly / governance / list / grid modes behave differently
