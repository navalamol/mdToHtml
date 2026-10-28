#!/usr/bin/env bash
# md2html — Markdown to HTML converter launcher
# Works on: Git Bash (Windows), WSL, Linux, macOS

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD="\033[1m"; RESET="\033[0m"
  GREEN="\033[32m"; RED="\033[31m"; CYAN="\033[36m"; DIM="\033[2m"; YELLOW="\033[33m"
else
  BOLD=""; RESET=""; GREEN=""; RED=""; CYAN=""; DIM=""; YELLOW=""
fi

# ── Move to script directory (so node_modules is always found) ────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}  ============================================${RESET}"
echo -e "${BOLD}${CYAN}   md2html  |  Markdown to HTML Converter${RESET}"
echo -e "${BOLD}${CYAN}   v2.1.0${RESET}"
echo -e "${BOLD}${CYAN}  ============================================${RESET}"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}  [ERROR] Node.js is not installed or not in PATH.${RESET}"
  echo ""
  echo "  Please install Node.js from: https://nodejs.org"
  echo ""
  exit 1
fi

NODE_VER=$(node --version)
echo -e "${DIM}  Node.js ${NODE_VER}${RESET}"
echo ""

# ── Install dependencies on first run ─────────────────────────────────────────
if [ ! -d "node_modules/marked" ]; then
  echo -e "${YELLOW}  Installing required packages (first run only)...${RESET}"
  echo ""
  if ! npm install --silent; then
    echo ""
    echo -e "${RED}  [ERROR] npm install failed.${RESET}"
    echo "  Make sure you have internet access and try again."
    echo ""
    exit 1
  fi
  echo -e "${GREEN}  Packages installed.${RESET}"
  echo ""
fi

# ── Launch interactive wizard ─────────────────────────────────────────────────
node md2html.js --interactive
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -ne 0 ]; then
  echo -e "${RED}  Conversion finished with errors. See above for details.${RESET}"
else
  echo -e "${GREEN}${BOLD}  All done!${RESET}"
fi
echo ""
