# React Rewrite: RelationshipManage, RelationshipGroup, RelationshipGrid

## Source Repository

> **At the start of any session working on this rewrite, ask the user for the path to the `ui-platform-business-components-v2` checkout** — e.g. "What's the local path to the ui-platform-business-components-v2 repo?"

Key files to read once the path is known:
- `<root>/src/elements/rock-relationship-manage-v2/rock-relationship-manage-v2.js` — 1,745 lines
- `<root>/src/elements/rock-entity-relationship-search-result-v2/rock-entity-relationship-search-result-v2.js` — ~1,205 lines
- `<root>/src/elements/rock-relationship-grid-v2/rock-relationship-grid-v2.js` — 9,598 lines
- `<root>/src/helpers/` — DataRequestHelper, DataTransformHelper, DataHelper

---

## UX Reference

Two loveable mockups cover both use cases of this component:
- [`submodules/loveable/src/components/product-detail/ProductAssetsTab.tsx`](../submodules/loveable/src/components/product-detail/ProductAssetsTab.tsx) — assets tab: Grid/List toggle, grouped by asset type (images/videos/documents/audio), collapsible sections with status icons
- [`submodules/loveable/src/components/product-detail/ProductRelationshipsTab.tsx`](../submodules/loveable/src/components/product-detail/ProductRelationshipsTab.tsx) — relationships tab: collapsible groups (accessories/crossSell/upSell) with tabular view, product thumbnail + variants

---

## Target Location

This rewrite lives directly in the **`apps/pxc-retail`** app under:

```
apps/pxc-retail/src/components/relationship-manager/
  types.ts
  context/
  components/
    RelationshipManage/
    RelationshipGroup/
    RelationshipGrid/
  test/
```

No separate package — co-located app code. Conventions:
- Inherits pxc-retail's TypeScript config, ESLint config, and Vitest setup
- Import via the `#/` alias: `import { RelationshipManage } from '#/components/relationship-manager/...'`
- Consumes `@syndigo/design-system/components/*` for UI primitives

---

## Context

These three LitElement web components form the core relationship and asset editing UI in the Riversand MDM platform. They are being rewritten in React inside the retail-pxc monorepo. No LitElement infrastructure, no Polymer/RUF managers.

**The same component powers both the Assets tab and Relationships tab** on the product detail page. The `dockingIdentifier` and `domain` props drive the distinction:
- **Assets tab**: `domain="digitalasset"` — shows groups by asset type (images, videos, documents, audio) in Grid or List view
- **Relationships tab**: `domain` varies by entity type — shows relationship type groups (accessories, crossSell, upSell, etc.) in Tile or Tabular view

**Stack decisions:** TypeScript + Tailwind, TanStack Query + fetch, **TanStack Store** for state, `@syndigo/design-system` (shadcn/base-nova preset) for UI primitives.

---

## What These Components Do

### rock-relationship-manage-v2 (orchestrator)
- Fetches entity composite model to discover available relationship type names and their `relTo` entity-type mappings
- Fetches relationship models (`typesCriterion: ['relationshipModel']`) to resolve domain, direction, and permissions per type
- Renders relationship types progressively via chunked lazy loading (`relationshipChunkLength`, default 10) using `requestAnimationFrame`
- Owns global view mode: Tile vs. Tabular; fires `_onViewChange()` which resets inline-edit state when the user switches
- Inline-edit coordination: tracks `isRelGridInEditMode` + which grid (`relGridUnderEdit`) is editing; disables all other grids while one is active (`disableGrid` prop)
- Save/cancel bar: shown when any child grid enters edit mode (`showSaveCancel`); hidden after save or revert
- Dirty-state checking: polls all child `rock-entity-relationship-search-result-v2` elements via `getIsDirty()` before allowing navigation away
- Variant model: for variant-type relationships, fetches `variantModelSettings` entity then calls `/data/pass-through/entityappmodelservice/getnearest` with enhancer attribute context
- `dockingIdentifier` drives which config is loaded (passed to `requestConfig()`)

