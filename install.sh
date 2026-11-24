#!/usr/bin/env bash
set -euo pipefail

# Install this Antigravity Swarm plugin globally (~/.gemini/config/plugins/<slug>)
# or scoped to a single workspace (--workspace <path> -> <workspace>/.agents/plugins/<slug>).

WORKSPACE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: bash ./install.sh [--workspace /path/to/project]" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugin"

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js (>= 20) is required." >&2; exit 1; }

SLUG="$(node -e "const fs=require('fs'); console.log(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).name)" "$PLUGIN_SRC/plugin.json")"

echo "==> [1/3] Validating Antigravity plugin spec for '$SLUG'..."
node "$REPO_ROOT/scripts/validate-plugin.mjs" --plugin "$PLUGIN_SRC"

if [[ -n "$WORKSPACE" ]]; then
  DEST_BASE="$(cd "$WORKSPACE" && pwd)/.agents/plugins"
  SCOPE_LABEL="workspace ($WORKSPACE)"
else
  DEST_BASE="$HOME/.gemini/config/plugins"
  SCOPE_LABEL="global (~/.gemini/config/plugins)"
fi

PLUGIN_DEST="$DEST_BASE/$SLUG"
echo "==> [2/3] Deploying plugin to $PLUGIN_DEST ($SCOPE_LABEL)..."
mkdir -p "$DEST_BASE"
rm -rf "$PLUGIN_DEST"
cp -R "$PLUGIN_SRC" "$PLUGIN_DEST"
chmod +x "$PLUGIN_DEST"/hooks/*.mjs 2>/dev/null || true

echo "==> [3/3] Running automated hook & coexistence test suite..."
(cd "$REPO_ROOT" && node --test tests/*.test.mjs)

echo ""
echo "SUCCESS! Installed Antigravity Swarm plugin '$SLUG' -> $PLUGIN_DEST"
echo "Tip: Antigravity loads plugins automatically on your next turn. Launch with: /swarm 启动 $SLUG ..."
