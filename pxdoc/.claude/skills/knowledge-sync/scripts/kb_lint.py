#!/usr/bin/env python3
"""Audit the knowledge base for dimension coverage and doc rot.

Repo-root relative; safe to run from any clone. Everything repository-specific
(source root, symbol file extensions) comes from .claude/knowledge/kb-index.json.
Exit code 1 if any ERROR.

Usage:
  kb_lint.py                 # all areas + global checks
  kb_lint.py entity-read     # one or more areas
  kb_lint.py --json
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# dimension -> accepted heading regexes (aliases keep legacy docs partially passing)
DIMENSIONS = {
    "architecture": r"^#+ .*\b(architecture|layers?|scope)\b",
    "patterns": r"^#+ .*\bdesign patterns?\b",
    "flow": r"^#+ .*\b(flow|topology|orchestration|pipeline)\b",
    "config-forks": r"^#+ .*\b(config|configuration|flags?|forks?)\b",
    "contracts-samples": r"^#+ .*\b(contract|contracts|signature|samples?)\b",
    "reusable": r"^#+ .*\b(reusable|reuse|shared modules?)\b",
    "related-kb": r"^#+ .*\brelated kb\b",
}
LINE_REF = re.compile(r"\(:\d{2,5}(?:[-/]\d{2,5})*\)|`:\d{2,5}`|\b:\d{2,5}-\d{2,5}\b")
FENCE_JSON = re.compile(r"```json\n(.*?)```", re.S)
SIZE_LIMITS = {"README.md": 130}
SIZE_DEFAULT = 200
ABS_PATH = re.compile(r"(/Users/|/home/[a-z]|(?<![A-Za-z])[A-Z]:[\\/])")
LAST_VERIFIED = re.compile(r"Last verified", re.I)
STAMP = re.compile(r"(\d{4}-\d{2}-\d{2})\s*\|\s*commit\s*`([0-9a-f]{7,40})`\s*\|\s*branch\s*`([\w./-]+)`")
JSON_FENCE = re.compile(r"```(json|jsonc)\b")
DEFAULT_SYMBOL_EXTENSIONS = [".java"]


def repo_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, check=True)
    return Path(out.stdout.strip())


def json_cite_pattern(source_root: str) -> re.Pattern:
    """Matches cited sample paths under this repo's source root."""
    prefix = re.escape(source_root) + "/" if source_root else ""
    return re.compile(rf"({prefix}[A-Za-z0-9_./-]+\.json)")


def symbol_ref_pattern(extensions: list[str]) -> re.Pattern:
    alts = "|".join(re.escape(e.lstrip(".")) for e in extensions)
    return re.compile(rf"([A-Za-z0-9_]+\.(?:{alts}))\b")


def resolve_source_ref(root: Path, source_root: str, ref: str) -> bool:
    """True if a file with this basename exists under source_root."""
    name = Path(ref).name
    pathspec = f"{source_root}/**/{name}" if source_root else f"**/{name}"
    hits = subprocess.run(["git", "-C", str(root), "ls-files", pathspec],
                          capture_output=True, text=True)
    return bool(hits.stdout.strip())