### rock-entity-relationship-search-result-v2 (per-type container)
- Renders one relationship type as a collapsible accordion section
- Loads component config via `requestConfig()` — drives column definitions, business actions, and permissions
- Fetches composite model for the relationship type → extracts `hasWritePermission`, `hasDeletePermission`, and the full relationship attribute schema
- Fetches attribute models for all related entity types (entity-type-keyed schema map stored as `entityTypeBasedAttributeModel`)
- Fetches models for "enhancer" attributes not covered by the initial attribute model response
- Shows/hides accordion based on whether > 1 relationship type exists in the parent context
- Proxies `getIsDirty()`, `getControlIsDirty()`, and `refresh()` calls through to the inner grid
- Builds and passes `relGridConfig` (merged config + attribute models + permissions + business actions) down to the grid
- Handles "up direction" (whereused/inverse) relationships by transforming config via `_getConfigForUpDirection()`

### rock-relationship-grid-v2 (the main grid)
- Fetches relationship data: entity GET request built by the parent (passed as `relReq` prop), with `fields.relationships: [typeName]` — returns the entity with an embedded relationship array
- Renders Tile view (card grid with thumbnails) or Tabular view (bedrock-grid-v2 with columns)
- Bulk selection: checkbox per row; bulk-action bar shows Download and Delete when items are selected
- Add relationships: dispatches global `'open-wizard'` action with `componentname: 'rock-wizard-entity-relationship-add'`; passes already-linked entities as `pre-selected-items` so the picker deduplicates
- Remove relationships: marks items `action: 'delete'`; for owned relationships updates the main entity; for whereused relationships updates each related entity individually
- Inline editing: direct cell editing with `evaluateRelationshipTypeValidation: true` sync validation (debounced)
- Sort: ascending/descending per-column
- Pagination: `pageSize` default 500, `maxConfiguredCount` default 2000
- Permission gates: `hasWritePermission` controls Add/edit visibility; `hasDeletePermission` controls Delete visibility
- Marketplace asset thumbnails: resolves `thumbnailUrl` from `marketplaceAssetData` keyed by relationship type (lowercase)
- Variant generation: variant-specific actions for product variant relationships

---

## TypeScript Types

> The raw Riversand API shapes are complex. Normalized types are defined as Zod schemas in `@repo/core-contracts/src/schemas/relationship-schema.ts` and exported as TypeScript types from `@repo/core-contracts/src/types/relationship-manager.ts`. Import them via `@repo/core-contracts/types/relationship-manager`. The frontend `types.ts` re-exports them from there.

### RelationshipTypeDefinition

```typescript
type RelationshipTypeDefinition = {
  name: string                // internal name (e.g., 'hasImages', 'crossSell')
  title: string               // display title (e.g., 'Images', 'Cross Sell')
  domain: string              // 'digitalasset' | 'thing' | ...
  direction: 'down' | 'up'   // 'down' = owned, 'up' = whereused (inverse)
  entityTypes: string[]       // allowed relTo entity types
  hasWritePermission: boolean
  hasDeletePermission: boolean
}
```

### RelationshipItem

```typescript
type RelationshipItem = {
  id: string                  // relTo.id
  type: string                // relTo.type
  name?: string               // display name (from related entity attributes)
  thumbnailUrl?: string       // asset thumbnail (resolved from marketplace data)
  // Attributes on the relationship itself (e.g., sequence, isPrimary)
  relationshipAttributes: Record<string, NormalizedRelValue[]>
  // Attributes on the related entity (columns rendered in the grid)
  attributes: Record<string, NormalizedRelValue[]>
}
```

### NormalizedRelValue

```typescript
type NormalizedRelValue = {
  locale: string
  source: string
  value: unknown
}
```

### RelationshipData

```typescript
type RelationshipData = {
  relationshipType: string
  items: RelationshipItem[]
  totalCount: number
}
```

### PendingRelationshipChange

```typescript
type PendingRelationshipChange = {
  added: RelationshipItem[]
  removed: string[]          // relTo.id values to delete
  modified: RelationshipItem[]  // inline-edited items
}
```

### ValueContext

```typescript
type ValueContext = {
  locale: string
  source: string
  channel?: string
}
```

### Raw Riversand → normalized name map

| Riversand (lit source) | Normalized (our types) |
|---|---|
| `rel.relTo.id` + `rel.relTo.type` | `RelationshipItem.id` + `.type` |
| `rel.attributes` | `RelationshipItem.relationshipAttributes` |
| related entity `data.attributes` | `RelationshipItem.attributes` |
| `relationshipModel` entity | `RelationshipTypeDefinition` |
| `gridConfig.hasWritePermission` | `RelationshipTypeDefinition.hasWritePermission` |
| `ownership: 'owned'` | `direction: 'down'` |
| `ownership: 'whereused'` | `direction: 'up'` |

