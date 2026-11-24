#!/usr/bin/env bash
set -euo pipefail

WORKSPACE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    *)
      echo "Usage: bash ./uninstall.sh [--workspace /path/to/project]" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).name)" "$REPO_ROOT/plugin/plugin.json")"

if [[ -n "$WORKSPACE" ]]; then
  PLUGIN_DEST="$(cd "$WORKSPACE" && pwd)/.agents/plugins/$SLUG"
else
  PLUGIN_DEST="$HOME/.gemini/config/plugins/$SLUG"
fi

if [[ -d "$PLUGIN_DEST" ]]; then
  rm -rf "$PLUGIN_DEST"
  echo "Removed Antigravity Swarm plugin '$SLUG' from $PLUGIN_DEST"
else
  echo "Plugin '$SLUG' not found at $PLUGIN_DEST (nothing to remove)."
fi
