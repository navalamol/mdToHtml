# CLAUDE.md wiring

The skill is only triggered when the repository's own instructions point at it.

The canonical text is `templates/claude-md-block.md`, delimited by
`<!-- knowledge-sync:begin -->` / `<!-- knowledge-sync:end -->` markers. It is applied
automatically — do not paste it by hand:

```bash
python3 .claude/skills/knowledge-sync/scripts/kb_bootstrap.py --target <repo> --source-root <dir>
```

The installer (`kb_bootstrap.py --install-to <repo>`) runs exactly this as its last step, so a fresh
install needs nothing further. The operation is idempotent: it appends the block only when the
`knowledge-sync:begin` marker is absent, creates `CLAUDE.md` if the repository has none, and
substitutes `<source_root>` from `kb-index.json`.

Edit the block afterwards if the repository keeps its instructions somewhere else, or if the
knowledge base lives outside `.claude/knowledge`. Keep the markers — they are what makes a re-run
leave your edits alone.