---

## API Interactions

All Riversand API calls are exposed as oRPC procedures in `@syndigo/orpc`, following the same contract-first pattern as `attributeManager`. The relationship-manager components consume them via the isomorphic oRPC client.

### API Stack

```
specs/riversand-relationship-api.yaml       ← OpenAPI spec for Riversand pass-through API
       ↓  pnpm generate:relationship-api
src/generated/riversand-relationship-api.d.ts  ← auto-generated TS types
       ↓
src/clients/riversand-relationship-api.ts   ← openapi-fetch client
       ↓
src/middleware/api-client.ts                ← injects context.relationshipApi
       ↓
src/procedures/relationship-manager/*.ts    ← call context.relationshipApi, map raw → normalized
       ↓
@repo/core-contracts relationshipManager    ← Zod contracts define clean input/output types
       ↓
orpc.relationshipManager.*                  ← consumed via useSuspenseQuery / useMutation
```

### RPC procedure surface

```typescript
orpc.relationshipManager.compositeModel.get       // fetch entity composite model → relationship type list
orpc.relationshipManager.relationshipModels.get   // fetch relationship model definitions (permissions, domain)
orpc.relationshipManager.relationships.get        // fetch relationship data for one type
orpc.relationshipManager.relationships.save       // add / remove / update relationships
orpc.relationshipManager.relationships.validate   // debounced sync validation (300ms)
```

### Base URL pattern: `/data/pass-through/<service>/<action>`

### API Call Inventory

#### 1. Fetch entity composite model

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
    fields: { relationships: ['_ALL'] }
  }
}

// Response: relationship type names mapped to their relTo entity types
{
  data: {
    relationships: Record<string, {
      properties: {
        externalName: string
        relatedEntityInfo: Array<{ relEntityType: string }>
      }
    }>
  }
}
```

#### 2. Fetch relationship models

```typescript
// POST /data/pass-through/entityservice/getbyids
{
  params: {
    query: {
      ids: ['relationshipTypeName_relationshipModel', ...],
      filters: { typesCriterion: ['relationshipModel'] },
      valueContexts: [{ locale: 'en-US', source: 'internal' }]
    },
    fields: { attributes: ['_ALL'] }
  }
}

// Response: entities with properties for domain, ownership, permissions
{
  entities: [{
    id: string, type: 'relationshipModel',
    data: {
      attributes: {
        externalName: { values: [{ value: string }] },
        relationshipOwnership: { values: [{ value: 'owned' | 'whereused' }] },
        relationshipDomain: { values: [{ value: string }] }
      },
      properties: {
        hasWritePermission: boolean
        hasDeletePermission: boolean
      }
    }
  }]
}
```

#### 3. Fetch relationship data (grid)

```typescript
// POST /data/pass-through/entityservice/get (or getbyids for specific IDs)
{
  params: {
    query: {
      ids: ['entityId'],
      filters: { typesCriterion: ['entityType'] },
      valueContexts: [{ locale: 'en-US', source: 'internal' }]
    },
    fields: {
      relationships: ['relationshipTypeName'],         // which relationship type to load
      relationshipAttributes: ['_ALL'],                // attrs on the relationship itself
      relatedEntityAttributes: ['externalName', ...]   // attrs on the related entities
    },
    options: { maxRecords: 500 }
  }
}

// Response
{
  entities: [{
    id: string, type: string,
    data: {
      relationships: {
        [relationshipTypeName]: Array<{
          relTo: { id: string; type: string }
          id?: string
          attributes?: Record<string, { values: Array<{ locale: string; source: string; value: unknown }> }>
          // related entity data embedded when relatedEntityAttributes requested:
          relatedEntity?: {
            data: { attributes: Record<string, { values: ... }> }
          }
        }>
      }
    }
  }]
}
```

#### 4. Save (add / remove / update) relationships

```typescript
// POST /data/pass-through/entityservice/update
{
  entities: [{
    id: string,
    type: string,
    data: {
      relationships: {
        [relationshipTypeName]: Array<{
          relTo: { id: string; type: string }
          action: 'create' | 'delete'           // omit action for updates
          attributes?: Record<string, {
            values: Array<{ locale: string; source: string; value: unknown }>
          }>
        }>
      }
    }
  }]
}

