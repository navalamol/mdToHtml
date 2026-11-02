# Dimension contract

`kb_lint.py` enforces that each area covers these seven dimensions. This file defines what counts as
coverage and what gets rejected. A dimension counts as covered when **any** doc in the area covers
it, so moving content out of the README never breaks the contract.

## 1. architecture
**Accept:** module/layer table with responsibilities; the interface-versus-implementation split
where the repo has one (a contract module and its engine-specific implementations); where a
synchronous boundary becomes asynchronous.
**Reject:** restating a naming convention that `CLAUDE.md` already documents.

## 2. patterns
**Accept:** the extension rule a contributor must follow, with the concrete classes that implement
the pattern. Typical shapes: a component/stage pipeline with a base class per stage, a
registry-backed strategy lookup, a factory that wires a topology, a template base class subclassed
per resolver, a visitor over a value tree, a service-provider interface for custom actions, an
adaptor entry point dispatching on an action string.
**Reject:** a class list whose names contain "Factory" or "Strategy" with no extension rule.
A pattern with no "to add one, do X" sentence is not documented.

## 3. flow
**One** ordered walk of the area — one section, one form. Never two sections walking the same hops.

Pick the denser form for the shape of the area:

- **ASCII call chain** when the path is a nested call tree with layer annotations. It costs fewer
  tokens than a table for nesting, and it shows a transport boundary (for example
  `= = = KAFKA = = =`) in one line. Put the envelope and mutation facts in bullets under the diagram.
- **Table** when the path is a linear hop sequence with per-hop conditions:

| Hop | Condition | Envelope | Mutates |
|---|---|---|---|
| `Class#method` | the branch condition that reaches this hop, or `—` | the type carried in, and the serialization boundary if one is crossed | `in place` / `no` / what is added or stripped |

**Accept:** every branch condition, every terminal state, the error path, the type on each side of a
serialization boundary, and which hops mutate their input.
**Reject:** two tables walking the same hops; a call list with no ordering; an envelope column that
names a class but not what changed.

Use a second table only when the area genuinely has two different hop sequences (for example a sync
entry and an async pipeline). Two views of one sequence belong in one section.

## 4. reusable
**Accept:** the callable surface for code outside the area, plus preconditions and side effects.
**Reject:** "this module is shared" with no entry point.

## 5. config-forks
**Accept:** setting name, exact lookup call, allowed values, behavior per value, class where it
is read. Method-argument booleans that select a branch count and must be listed.
**Reject:** a setting name with no behavior on either side of the fork.

## 6. contracts-samples
**Accept:** public method signatures plus at least one real JSON payload per entry point,
each citing the file it came from. See `samples-guide.md`.
**Reject:** a hand-written shape, or a signature with no payload.

## 7. related-kb
**Accept:** links to sibling areas with what each one owns.
**Reject:** absent — it is the anti-duplication mechanism.

## Writing rules

### Anchors — name symbols, not lines

- The anchor is `Class#method`, or `Class.CONSTANT`. It is greppable and it survives edits.
- A line number is allowed **only** for a construct that has no name: a `switch` arm, a lambda, an
  inline branch, or a specific overload among several. Write it as `Class#method` first, then the
  line, and only where the reader cannot find the code from the name.
- Never carry line numbers in a table. They are transient, they rot silently, and a reader who has
  the method name can grep for it.
- `kb_lint.py` warns above 3 line references per document.

### Size — a doc is a token budget

The area `README.md` is loaded on **every** question about the area. Sub-docs load only when the
question needs them. So the README carries routing and the shape of the area, nothing more.

| Doc | Limit | Holds |
|---|---|---|
| `README.md` | **130 lines** | scope, `## Files` table, architecture table, the one flow table, reusable surface, related KB, stamp |
| `patterns.md` | 200 | design patterns and the rule to extend each |
| `contracts.md` | 200 | signatures, JSON samples, config and fork table |
| any other doc | 200 | one subject |

- Over a limit, **move** substance to a sibling doc and link it from `## Files`. Never delete
  substance to fit.
- Nobody reads a whole area, so total area size does not matter. Per-doc size is what costs tokens
  on every question.

### Other
- Mark anything you could not confirm from source with `UNVERIFIED:` and say what you checked.
- Flag name collisions loudly. Where several same-name classes exist in different packages, an area
  that touches one must name the package.
- Prefer a table over prose wherever the content is uniform rows.
- Keep any single doc under ~150 lines. Split into a sub-doc instead of growing one file.
