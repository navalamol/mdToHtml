<!-- knowledge-sync:begin -->
## Knowledge Base

`.claude/knowledge/` holds the curated map of this codebase. Read it before scanning source.

- **Start at `.claude/knowledge/INDEX.md`** — the router. It names the area that owns your question,
  its modules and its entry point. Do not read whole area folders; each area README lists its
  sub-docs and what each one covers.
- **`.claude/knowledge/PATTERNS.md`** — repo-wide patterns and the rule to extend each. Read it
  before adding a class rather than editing one.
- **`.claude/knowledge/recipes/`** — task playbooks for changes that span files. Follow the recipe
  instead of rediscovering the wiring order.
- **`.claude/knowledge/kb-index.json`** — module glob to area registry. To find the owning area of a
  file: `python3 .claude/skills/knowledge-sync/scripts/kb_impact.py --files <path>`
  (on Windows: `py -3 .claude\skills\knowledge-sync\scripts\kb_impact.py --files <path>`).

**Required before committing a change under `<source_root>/`:** run the `knowledge-sync`
skill in mode `sync` and update the impacted area docs. The skill computes the impacted areas from
the staged diff and gates on `kb_lint.py` exiting 0.
<!-- knowledge-sync:end -->