// Response
{
  dataObjectOperationResponse: {
    status: 'success',
    statusDetail: { messages: ValidationMessage[] }
  }
}
```

For **whereused (up-direction)** relationships: one update request per related entity rather than updating the main entity. Each request deletes/creates the reverse relationship on the related entity.

#### 5. Sync validation

```typescript
// POST /data/pass-through/entitygovernservice/validate
{
  entity: {
    id: string, type: string,
    data: {
      relationships: {
        [typeName]: Array<{ relTo: { id: string; type: string } }>
      }
    }
  },
  params: {
    evaluateRelationshipTypeValidation: true,
    evaluateDataResolution: true
  }
}

// Response
{
  response: {
    status: 'success',
    statusDetail: {
      messages: Array<{
        messageCode: string
        messageType: 'error' | 'warning' | 'info'
        relationshipRelToId?: string   // which related entity the message targets
      }>
    }
  }
}
```

#### 6. Variant model (variant relationships only)

```typescript
// POST /data/pass-through/entityappmodelservice/getnearest
{
  params: {
    query: {
      name: entityType,
      filters: { typesCriterion: ['variantModel'] }
    },
    fields: { attributes: ['_ALL'] }
  },
  entity: {
    data: {
      contexts: [variantContext],   // enhancer attribute values from the entity
      attributes: enhancerAttributes
    }
  }
}
// Response: variant model with dimension attribute lists and path config
```

---

## Component Tree

```
<RelationshipManage>                  → replaces rock-relationship-manage-v2
  ├── RelationshipStoreContext         → TanStack Store instance provided to all children
  ├── View toolbar                    → Grid/List (assets) or Tile/Tabular (relationships)
  │                                     hidden via hideViewToggle prop (e.g. relationships tab)
  ├── <SaveCancelBar />               → shows when showSaveCancel is true; cancel → discard confirm dialog
  └── <RelationshipGroup> ×N          → replaces rock-entity-relationship-search-result-v2
      ├── Collapsible header          → type title + pending-changes badge
      │                                 + selection count + bulk Delete (when items checked)
      │                                 + Add button (gated by hasWritePermission)
      └── <RelationshipGrid>          → replaces rock-relationship-grid-v2
          ├── Tabular view            → Table: checkbox | thumbnail | name | type | delete per row
          └── Tile view               → Card grid: thumbnail | name | hover checkbox | hover X button
```

> **Design note**: selection count and bulk-delete live in the group header (not a floating bar inside the grid) to eliminate layout shift when rows are checked.

---

## State Architecture

### RelationshipManageStore

State is managed with **TanStack Store** (`@tanstack/store`). The store is created once per `<RelationshipManage>` instance and passed via React context so child components can subscribe with `useStore`.

```typescript
import { Store, useStore } from '@tanstack/store'

type RelationshipManageState = {
  // Display
  viewMode: 'Tile' | 'Tabular'

  // Relationship type definitions (loaded from composite model + relationship models)
  relationshipTypes: RelationshipTypeDefinition[]

  // Relationship data per type (loaded lazily per group as it's expanded)
  relationshipData: Record<string, RelationshipData>

  // Save bar visibility + saving indicator
  showSaveCancel: boolean
  isSaving: boolean

  // Pending changes (staged until Save)
  pendingChanges: Record<string, PendingRelationshipChange>

  // Checkbox selection per type (drives group-header bulk-delete; cleared on remove/revert)
  selection: Record<string, string[]>
}

// loadingState (per type) is managed by TanStack Query, not stored here.

const createRelationshipStore = () =>
  new Store<RelationshipManageState>({
    viewMode: 'Tabular',
    relationshipTypes: [],
    relationshipData: {},
    showSaveCancel: false,
    isSaving: false,
    pendingChanges: {},
    selection: {},
  })

type RelationshipStore = ReturnType<typeof createRelationshipStore>
```

### Named updater functions (replace action types)

```typescript
// src/components/relationship-manager/store/updaters.ts

const setViewMode = (store: RelationshipStore, mode: 'Tile' | 'Tabular') =>
  store.setState((s) => ({ ...s, viewMode: mode }))

const setRelationshipTypes = (store: RelationshipStore, types: RelationshipTypeDefinition[]) =>
  store.setState((s) => ({ ...s, relationshipTypes: types }))

const setRelationshipData = (store: RelationshipStore, typeName: string, data: RelationshipData) =>
  store.setState((s) => ({
    ...s,
    relationshipData: { ...s.relationshipData, [typeName]: data },
  }))

