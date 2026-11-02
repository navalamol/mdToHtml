# Knowledge Base — Router

Read this file first. It tells you which area doc answers your question, so you never have to
open every area README. Paths are relative to the repository root. Source lives under
`<source_root>/`.

Cross-area references: `PATTERNS.md` (repo-wide patterns), `recipes/` (task playbooks),
`kb-index.json` (module → area registry, machine readable).

## Areas

| Area | Owns (modules) | Entry point | Ask here when |
|---|---|---|---|
| [example-area](example-area/) | `<module>` | `<Class>#<method>` | the question this area answers |

## Question routing

| You need | Go to |
|---|---|
| Repo-wide pattern, or how to extend one | `PATTERNS.md` |
| Step-by-step wiring for a common task | `recipes/` |
| Which area owns a file you are about to change | `kb-index.json`, or run `python3 .claude/skills/knowledge-sync/scripts/kb_impact.py --files <path>` |

## Last verified

YYYY-MM-DD | commit `<short sha>` | branch `<branch>`