def lint_area(root: Path, kb_root: Path, source_root: str, symbol_ref: re.Pattern,
              json_cite: re.Pattern, area: str) -> dict:
    d = kb_root / area
    findings: list[dict] = []
    readme = d / "README.md"
    if not readme.exists():
        findings.append({"level": "ERROR", "file": f"{area}/README.md",
                         "msg": "area index README.md missing"})
        return {"area": area, "findings": findings, "missing_dimensions": sorted(DIMENSIONS)}

    all_md = sorted(d.glob("*.md"))
    corpus = "\n".join(p.read_text(errors="replace") for p in all_md)

    # dimension coverage is satisfied by ANY doc in the area
    missing = []
    for dim, pattern in DIMENSIONS.items():
        rx = re.compile(pattern, re.I | re.M)
        if not rx.search(corpus):
            missing.append(dim)
            findings.append({"level": "ERROR", "file": f"{area}/", "dimension": dim,
                             "msg": f"no section covers dimension '{dim}'"})

    if not JSON_FENCE.search(corpus):
        findings.append({"level": "ERROR", "file": f"{area}/", "dimension": "contracts-samples",
                         "msg": "no ```json sample construct in the area"})

    seen_refs: set[str] = set()
    for p in all_md:
        rel = f"{area}/{p.name}"
        text = p.read_text(errors="replace")

        limit = SIZE_LIMITS.get(p.name, SIZE_DEFAULT)
        n_lines = len(text.splitlines())
        if n_lines > limit:
            findings.append({"level": "ERROR", "file": rel,
                             "msg": f"{n_lines} lines exceeds the {limit}-line limit — move a subject "
                                    f"to a sibling doc and link it from README '## Files'"})

        n_lineref = len(LINE_REF.findall(text))
        if n_lineref > 3:
            findings.append({"level": "WARN", "file": rel,
                             "msg": f"{n_lineref} line-number references (limit 3) — anchor with "
                                    f"Class#method instead; line numbers rot"})

        for cite in set(json_cite.findall(text)):
            if not (root / cite).exists():
                findings.append({"level": "ERROR", "file": rel,
                                 "msg": f"cited sample source does not exist: {cite}"})
        if not LAST_VERIFIED.search(text):
            findings.append({"level": "ERROR", "file": rel, "msg": "no 'Last verified' line"})
        elif not STAMP.search(text):
            findings.append({"level": "ERROR", "file": rel,
                             "msg": "'Last verified' lacks the commit stamp "
                                    "(expected: YYYY-MM-DD | commit `<sha>` | branch `<branch>`)"})
        for i, body in enumerate(FENCE_JSON.findall(text), 1):
            if "..." in body or "<" in body:
                continue  # deliberately elided or placeholder-bearing sample
            try:
                json.loads(body)
            except ValueError as ex:
                findings.append({"level": "WARN", "file": rel,
                                 "msg": f"json sample #{i} does not parse: {ex}"})
        for m in ABS_PATH.finditer(text):
            findings.append({"level": "ERROR", "file": rel,
                             "msg": f"absolute machine path leaked: {m.group(1)!r}"})
        for m in symbol_ref.finditer(text):
            ref = m.group(1)
            if ref in seen_refs:
                continue
            seen_refs.add(ref)
            if not resolve_source_ref(root, source_root, ref):
                findings.append({"level": "WARN", "file": rel,
                                 "msg": f"referenced source not found in repo: {ref}"})
    return {"area": area, "findings": findings, "missing_dimensions": missing,
            "docs": [p.name for p in all_md]}


def lint_global(root: Path, kb_root: Path, areas: list[str]) -> list[dict]:
    """Checks on the router and the shared docs, not on any single area."""
    findings: list[dict] = []
    index = kb_root / "INDEX.md"
    if not index.exists():
        findings.append({"level": "ERROR", "file": "INDEX.md", "msg": "router INDEX.md missing"})
    else:
        text = index.read_text(errors="replace")
        for area in areas:
            if f"({area}/" not in text and f"]({area})" not in text:
                findings.append({"level": "ERROR", "file": "INDEX.md",
                                 "msg": f"area '{area}' is not routed from INDEX.md"})
    if not (kb_root / "PATTERNS.md").exists():
        findings.append({"level": "WARN", "file": "PATTERNS.md", "msg": "platform pattern doc missing"})
    for shared in ("INDEX.md", "PATTERNS.md"):
        f = kb_root / shared
        if f.exists() and not STAMP.search(f.read_text(errors="replace")):
            findings.append({"level": "ERROR", "file": shared, "msg": "no commit stamp"})
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("areas", nargs="*")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = repo_root()
    registry = root / ".claude" / "knowledge" / "kb-index.json"
    if not registry.exists():
        sys.exit(f"registry not found: {registry.relative_to(root)} — "
                 f"run the knowledge-sync skill in mode 'bootstrap' to create it")
    index = json.loads(registry.read_text())
    kb_root = root / index.get("knowledge_root", ".claude/knowledge")
    source_root = index.get("source_root", "")
    symbol_ref = symbol_ref_pattern(index.get("symbol_extensions", DEFAULT_SYMBOL_EXTENSIONS))
    json_cite = json_cite_pattern(source_root)
    areas = args.areas or sorted(index["areas"])

    results = [lint_area(root, kb_root, source_root, symbol_ref, json_cite, a) for a in areas]
    global_findings = lint_global(root, kb_root, sorted(index["areas"])) if not args.areas else []
    if global_findings:
        results.insert(0, {"area": "(global)", "findings": global_findings, "missing_dimensions": []})
    errors = sum(1 for r in results for f in r["findings"] if f["level"] == "ERROR")
    warns = sum(1 for r in results for f in r["findings"] if f["level"] == "WARN")

    if args.json:
        print(json.dumps({"errors": errors, "warnings": warns, "results": results}, indent=2))
    else:
        for r in results:
            print(f"\n== {r['area']} ==")
            if not r["findings"]:
                print("  OK")
            for f in r["findings"]:
                print(f"  {f['level']}: {f['file']}: {f['msg']}")
        print(f"\n{errors} error(s), {warns} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