const addRelationships = (store: RelationshipStore, typeName: string, items: RelationshipItem[]) =>
  store.setState((s) => {
    const existing = s.pendingChanges[typeName] ?? { added: [], removed: [], modified: [] }
    return {
      ...s,
      pendingChanges: {
        ...s.pendingChanges,
        [typeName]: { ...existing, added: [...existing.added, ...items] },
      },
      showSaveCancel: true,
    }
  })

const removeRelationships = (store: RelationshipStore, typeName: string, ids: string[]) =>
  store.setState((s) => {
    const existing = s.pendingChanges[typeName] ?? { added: [], removed: [], modified: [] }
    return {
      ...s,
      pendingChanges: {
        ...s.pendingChanges,
        [typeName]: {
          ...existing,
          // remove from pending-added if not yet saved; otherwise stage for deletion
          added: existing.added.filter((item) => !ids.includes(item.id)),
          removed: [...new Set([...existing.removed, ...ids.filter(
            (id) => !existing.added.some((item) => item.id === id)
          )])],
        },
      },
      showSaveCancel: true,
    }
  })

const saveStart = (store: RelationshipStore) =>
  store.setState((s) => ({ ...s, isSaving: true }))

const saveSuccess = (store: RelationshipStore, typeName: string, data: RelationshipData) =>
  store.setState((s) => {
    const pendingChanges = { ...s.pendingChanges }
    delete pendingChanges[typeName]
    const allClean = Object.keys(pendingChanges).length === 0
    return {
      ...s,
      isSaving: false,
      showSaveCancel: !allClean,
      relationshipData: { ...s.relationshipData, [typeName]: data },
      pendingChanges,
    }
  })

const saveError = (store: RelationshipStore) =>
  store.setState((s) => ({ ...s, isSaving: false }))

const revert = (store: RelationshipStore, typeName?: string) =>
  store.setState((s) => {
    if (typeName) {
      const pendingChanges = { ...s.pendingChanges }
      delete pendingChanges[typeName]
      return { ...s, pendingChanges, showSaveCancel: Object.keys(pendingChanges).length > 0 }
    }
    return { ...s, pendingChanges: {}, showSaveCancel: false, selection: {} }
  })
```

### Consuming the store in components

```typescript
// Subscribe to a slice — only re-renders when viewMode changes
const viewMode = useStore(store, (s) => s.viewMode)

