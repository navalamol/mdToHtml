# <Area Title> — Knowledge Base

**Modules owned:** `<source_root>/<module>/`, ...
**Entry points:** `<Class>#<method>` (REST / queue / pipeline stage)
**Last verified:** YYYY-MM-DD | commit `<short sha>` | branch `<branch>`

One paragraph: what this area does, who calls it, what it produces. No history, no roadmap.

## Files

The README is an index: keep it under 130 lines and put substance in the sub-docs, which load only
when a question needs them.

| Doc | Covers |
|---|---|
| `README.md` | this index: scope, architecture, flow, reusable surface, related KB |
| `patterns.md` | design patterns and the rule to extend each |
| `contracts.md` | signatures, JSON samples, config and fork table |
| `<subject>.md` | one subject in depth |

## Scope

In scope / out of scope, as two short lists. Name the area that owns each out-of-scope item.

## Architecture

Layers and module boundaries as a table: `layer | module | class | responsibility`.
State the technology split where one exists (contract module versus engine implementation).

## Design Patterns  *(→ `patterns.md` when the README would exceed 130 lines)*

Only patterns that change how a reader must write code here, and only patterns specific to this area
— repo-wide patterns belong in `.claude/knowledge/PATTERNS.md`. For each: pattern name, the
concrete classes that implement it, and the rule a contributor must follow to extend it
(for example: "new strategy = register in `StrategyStore`, extend `AbstractStrategy`").
Reference `.claude/knowledge/PATTERNS.md` for repo-wide patterns instead of repeating them.

## Flow

One ordered table from entry point to terminal state — no second table for envelopes:

| Hop | Condition | Envelope | Mutates |
|---|---|---|---|

Anchor hops with `Class#method`, not line numbers. Name the serialization boundary (queue topic,
REST body, search document) and the type on each side in the envelope column.

## Config / Forks  *(→ `contracts.md`)*

| Setting | Lookup | Values | Behavior per value |
|---|---|---|---|

Include method-argument flags that pick a branch, not only tenant or environment settings. Every row
must name the class and method where the fork is read.

## Contracts & Samples  *(→ `contracts.md`)*

Method signatures for every public entry point, then at least one real ```json payload per
entry point, each with its source file path. See `samples-guide.md`.

## Reusable Components

What code outside this area can call, and the precondition for calling it.

## Related KB

Pointers to other areas. Say what each one owns so nobody documents it twice here.

## Last verified

YYYY-MM-DD | commit `<short sha>` | branch `<branch>`. Line numbers drift; class and method names
are stable. The commit is required: `kb_impact.py --drift` measures doc age from it.
