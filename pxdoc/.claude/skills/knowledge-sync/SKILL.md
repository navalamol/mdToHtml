---
name: knowledge-sync
description: Create or update the repo knowledge base in .claude/knowledge from the code changes being committed, and audit existing areas for dimension coverage. Use when the user says "update knowledge", "sync knowledge", "/knowledge-sync", when preparing a commit or PR that changed service code, or when asked whether the knowledge base still matches the code.
---

# Knowledge Sync

Keeps `.claude/knowledge/` in step with the code. Every path below is resolved from the
git repository root, so the skill works in any clone and in any repository.

Repository-specific settings live in `.claude/knowledge/kb-index.json`: `knowledge_root`,
`source_root`, `source_extensions`, `symbol_extensions`, and the per-area module globs. Read that
file before assuming a layout. If it does not exist, run mode `bootstrap` first.

Command examples use `python3`. On Windows use `py -3` (or `python`) and backslash paths; the
scripts themselves are platform independent.

## Guardrails

- Never write an absolute machine path (`/Users/...`, `C:\...`) into a knowledge file. Use
  paths relative to the repository root.
- Never invent behavior. Every statement must come from a file you read in this session.
  Unverified claims go under an explicit `UNVERIFIED:` marker.
- Do not restate what another area already documents. Link to it under `## Related KB`.
- Knowledge files are prose for humans and agents: write normal English, not compressed notes.
- Anchor with `Class#method`. A line number is allowed only for an unnamed construct (a `switch` arm,
  a lambda, one overload among several), never in a table. `kb_lint.py` warns above 3 per doc.
- Size is enforced: `README.md` ≤130 lines, any other doc ≤200. The README is loaded on every
  question about the area, so it holds routing and shape only — scope, `## Files`, architecture, the
  one flow walk, reusable surface, related KB. Substance goes in `contracts.md`, `patterns.md` or a
  subject doc, which load only when needed.
- One flow section per area, not a control-flow section plus a data-flow section. Use an ASCII call
  chain for a nested call tree, a table for a linear hop sequence.

## Knowledge base layout

| Path | What it is | Who updates it |
|---|---|---|
| `.claude/knowledge/INDEX.md` | router: area, owned modules, entry point, what to ask it | every `sync` that adds an area or changes an entry point |
| `.claude/knowledge/PATTERNS.md` | repo-wide patterns and the rule to extend each | `sync` when a change adds or alters a pattern |
| `.claude/knowledge/recipes/` | task playbooks for multi-file wiring | on request, or when a `sync` reveals multi-file wiring an agent got wrong |
| `.claude/knowledge/<area>/README.md` | area index, ≤130 lines | `sync` and `backfill` |
| `.claude/knowledge/<area>/contracts.md` | signatures, samples, config forks | `sync` and `backfill` |
| `.claude/knowledge/<area>/patterns.md` | area-specific extension rules | `sync` and `backfill` |
| `.claude/knowledge/kb-index.json` | settings and the module glob to area registry | `sync` when a module is added or moved |

## Mode selection

| Trigger | Mode |
|---|---|
| `kb-index.json` does not exist yet | `bootstrap` |
| Committing / preparing a PR, "update knowledge" | `sync` (default) |
| "audit knowledge", "is the KB current" | `audit` |
| "backfill", lint reports missing dimensions | `backfill` |
| Changed files map to no area | `new-area` (runs inside `sync`) |

## Mode: bootstrap

Run once per repository, before any other mode. The installer normally did steps 1 and 2 already —
re-run the script if `.claude/knowledge/` or the `CLAUDE.md` block is missing.

1. Determine `source_root`: the directory that holds the code this KB will describe (for a
   single-module repo, `src`; for a monorepo, the directory holding the modules). Ask the user if it
   is ambiguous.

2. Seed the knowledge base and wire it into `CLAUDE.md`. The script is idempotent — it never
   overwrites an existing file or a block that is already there:

   ```bash
   python3 .claude/skills/knowledge-sync/scripts/kb_bootstrap.py --source-root <dir>
   ```

   It creates `.claude/knowledge/{kb-index.json,INDEX.md,PATTERNS.md}`, surveys the tracked files
   for `source_root`, `source_extensions` and `symbol_extensions`, writes the `Last verified` stamp
   into the two shared docs, and appends the block from `templates/claude-md-block.md` to
   `CLAUDE.md` (creating that file if it does not exist). Without the block the skill is never
   triggered on a commit, so do not skip this step.

3. Read back `.claude/knowledge/kb-index.json` and correct any surveyed value that is wrong for this
   repository. Report what you changed.

4. Pick two or three starting areas from the code's real behavior, not from its directory names,
   and run mode `new-area` for each. Do not carve up the whole repository in one pass.

## Mode: sync