// Subscribe to pending count for one type
const pendingCount = useStore(
  store,
  (s) => (s.pendingChanges['hasImages']?.added.length ?? 0) +
          (s.pendingChanges['hasImages']?.removed.length ?? 0),
)
```

The store instance is created in `<RelationshipManage>` and provided via a React context so all children share the same instance without prop-drilling.

---

## Infrastructure Replacements

| Old (LitElement/RUF) | New (React) |
|---|---|
| `DataObjectManager` | TanStack Query `queryFn` + plain `fetch` |
| `DataRequestHelper` | Request builder functions in `src/api/requestBuilders.ts` |
| `DataTransformHelper` | Transform functions in `src/api/responseTransformers.ts` |
| `EntityCompositeModelManager` | `useQuery` wrapping a fetch |
| `EntityTypeManager.getDomainByType()` | Domain resolved from relationship model fetch (op 2) |
| `DialogManager.openBusinessFunction('rock-wizard-entity-relationship-add', ...)` | `<Dialog>` + `RelationshipSearchDialog` controlled by state |
| `MixinManager / RufElement / ComponentContextBase` | Props + `@tanstack/store` + custom hooks, no class inheritance |
| `ToastManagerV2.showToast()` | `@syndigo/design-system` toast (Sonner-backed) |
| `pebble-button-v2`, `pebble-icon-v2` | `@syndigo/design-system` Button + Lucide icons |
| `pebble-no-results` | Empty-state UI in JSX |
| `pebble-skeleton` | `@syndigo/design-system` skeleton components |
| `bedrock-grid-v2` | Custom `<RelationshipGrid>` with Table primitives |
| `bedrock-tile-view-v2` | Card grid layout in JSX |
| `ScrollBarUtils` (SimpleBar) | CSS `overflow-y-auto` + browser scrollbar |
| `microTask.run()` / `requestAnimationFrame()` chunking | React lazy loading or `useDeferredValue` |
| ACI event bus `open-wizard` action | Callback prop from host React app + controlled Dialog |
| SCSS element styles | Tailwind utility classes |
| `ObjectUtils.cloneObject()` | Structured clone or spread |
| `_domainCache` (Map) | TanStack Query cache |

---

## Key Files

### @repo/core-contracts

| File | Status | Purpose |
|------|--------|---------|
| `src/schemas/relationship-schema.ts` | ✅ | Zod schemas for normalized types + `ValueContextSchema` |
| `src/types/relationship-manager.ts` | ✅ | `z.infer<>` exports — canonical TS types for the domain |
| `src/relationship-manager/contracts/composite-model.ts` | ✅ | composite model contract |
| `src/relationship-manager/contracts/relationships.ts` | ✅ | get / save / validate contracts |

> **Architectural note**: a separate OpenAPI spec + generated client was not created. Relationship API calls go through the existing `context.api` pass-through pattern (same as all other procedures), keeping the stack consistent.

### @syndigo/orpc

| File | Status | Purpose |
|------|--------|---------|
| `src/utils/relationship-manager-mappers.ts` | ✅ | Raw Riversand API ↔ normalized type mappers |
| `src/procedures/relationship-manager/composite-model.ts` | ✅ | Composite model procedure (type list + permissions) |
| `src/procedures/relationship-manager/relationships.ts` | ✅ | get / save / validate procedures |
| `src/__tests__/relationship-manager.test.ts` | ✅ | 13 MSW-backed procedure tests (includes `direction: up` save path) |

### apps/pxc-retail/src/components/relationship-manager

#### Implemented ✅

```
  types.ts                                → RelationshipManagerOrpc type (mirrors AttributeManagerOrpc
                                             pattern); re-exports ValueContext, RelationshipTypeDefinition,
                                             RelationshipItem, RelationshipData, PendingRelationshipChange,
                                             ValidationMessage from @repo/core-contracts/types/relationship-manager

  store/
    RelationshipManageStore.ts              → createRelationshipStore(), RelationshipStoreContext,
                                             selection: Record<string, string[]> field
    updaters.ts                             → setViewMode, addRelationships, removeRelationships,
                                             saveStart/Success/Error, revert,
                                             setSelection, clearSelection
                                             (no setEditing — editingRelationshipType removed)
    updaters.test.ts                        → 13 pure unit tests

  components/
    RelationshipManage/
      RelationshipManage.tsx               → store provider, view toolbar (List/LayoutGrid icons,
                                             variant="outline", hideViewToggle prop), save/revert;
                                             accepts orpc: RelationshipManagerOrpc (required) and
                                             valueContexts: ValueContext[] (required), threads both
                                             to all hooks and RelationshipGroup
      SaveCancelBar.tsx                    → save / cancel with "Discard changes?" confirm dialog
      SaveCancelBar.test.tsx               → 6 tests
      hooks/
        useRelationshipTypes.ts            → TanStack Query: composite model → relationship type list;
                                             orpc is first param (matches AttributeManage pattern)
        useRelationshipSave.ts             → raw TanStack Mutation (no callbacks — state transitions
                                             owned by RelationshipManage.handleSave); buildSaveInput
                                             exported for building the input object

    RelationshipGroup/
      RelationshipGroup.tsx               → collapsible section; pending-changes badge;
                                             selection count + bulk Delete in header (no layout shift);
                                             Add button gated by hasWritePermission;
                                             accepts and forwards orpc prop
      RelationshipGroup.test.tsx          → 9 tests; uses createMockRelationshipOrpc()
      hooks/
        useRelationshipData.ts            → TanStack Query: fetch grid data for one type;
                                             orpc is first param

    RelationshipGrid/
      RelationshipGrid.tsx               → Tabular vs Tile dispatcher (no disabled prop)
      RelationshipGridTabular.tsx        → Table: checkbox | thumbnail | name | type | delete per row;
                                           selection via store (no layout shift); loading="lazy" on images
      RelationshipGridTabular.test.tsx   → 10 tests
      RelationshipGridTile.tsx           → Card grid: thumbnail | name | hover checkbox + X button;
                                           selection via store (consistent with tabular); loading="lazy" on images
      utils.ts                           → getDisplayName(), mergeItemsWithPending() — shared by both views

  lib/mock/relationship-manager.mock.ts   → createMockRelationshipOrpc() — in-memory queryFn/mutationFn
                                             (same pattern as createMockAttributeManagerOrpc)
