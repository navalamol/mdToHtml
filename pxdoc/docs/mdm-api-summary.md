# MDM OpenAPI Spec — Component API Analysis

Generated from: `rock-attribute-manage-v2.js`, `rock-relationship-manage-v2.js`,
`rock-entity-search-discovery-v2.js`

Spec written to: `packages/orpc/specs/mdm-api.yaml`

---

## Verification Corrections (2026-06-03)

The spec was re-verified against the actual component source and the server-side
`ui-platform/src/server/modules/common/df-rest-service/df-rest-service-config.js`.
Findings applied to `mdm-api.yaml`:

**Endpoint names — CONFIRMED correct** (resolved server-side, not in client source):
- `entityappservice/getcombined` exists in `df-rest-service-config.js:49-53` (timeout 360000),
  confirming the `searchandget → getcombined` mapping. (Note: the search grid actually
  drives the Falcor ops `initiatesearch` → `getsearchresultdetail`, which the BFF resolves
  to `getcombined`.)
- `entitymodelservice/getcomposite → /entityappmodelservice/getcomposite`
  (`df-rest-service-config.js:84-93`), confirming the composite-model mapping.
- The `entityservice/*` → `/entityappservice/*` and `entitymodelservice/get` →
  `/entityappmodelservice/get` key remaps are confirmed (`:3-40`, `:59-68`).

**Request/response shapes — CORRECTED in spec** (these were wrong):
- **`attributerservice/generate`**: body is `{ targets:[{name}], support_context:[{type:"value",name,value}],
  contexts:{...}, getnearestPath, entityType, coalesceOptions }` — there is **no `attributes`**
  key; `support_context` is snake_case; `contexts` is an object (not array).
  (rock-attribute-manage-v2.js:4057-4064)
- **`nlqservice/transform`** response payload is at
  `dataObjectOperationResponse.dataObjects[0].data.jsonData.query` (note the `.query`),
  plus a `status` field. (rock-entity-search-discovery-v2.js:2841-2844)
- **`modelgovernservice/validate`** request top-level key is **`entityModel`** (not `entity`);
  **`entitygovernservice/validate`** uses `entity`. Both built by
  `createSyncValidationRequest` as a `{id,type,data}` triple with optional
  `onDemandTroubleshooting` — **no `clientState`**. (DataRequestHelper.js:991-1004,
  rock-attribute-manage-v2.js:1570)
- **`entityappmodelservice/getnearest`** (variant model): request has **no `query.id`**;
  `filters.typesCriterion: ['entityVariantModel']`, `fields.attributes: ['_ALL']`,
  `contexts: [variantContextData]`. (DataRequestHelper.js:2235-2257)
- **`entityappservice/getcombined`** request is a **combined-get envelope**, not a bare
  search query. Full chain verified in `ui-platform/src/server` (no capture needed):
  client builds `{ params:{isCombinedQuerySearch:true}, entity:{ id/name:'combinedGet',
  type:'config', data:{jsonData:{searchQueries:[{serviceName, action, searchSequence,
  searchQuery}, ...]}} } }` via `createCombinedGetRequest` (DataRequestHelper.js:1926,
  rock-entity-search-result-v2.js:4252); the server detects `isCombinedQuerySearch`
  (dataobject-route-resolver.js:222), swaps it for `params.pageSize`, sets `isIdOnly`
  on the highest-`searchSequence` leg, then `DataObjectManageService.getCombined` posts
  to `/entityappservice/getcombined` (DataObjectManageService.js:31-40, resolved via
  df-rest-service-config.js:49-53). Spec now models this as `CombinedGetRequest` +
  `SearchQueryLeg`, with `EntitySearchRequest` repurposed as the inner `entityservice`
  leg (`query`/`fields`/`options`/`sort`/`authorizationType:'accommodate'`).
  Inner-query details: `options.allowLeadingWildcard` (camelCase, not
  `ALLOW_LEADING_WILDCARD`) + `options.to`/`isIdOnly`; `sort.attributes[]` uses a
  dynamic attribute-name key = direction (`_ASC`/`_DESC`) with sibling
  `sortType`/`contexts`, plus `sort.score`; `attributesCriterion` supports
  `exacts`/`operator`/`valueProperties`; and **`filters` uses compound `and`/`or`
  arrays** (rock-entity-search-result-v2.js:4233-4248), not `isAttributesCriterionOR`.
  (DataRequestHelper.js:3259-3360, EntitySearchGridDataSource.js:110-129,354-364)
