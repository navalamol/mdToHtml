#!/usr/bin/env python3
"""Map changed source files to knowledge areas.

All paths are resolved relative to the git repository root, so the script works
from any clone location. Everything repository-specific (source root, file
extensions, area globs) comes from .claude/knowledge/kb-index.json.
Prints JSON on stdout.

Usage:
  kb_impact.py                       # staged changes (default, pre-commit case)
  kb_impact.py --worktree            # unstaged + staged changes
  kb_impact.py --range origin/main..HEAD
  kb_impact.py --files a/B.java c/D.java
  kb_impact.py --drift               # doc-age report for every area
"""
import argparse
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

LAST_VERIFIED = re.compile(r"(\d{4}-\d{2}-\d{2})\s*\|\s*commit\s*`([0-9a-f]{7,40})`")
DEFAULT_SOURCE_EXTENSIONS = [".java", ".json", ".properties", ".yml", ".yaml", ".xml"]


def repo_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, check=True)
    return Path(out.stdout.strip())


def git_lines(root: Path, args: list[str]) -> list[str]:
    out = subprocess.run(["git", "-C", str(root)] + args,
                         capture_output=True, text=True, check=True)
    return [line for line in out.stdout.splitlines() if line.strip()]


def changed_files(root: Path, mode: str, rev_range: str | None) -> list[str]:
    if mode == "range":
        return git_lines(root, ["diff", "--name-only", "--diff-filter=d", rev_range])
    if mode == "worktree":
        tracked = git_lines(root, ["diff", "--name-only", "--diff-filter=d", "HEAD"])
        untracked = git_lines(root, ["ls-files", "--others", "--exclude-standard"])
        return sorted(set(tracked + untracked))
    return git_lines(root, ["diff", "--name-only", "--cached", "--diff-filter=d"])


def load_index(root: Path) -> dict:
    path = root / ".claude" / "knowledge" / "kb-index.json"
    if not path.exists():
        sys.exit(f"registry not found: {path.relative_to(root)} — "
                 f"run the knowledge-sync skill in mode 'bootstrap' to create it")
    return json.loads(path.read_text())


def matches(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, p) or fnmatch.fnmatch(path, p.rstrip("/*") + "/*")
               for p in patterns)


def last_verified(doc_dir: Path) -> tuple[str | None, str | None]:
    """(date, commit) recorded in the area README, either may be None."""
    readme = doc_dir / "README.md"
    if not readme.exists():
        return None, None
    text = readme.read_text(errors="replace")
    found = LAST_VERIFIED.search(text)
    if found:
        return found.group(1), found.group(2)
    legacy = re.search(r"Last verified\D*(\d{4}-\d{2}-\d{2})", text)
    return (legacy.group(1) if legacy else None), None


def drift(root: Path, commit: str | None, globs: list[str]) -> dict:
    """Commits touching the area's owned paths since the recorded commit."""
    if not commit or not globs:
        return {"since_commit": commit, "commits": None,
                "reason": "no commit recorded in README" if not commit else "no owned paths"}
    probe = subprocess.run(["git", "-C", str(root), "cat-file", "-e", f"{commit}^{{commit}}"],
                           capture_output=True)
    if probe.returncode != 0:
        return {"since_commit": commit, "commits": None, "reason": "recorded commit not in this clone"}
    out = subprocess.run(["git", "-C", str(root), "log", "--oneline", f"{commit}..HEAD", "--"] + globs,
                         capture_output=True, text=True)
    lines = [ln for ln in out.stdout.splitlines() if ln.strip()]
    return {"since_commit": commit, "commits": len(lines), "sample": lines[:5]}


def main() -> int:
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--worktree", action="store_true")
    group.add_argument("--range", dest="rev_range")
    group.add_argument("--files", nargs="+")
    group.add_argument("--drift", action="store_true",
                       help="report drift for every area, ignoring the current diff")
    args = ap.parse_args()

    root = repo_root()
    index = load_index(root)
    kb_root = root / index.get("knowledge_root", ".claude/knowledge")
    source_root = index.get("source_root", "")
    extensions = tuple(index.get("source_extensions", DEFAULT_SOURCE_EXTENSIONS))

    if args.drift:
        report = {}
        for name, spec in index["areas"].items():
            doc_dir = kb_root / name
            verified_date, verified_commit = last_verified(doc_dir)
            report[name] = {
                "last_verified": verified_date,
                "verified_commit": verified_commit,
                "drift": drift(root, verified_commit, spec.get("primary", [])),
            }
        print(json.dumps({"repo_root": str(root), "areas": report}, indent=2))
        return 0

    if args.files:
        files = [f.replace("\\", "/") for f in args.files]  # accept Windows-style paths
    else:
        mode = "range" if args.rev_range else ("worktree" if args.worktree else "staged")
        files = changed_files(root, mode, args.rev_range)

    code = [f for f in files if f.startswith(source_root) and f.endswith(extensions)]
    docs = [f for f in files if f.startswith(index.get("knowledge_root", ".claude/knowledge"))]

    areas: dict[str, dict] = {}
    for name, spec in index["areas"].items():
        primary = [f for f in code if matches(f, spec.get("primary", []))]
        secondary = [f for f in code if matches(f, spec.get("secondary", []))]
        if not primary and not secondary:
            continue
        doc_dir = kb_root / name
        verified_date, verified_commit = last_verified(doc_dir)
        areas[name] = {
            "title": spec.get("title", ""),
            "doc_dir": str(doc_dir.relative_to(root)),
            "docs": sorted(p.name for p in doc_dir.glob("*.md")) if doc_dir.exists() else [],
            "doc_dir_exists": doc_dir.exists(),
            "last_verified": verified_date,
            "verified_commit": verified_commit,
            "drift": drift(root, verified_commit, spec.get("primary", [])),
            "action": "update" if primary else "verify-pointers",
            "primary_changes": primary,
            "secondary_changes": secondary,
        }

    mapped = {f for a in areas.values() for f in a["primary_changes"] + a["secondary_changes"]}
    print(json.dumps({
        "repo_root": str(root),
        "changed_source_files": len(code),
        "areas": areas,
        "unmapped_source_files": sorted(set(code) - mapped),
        "knowledge_files_changed": docs,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