1. Compute impact. Run from the repository root :

   ```bash
   python3 .claude/skills/knowledge-sync/scripts/kb_impact.py            # staged (pre-commit)
   python3 .claude/skills/knowledge-sync/scripts/kb_impact.py --worktree # uncommitted
   python3 .claude/skills/knowledge-sync/scripts/kb_impact.py --range <default-branch>..HEAD
   ```

   Read the JSON only — do not read the changed files yet.

2. If `areas` is empty and `unmapped_source_files` is empty, stop and report "no knowledge impact".

3. For each area with `"action": "update"`:
   - Read the diff for its `primary_changes` (`git diff --cached -- <paths>`), not the whole files.
   - Read the area's existing `README.md` and only the sub-doc whose subject the diff touches.
   - Edit the affected sections in place. Follow `references/dimensions.md` for what belongs
     in each section and `references/area-template.md` for section order and naming.
   - Update the `Last verified` stamp to
     ``<today> | commit `<git rev-parse --short HEAD>` | branch `<current branch>` `` — the commit is
     what makes drift measurable, so never write the date alone.
   - If the change alters a repo-wide pattern or adds one, update `PATTERNS.md` instead of describing
     the pattern inside the area doc.
   - If the change alters an area's entry point or owned modules, update the `INDEX.md` row.

4. For each area with `"action": "verify-pointers"`: only confirm that statements about that
   shared module are still true. Do not expand the area.

5. For `unmapped_source_files`: group them by module. For a group that represents a real
   feature area, run mode `new-area`. For incidental changes (tests, config, formatting), list
   them in the report as "no area needed" and move on.

6. Register new areas: add the module globs to `.claude/knowledge/kb-index.json` under
   `areas.<name>.primary` (and `secondary` for modules the area only reads through).

7. Verify: `python3 .claude/skills/knowledge-sync/scripts/kb_lint.py <changed areas>`.
   Fix every ERROR it reports for the areas you touched. Exit code 0 is the gate.

8. Report: one table of `area | sections changed | new samples added | lint status`.

## Mode: audit

```bash
python3 .claude/skills/knowledge-sync/scripts/kb_lint.py --json
python3 .claude/skills/knowledge-sync/scripts/kb_impact.py --drift
```

`kb_lint` reports structure: missing dimensions, missing samples, missing commit stamp, source
references that no longer resolve, areas not routed from `INDEX.md`.

`--drift` reports content age: for each area, the commits that touched its owned paths since the
commit recorded in its README. A high count means the doc describes older code; the `sample` field
names the commits to read. Report both, ordered by drift. Do not edit anything in this mode.

## Mode: backfill

For one area at a time, in this order — cheapest and highest value first:

1. `contracts.md` — a real JSON payload per public entry point plus the signatures. Follow
   `references/samples-guide.md`; harvest from the repository's own test fixtures, never hand-write
   a shape.
2. `## Flow` in the README — one ordered walk with the branch condition, envelope and mutation per
   hop. If the area already has a control-flow section and a data-flow section, merge them.
3. `patterns.md` — only patterns a reader cannot guess from class names; reference `PATTERNS.md`
   instead of restating a repo-wide one.
4. `contracts.md` `## Config / Forks` — every setting or flag that changes which branch executes,
   with the lookup call and the behavior on each side.
5. `## Reusable Components` and `## Related KB` in the README — pointers only.
6. Re-run the lint: it fails on a README over 130 lines or any doc over 200. Move substance to a
   sibling doc rather than cutting it.

Re-run `kb_lint.py <area>` after each area and stop when it exits 0.

## Mode: new-area

1. Pick a kebab-case name for the behavior, not for a module (`entity-read`, not `entity-service`).
2. Create `.claude/knowledge/<name>/README.md` from `references/area-template.md`.
3. Fill it from the code, one section at a time, then split any section past ~80 lines into a
   sibling sub-doc and link it from the README `## Files` table.
4. Add the area to `kb-index.json`, and add its row to `INDEX.md`.
5. `kb_lint.py <name>` must exit 0.

## Mode: new-recipe

Write one when a `sync` shows that a change needed several coordinated edits and the order matters.
Create `.claude/knowledge/recipes/<task>.md` with: when to use, files touched, numbered steps with
the reason each is required, the verify command, then a symptom-to-missed-step table. The
failure-mode table is the point of a recipe — take the exact error text from the code that throws it.

## Optional: run it automatically

The scripts are plain Python and take no interactive input, so a git hook can surface impact
without invoking an agent. Add to `.git/hooks/pre-commit` (per developer, not committed):

```sh
#!/bin/sh
python3 ".claude/skills/knowledge-sync/scripts/kb_impact.py" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); a=[k for k,v in d["areas"].items() if v["action"]=="update"]; print("knowledge areas needing update:", ", ".join(a) or "none")'
```

That prints the reminder; the actual doc edit still runs through this skill.