- **`entityappmodelservice/getcomposite`** request: the menu-load builder uses `id` +
  `fields.properties`; the `name`-based builder uses `fields.attributes`. `id` XOR `name`.
  (rock-relationship-manage-v2.js:1304-1307, DataRequestHelper.js:74-78)

**Response envelope — CORRECTED in spec (no `content` wrapper):**
The spec describes raw MDM responses, so result collections sit directly under
`response` (`response.entities`, `response.entityModels`, `response.configObjects`) —
NOT under `response.content.*`. The `content` wrapper seen throughout the UI is a
Falcor DAL client-side artifact. Direct evidence: the pass-through getnearest handler
reads `res.entityModels[0]` (rock-relationship-manage-v2.js:1513) and the pass-through
match response reads `response.entities` (MatchServiceManager.js:204) — neither has
`content`. Flattened in spec: `EntityGetResponse`, `EntitySearchResponse`,
`EntityModelGetResponse`, `CompositeModelResponse`, `GovernDataResponse`,
`ConfigGetResponse` (`MatchSearchResponse` was already correct).

**Still UNVERIFIED — flagged `x-unverified` in spec, need a real network capture:**
- `EntitySearchResponse.content.facets` — not built or consumed in component source.
- `EntityMutateRequest.params.authorizationType` / `intent` — not found in the save path
  (the UI sends `{ entities: [...] }` with optional `hotline` / `onDemandTroubleshooting`).

---

## Services Covered

| Tag in Spec | Real MDM Service | BFF `dataIndex` |
|---|---|---|
| Entity | `entityappservice` | `entityData` |
| EntityModel (reads) | `entityappmodelservice` | `entityModel` |
| EntityModel (writes) | `entitymodelservice` | `entityModel` |
| Configuration | `configurationservice` | `config` |
| Governance | `entitygovernservice` / `modelgovernservice` | `entityGovernData` |
| Match | `matchservice` | direct pass-through only |
| AI | `attributerservice` / `nlqservice` | direct pass-through only |

> **`entityservice` vs `entityappservice`**: `entityappservice` is an orchestration facade
> introduced on top of the raw `entityservice` persistence API. It adds app-level logic
> before delegating — e.g. calling `matchservice/search` for duplicate detection before a
> create. UI components always call `entityappservice`; `entityservice` is an internal
> downstream call made by `entityappservice` itself. The BFF config key is named
> `entityservice` (legacy naming) but maps to the URL `/entityappservice/...`.
> Duplicate detection therefore can occur at two layers: explicitly in the UI via
> `MatchServiceManager` → `matchservice/search`, and again internally within
> `entityappservice` before it delegates to `entityservice`.

---

## Direct Pass-Through Endpoints (6 total)

These 6 endpoints are called by the components via `/data/pass-through/{path}`.
The spec documents them at `/{path}` (the `data/pass-through` prefix is omitted per requirement).
They are annotated with `x-access-via: pass-through`.

| Component | Pass-through URL | Spec Path | Purpose |
|---|---|---|---|
| rock-attribute-manage-v2 | `/data/pass-through/entitygovernservice/validate` | `POST /entitygovernservice/validate` | Sync governance validation on attribute change (debounced 300ms) |
| rock-attribute-manage-v2 | `/data/pass-through/modelgovernservice/validate` | `POST /modelgovernservice/validate` | Same but when `dataIndex === 'entityModel'` (editing model definitions) |
| rock-attribute-manage-v2 | `/data/pass-through/attributerservice/generate` | `POST /attributerservice/generate` | AI attribute content generation using linked image/document assets |
| rock-attribute-manage-v2 | `/data/pass-through/matchservice/search` *(via MatchServiceManager)* | `POST /matchservice/search` | Duplicate detection before create/update of identity attributes |
| rock-relationship-manage-v2 | `/data/pass-through/entityappmodelservice/getnearest` | `POST /entityappmodelservice/getnearest` | Fetch nearest variant model for current context |
| rock-entity-search-discovery-v2 | `/data/pass-through/nlqservice/transform` | `POST /nlqservice/transform` | Transform natural-language AI search query to MDM criteria |

