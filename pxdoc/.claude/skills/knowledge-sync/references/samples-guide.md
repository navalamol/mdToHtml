# Sample data constructs

Goal: an agent should be able to construct a valid request for any entry point in this area
without reading test sources.

## Where to harvest

Search the owning modules, in this order, from the repository root. `$AREA_MODULES` is the area's
`primary` glob from `kb-index.json`; `<fixtures>` is wherever this repository keeps test fixtures
(`src/test/resources`, `__fixtures__`, `testdata`, ...).

```bash
AREA_MODULES="<source_root>/<module>"
# fixtures used by the area's own tests
git ls-files "$AREA_MODULES/<fixtures>/**/*.json"
# fixtures whose name matches the entry point
git grep -l "<EntryPointClass>" -- "$AREA_MODULES/<test dir>/**"
```

Take the smallest fixture that still exercises the contract. If no fixture exists, build the
payload from the repository's builder or factory class for that type, and say in the doc that the
sample was derived from the builder, not from a fixture.

## What to include per entry point

1. Signature: `Class#method(args) -> returnType`, plus the checked exceptions that callers handle.
2. Request payload: one ```json block, trimmed to the fields the code actually reads.
3. Response or emitted message: the shape on the other side of the boundary. For an async hop,
   show the queue message envelope, and name the topic and how the topic name is resolved.
4. One error response, since callers must branch on it.

## Trimming rules

- Keep every field the code branches on. Drop repeated collection members: keep one, then `"..."`.
- Keep a field whose absence changes behavior, and say so in a comment line above the block.
- Cite the origin under the block: `Source: <source_root>/<module>/<fixtures>/<file>`.
  `kb_lint.py` checks that this path resolves, so write it relative to the repository root.

## Redaction — required

Fixtures may carry real customer or tenant data. Before pasting:

- Replace tenant ids with `<tenantId>`, user ids and emails with `<userId>` / `user@example.com`.
- Replace customer names, product identifiers, and URLs with obvious placeholders.
- Never paste a credential, token, connection string, or private host name. If a fixture contains
  one, do not use that fixture.
- Keep enum values, action strings, attribute names, and context ids verbatim — those are the
  contract.
