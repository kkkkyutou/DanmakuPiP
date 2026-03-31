#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
VERSION="$(node -e "console.log(require('$ROOT_DIR/manifest.json').version)")"
PKG_NAME="DanmakuPiP-v${VERSION}.zip"

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/$PKG_NAME"

cd "$ROOT_DIR"
zip -r "$DIST_DIR/$PKG_NAME" manifest.json src README.md docs -x "*/.DS_Store"
echo "打包完成: $DIST_DIR/$PKG_NAME"