---

## BFF-Routed Endpoints (Falcor DataObjectManager)

These calls go through the BFF Falcor layer (`/data/{dataIndex}.json`). The BFF fans
out to the actual MDM APIs listed below. All are now documented in `mdm.yaml`.

### `entityData` → `entityappservice`

| Component | DataObjectManager Operation | MDM Endpoint | Purpose |
|---|---|---|---|
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch entity attribute values for editing |
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch entity govern data (entityGovernData) |
| rock-attribute-manage-v2 | `create` | `POST /entityappservice/create` | Save new entity |
| rock-attribute-manage-v2 | `update` | `POST /entityappservice/update` | Save changes to existing entity |
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappservice/get` | Duplicate/match check (via MatchServiceManager) |
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch matched entity external name + identifier |
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch related entity for source-info popover |
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch entity with `hasimages`/`hasdocuments` for AI image gen |
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch digital asset entities (image/document) by ID |
| rock-relationship-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch entity for source-info popover |
| rock-relationship-manage-v2 | `getbyids` | `POST /entityappservice/get` | Fetch root entity enhancer attributes for variant model |
| rock-entity-search-discovery-v2 | `searchandget` | `POST /entityappservice/getcombined` | Search entity grid (complex criteria + pagination) |
| rock-entity-search-discovery-v2 | `searchandget` | `POST /entityappservice/get` | Fetch reference entities for AI tag resolution |

### `entityModel` → `entityappmodelservice` / `entitymodelservice`

| Component | DataObjectManager Operation | MDM Endpoint | Purpose |
|---|---|---|---|
| rock-attribute-manage-v2 | `getbyids` | `POST /entityappmodelservice/get` | Fetch attribute models for AI search context |
| rock-attribute-manage-v2 | `create` / `update` | `POST /entitymodelservice/create` / `update` | Save model object (when dataIndex === 'entityModel') |
| rock-relationship-manage-v2 | `getbyids` (entityCompositeModel) | `POST /entityappmodelservice/getcomposite` | Fetch composite model for relationship config and rendering |
| rock-relationship-manage-v2 | `getbyids` (relationshipModel) | `POST /entityappmodelservice/get` | Fetch relationship model for domain membership check |
| rock-relationship-manage-v2 | `getbyids` (variantModel settings) | `POST /entityappmodelservice/get` | Fetch variant model settings for context |
| rock-entity-search-discovery-v2 | `getbyids` | `POST /entityappmodelservice/get` | Fetch attribute models for search column configuration |
| rock-entity-search-discovery-v2 | `searchandget` *(commented out)* | `POST /entityappmodelservice/get` | User model lookup for workflow assignee criterion |

### `config` → `configurationservice`

| Component | Mechanism | MDM Endpoint | Purpose |
|---|---|---|---|
| rock-attribute-manage-v2 | `requestConfig('rock-attribute-manage-v2', ctx)` | `POST /configurationservice/get` + `getnearest` | Load component config on startup |
| rock-attribute-manage-v2 | `requestConfig('rock-attribute-apps', ctx)` | `POST /configurationservice/get` + `getnearest` | Load AI app list config (marketplace display sequences) |
| rock-relationship-manage-v2 | `requestConfig('rock-relationship-manage-v2', ctx)` | `POST /configurationservice/get` + `getnearest` | Load relationship component config |
| rock-entity-search-discovery-v2 | `requestConfig('rock-entity-search-discovery-v2', ctx)` | `POST /configurationservice/get` + `getnearest` | Load search discovery config (includes AI search toggle) |

**BFF config merge sequence** (for `x-` prefixed config IDs / personalization flow):
1. `configurationservice/get` — base config (`sys_{component}-base_{type}`)
2. `configurationservice/get` — plugin config (`plugin_{component}-base_{type}`)
3. `configurationservice/get` — context settings (`sys_config-context-settings-base_{type}`)
4. `configurationservice/getnearest` — tenant overrides (getnearestPath + getnearestReturnAll)
5. `configurationservice/getnearest` — add-on app overrides
6. BFF merges: base → add-on → tenant (in order)

---

## Traced Helper Calls (previously untraced)

### Helper 1: `DataRequestHelper.getBusinessConditionExternalNameByIds`

**Source:** `ui-platform-business-components-v2/src/helpers/DataRequestHelper.js:4078`  
**Called by:** rock-entity-search-discovery-v2 (lines ~1595, ~1699) — resolves display names for business condition IDs used in workflow criteria.

**Call chain:**
```
DataObjectManager.createRequest('getbyids', req, '', { dataIndex: 'entityModel' })
  → DataObjectManager.initiateRequest()
  → FalcorManager.get() → /data/entityModelData.json (BFF Falcor)
  → BFF DataObjectManageService: entityModel → entitymodelservice/get
  → df-rest-service-config: entitymodelservice/get → POST /entityappmodelservice/get