```

POC page: `routes/_shell/merchandising/product-catalog/$productId.tsx` — Attributes / Assets / Relationships tabs with deep-linked tab state (`?tab=attributes|assets|relationships`, optional in the search schema with `'attributes'` as the in-component default). The Relationships tab passes `hideViewToggle` so only tabular view is shown with no toggle. The POC passes `createMockRelationshipOrpc()` as the `orpc` prop — no `QueryClientProvider` wrapper needed, and saves work via the in-memory mock `mutationFn`.

#### Still to implement ❌

```
    RelationshipManage/
      hooks/
        useSyncValidation.ts               → debounced inline-edit validation (300ms)

    RelationshipGrid/
      RelationshipSearchDialog.tsx         → "Add relationships" picker dialog; entity search +
                                             multi-select; wires up the Add button in RelationshipGroup
```

---

## Known Gaps / Future Work

**Add relationship workflow**
- The Lit source opens a full `rock-wizard-entity-relationship-add` dialog via the ACI event bus. The React replacement needs a `RelationshipSearchDialog` — an entity search + multi-select panel. The search mechanism mirrors the LOV search from AttributeLov (oRPC `entityservice/get` with `attributesCriterion`) but scoped to `relatedEntityTypes` from the relationship type definition.

**Whereused (up-direction) relationships**
- ✅ Implemented. `relationships.save` branches on `direction: 'up'` — each added/removed relationship updates the **related** entity individually via `Promise.allSettled`. Any failure (HTTP or application-level status check) throws `relationship.save_failed`.

**Variant relationships**
- Variant model fetch (op 6) only applies when `variantPath` is set on the relationship type. Low-priority unless the PDP surfaces variant generation actions.

**Inline edit (cell editing)**
- The source supports direct cell editing inside the grid. The loveable mockup does not include this. Implement as a future iteration; initial build should support Add/Remove only.

**Tile view layout details**
- Assets tab tile view shows `status` icons (valid/invalid/pending) per asset. The source resolves status from governance data. Initial build can omit status icons; add when governance is wired.

**Pagination**
- Default `pageSize: 500` matches source. Infinite scroll or "load more" may be needed for entity types with many relationships; defer until needed.

---

## Implementation Order

1. ✅ **Types** — `types.ts`
2. ✅ **API layer** — Zod schemas, oRPC contracts + procedures, mappers
3. ✅ **Store** — `RelationshipManageStore`, all updaters (including `selection`)
4. ✅ **`RelationshipManage`** — store provider, composite model hook, view toolbar (`hideViewToggle` prop), save/revert
5. ✅ **`RelationshipGroup`** — collapsible section, lazy data fetch, pending badge, selection count + bulk delete in header
6. ✅ **`RelationshipGrid` (tabular)** — checkbox, thumbnail, name, type, delete per row; selection via store
7. ✅ **Tile view** — card grid with hover controls; selection via store
8. ✅ **POC page** — Attributes / Assets / Relationships tabs with deep-linked `?tab=` search param
9. ❌ **`RelationshipSearchDialog`** — entity search + multi-select picker; wires up the Add button
10. ❌ **`useSyncValidation`** — debounced inline-edit validation (300ms)

---

## Verification

1. Render `<RelationshipManage domain="digitalasset" />` on a product detail page — asset type groups load (images, videos, documents)
2. Render `<RelationshipManage domain="thing" />` — relationship type groups load (accessories, crossSell, upSell, etc.)
3. Toggle view mode (List ↔ Grid for assets; Tile ↔ Tabular for relationships) — layout switches, state persists within the session
4. Expand a group — relationship data loads, items render with thumbnails and names
5. Add a relationship — search dialog opens, selected item appears in pending state, save/cancel bar shows
6. Remove a relationship — item marked pending-delete, save/cancel bar shows
7. Save — correct API request sent (`action: 'create'` / `action: 'delete'`), success toast shows, grid refreshes
8. Revert — "Discard changes?" confirm appears when dirty; on confirm, pending changes cleared, grid resets
9. Bulk delete — selecting multiple items and clicking Delete stages all for removal; Save commits all
10. Sync validation — inline edit triggers 300ms debounce; server errors display on the offending row
11. `hasWritePermission: false` — Add and edit actions hidden; `hasDeletePermission: false` — Delete hidden
12. Two tabs side by side — assets tab and relationships tab both load independently with correct data
