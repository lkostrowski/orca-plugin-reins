#!/bin/sh
# Renames this checkout to "Reins (dev)" (id `reins-dev`) and loads it into Orca as a dev plugin,
# so it runs beside the installed Reins. The rename stays local: git is told to ignore
# orca-plugin.json changes (--skip-worktree). Edits to src/ hot-reload.
#   scripts/dev-install.sh [--approve <fingerprint>]   load (Orca prints the fingerprint)
#   scripts/dev-install.sh --undo                      unload, restore manifest, let git see it again
set -eu
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--undo" ]; then
  orca plugin dev unload "$PWD" || true
  git update-index --no-skip-worktree orca-plugin.json
  git checkout orca-plugin.json
  exit 0
fi
node -e '
const fs = require("fs")
const m = JSON.parse(fs.readFileSync("orca-plugin.json", "utf8"))
if (m.id !== "reins-dev") {
  m.id = "reins-dev"
  m.name += " (dev)"
  for (const p of m.contributes.panels) { p.id += "-dev"; p.title += " (dev)" }
  fs.writeFileSync("orca-plugin.json", JSON.stringify(m, null, 2) + "\n")
}
'
git update-index --skip-worktree orca-plugin.json
exec orca plugin dev load "$PWD" "$@"
