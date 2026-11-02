#!/usr/bin/env python3
"""Install the knowledge-sync skill into a repository and wire it into CLAUDE.md.

The skill is vendored per repository, into <repo>/.claude/skills/knowledge-sync/.
Nothing is installed at user or machine level.

Cross-platform (macOS, Linux, Windows) and idempotent: it never overwrites an
existing file, and never appends the CLAUDE.md block twice.

Usage:
  kb_bootstrap.py                            # target = current git repository root, seed only
  kb_bootstrap.py --target /path/to/repo     # seed that repository
  kb_bootstrap.py --install-to /path/to/repo # also copy this skill into <repo>/.claude/skills/
  kb_bootstrap.py --source-root src          # record source_root in kb-index.json

On Windows use `py -3 kb_bootstrap.py ...`. Paths may use either separator.
"""
import argparse
import datetime
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATES = SKILL_DIR / "templates"
SEEDS = ("kb-index.json", "INDEX.md", "PATTERNS.md")
MARKER = "<!-- knowledge-sync:begin -->"
STAMP_PLACEHOLDER = re.compile(r"^YYYY-MM-DD \| commit .*$", re.M)
CODE_EXTENSIONS = {".java", ".kt", ".scala", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rb",
                   ".cs", ".rs", ".php", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp", ".m", ".mm"}
CONFIG_EXTENSIONS = {".json", ".properties", ".yml", ".yaml", ".xml", ".toml", ".ini", ".conf"}


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(root)] + list(args),
                          capture_output=True, text=True).stdout.strip()


def repo_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, check=True)
    return Path(out.stdout.strip())


def stamp_for(root: Path) -> str:
    """The 'Last verified' line the lint requires: date | commit | branch."""
    sha = git(root, "rev-parse", "--short", "HEAD") or "0000000"
    branch = git(root, "rev-parse", "--abbrev-ref", "HEAD") or "HEAD"
    return f"{datetime.date.today()} | commit `{sha}` | branch `{branch}`"


def survey(root: Path, source_root: str) -> dict:
    """Derive source_root, source_extensions and symbol_extensions from the tracked files."""
    files = [f for f in git(root, "ls-files").splitlines() if f.strip()]
    code = [f for f in files if Path(f).suffix in CODE_EXTENSIONS]

    if not source_root and code:
        tops = Counter(f.split("/")[0] for f in code if "/" in f)
        if tops:
            name, count = tops.most_common(1)[0]
            if count >= 0.6 * len(code):
                source_root = name

    scoped = [f for f in files if f.startswith(source_root)] if source_root else files
    counts = Counter(Path(f).suffix for f in scoped)
    source_extensions = sorted(e for e, n in counts.items()
                               if n >= 3 and e in CODE_EXTENSIONS | CONFIG_EXTENSIONS)
    scoped_code = [f for f in scoped if Path(f).suffix in CODE_EXTENSIONS]
    symbol_extensions = sorted(e for e, n in Counter(Path(f).suffix for f in scoped_code).items()
                               if scoped_code and n >= 0.25 * len(scoped_code))
    return {"source_root": source_root,
            "source_extensions": source_extensions,
            "symbol_extensions": symbol_extensions}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default=None, help="repository root (default: current git repo)")
    ap.add_argument("--install-to", default=None,
                    help="repository to copy this skill into; implies --target")
    ap.add_argument("--source-root", default="", help="directory holding the code the KB describes")
    args = ap.parse_args()

    if sys.version_info < (3, 10):
        sys.exit(f"python 3.10 or newer required, running {sys.version.split()[0]}")

    target = Path(args.install_to or args.target).resolve() if (args.install_to or args.target) \
        else repo_root()
    if not (target / ".git").exists():
        sys.exit(f"not a git repository: {target}")

    if args.install_to:
        dest = target / ".claude" / "skills" / "knowledge-sync"
        shutil.copytree(SKILL_DIR, dest, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", ".DS_Store", "README.md"))
        print(f"installed: {dest}")

    kb = target / ".claude" / "knowledge"
    kb.mkdir(parents=True, exist_ok=True)
    stamp = stamp_for(target)
    registry = kb / "kb-index.json"

    if registry.exists():
        print("kb-index.json: already present — left untouched")
        spec = json.loads(registry.read_text(encoding="utf-8"))
        source_root = args.source_root or spec.get("source_root", "")
        if args.source_root and spec.get("source_root") != args.source_root:
            spec["source_root"] = args.source_root
            registry.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
            print(f"kb-index.json: source_root set to {args.source_root!r}")
    else:
        spec = json.loads((TEMPLATES / "kb-index.json").read_text(encoding="utf-8"))
        spec.update(survey(target, args.source_root))
        spec["areas"] = {}
        source_root = spec["source_root"]
        registry.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
        print(f"kb-index.json: seeded — source_root={spec['source_root'] or '<repo root>'!r}, "
              f"source_extensions={spec['source_extensions']}, "
              f"symbol_extensions={spec['symbol_extensions']}")

    for name in ("INDEX.md", "PATTERNS.md"):
        dest_file = kb / name
        if dest_file.exists():
            print(f"{name}: already present — left untouched")
            continue
        text = (TEMPLATES / name).read_text(encoding="utf-8")
        text = STAMP_PLACEHOLDER.sub(stamp, text)
        if source_root:
            text = text.replace("<source_root>", source_root)
        dest_file.write_text(text, encoding="utf-8")
        print(f"{name}: seeded and stamped {stamp}")

    block = (TEMPLATES / "claude-md-block.md").read_text(encoding="utf-8")
    if source_root:
        block = block.replace("<source_root>", source_root)

    claude_md = target / "CLAUDE.md"
    existing = claude_md.read_text(encoding="utf-8") if claude_md.exists() else ""
    if MARKER in existing:
        print("CLAUDE.md: knowledge-sync block already present — left untouched")
    else:
        separator = "" if not existing else ("\n" if existing.endswith("\n") else "\n\n")
        claude_md.write_text(existing + separator + block, encoding="utf-8")
        print("CLAUDE.md: knowledge-sync block appended" if existing
              else "CLAUDE.md: created with the knowledge-sync block")

    print("\nNext step: ask an agent to 'sync knowledge'. It runs mode new-area for two or three\n"
          "areas, which is the part that needs reading the code. Check the detected values in\n"
          ".claude/knowledge/kb-index.json first if the survey guessed wrong.\n"
          f"Gate: {Path(sys.executable).name} .claude/skills/knowledge-sync/scripts/kb_lint.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
