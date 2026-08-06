#!/usr/bin/env bash
# Build the Vite web app and package it as Electron desktop installers
# (Linux .deb and Windows .exe) using electron-builder.
#
# Usage:
#   ./scripts/build-release.sh          # build deb + exe
#   ./scripts/build-release.sh deb      # build deb only
#   ./scripts/build-release.sh exe      # build exe only
#
# Requirements to build the Windows .exe from Linux:
#   sudo dpkg --add-architecture i386
#   sudo apt update
#   sudo apt install -y wine wine32:i386
#
# Output goes to ./release/

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-all}"

echo "==> Installing dependencies"
npm install

echo "==> Building web app (vite build -> dist/)"
npm run build

case "$TARGET" in
  deb)
    echo "==> Packaging Linux .deb"
    npx electron-builder --linux deb
    ;;
  exe)
    echo "==> Packaging Windows .exe (nsis)"
    npx electron-builder --win nsis
    ;;
  all)
    echo "==> Packaging Linux .deb and Windows .exe"
    npx electron-builder --linux deb --win nsis
    ;;
  *)
    echo "Unknown target: $TARGET (expected: deb, exe, or all)" >&2
    exit 1
    ;;
esac

echo "==> Done. Artifacts in ./release:"
ls -la release/*.deb release/*.exe 2>/dev/null || true