```

**Actual MDM endpoint:** `POST /entityappmodelservice/get` (already in spec)

**Request:**
```json
{
  "params": {
    "query": {
      "ids": ["<bc-id-1>", "..."],
      "filters": { "typesCriterion": ["businessCondition"] },
      "valueContexts": [{ "source": "internal", "locale": "en-US" }]
    },
    "fields": { "attributes": ["name"] }
  }
}
```

**Response:** Standard `entityModels[]` — extracts `data.attributes.name.values[].value` keyed by locale.  
**No new endpoint needed** — `businessCondition` is just another `typesCriterion` on `entityappmodelservice/get`.

---

### Helper 2: `MatchServiceManager.getMatchEntityInfo`

**Source:** `ui-platform-dataaccess/src/managers/MatchServiceManager.js:14`  
**Called by:** rock-attribute-manage-v2 before every `create`, and before `update` when identity attributes (`isEntityIdentifier`, `isMatchAttribute`, `isExternalName`) are modified.

**Call chain:**
```
MatchServiceManager.getMatchEntityInfo()
  → MatchServiceManager.matchServiceCall()
  → LiquidDataObjectManager.rest('/data/pass-through/matchservice/search', request)
  → BFF pass-through proxy: strips prefix → matchservice/search
  → df-rest-service-config: matchservice/search → POST /matchservice/search
```

**Actual MDM endpoint:** `POST /matchservice/search` (**new — added to spec**)

**Request:**
```json
{
  "entity": {
    "id": "<entity-id>",
    "type": "<entity-type>",
    "data": { "attributes": { ... identity attributes only ... } }
  },
  "params": {
    "matchThreshold": 85,
    "recommendationViewEnabled": true
  }
}
```

**Response classification logic:**
- `statusDetail.probabilisticMatch: false` → deterministic: any returned entity = duplicate
- `statusDetail.probabilisticMatch: true` → ML-based scoring:
  - `score < createThreshold` → safe to create (no real duplicate)
  - `score > mergeThreshold` → should merge
  - between thresholds → `createOrMergeList` (user decides)
- `matchFound = false` if result list is empty OR all scores are below `createThreshold`

---

## Authentication Headers (Required for Direct MDM Calls)

These headers are normally injected by the BFF. Direct callers must supply them.

| Header | Description |
|---|---|
| `x-rdp-tenantId` | Tenant identifier |
| `x-rdp-userid` | `{userId}_user` format |
| `x-rdp-username` | Display name |
| `x-rdp-useremail` | User email |
| `x-rdp-clientid` | Client ID |
| `x-rdp-userroles` | JSON array of role strings |
| `x-rdp-defaultrole` | Default role |
| `x-rdp-ownershipdata` | JSON ownership metadata |
| `x-rdp-authtoken` | HMAC-SHA256 signature (computed from query string + shared secret) |

---

## Next Steps

1. **Capture a real network trace** — run the three components in a dev environment
   with the network tab open and capture actual `/data/{dataIndex}.json` and
   `/data/pass-through/*` payloads. This is the only way to resolve the two remaining
   `x-unverified` items (`EntitySearchResponse.content.facets` and
   `EntityMutateRequest.params.authorizationType`/`intent`) and to confirm the
   corrected `attributerservice/generate` body end-to-end.

2. **Expand schemas with real examples** — enrich the schema definitions with the
   captured payloads above.
