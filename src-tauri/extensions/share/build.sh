#!/bin/bash
# Build the "Send to Untune" macOS Share Extension (.appex)
# Usage: ./build.sh [path-to-Untune.app]
#
# If no argument is given, builds the .appex in the current directory.
# If a path to Untune.app is provided, also copies the .appex into the app bundle
# and re-signs everything in the correct order.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APPEX="$SCRIPT_DIR/Send to Untune.appex"

# Clean previous build
rm -rf "$APPEX"

# Create bundle structure
mkdir -p "$APPEX/Contents/MacOS"
cp "$SCRIPT_DIR/Info.plist" "$APPEX/Contents/Info.plist"

# Compile Objective-C source with _NSExtensionMain entry point
clang -target arm64-apple-macos13.0 \
  -fobjc-arc \
  -fmodules \
  -fapplication-extension \
  -framework Cocoa \
  -e _NSExtensionMain \
  -o "$APPEX/Contents/MacOS/Send to Untune" \
  "$SCRIPT_DIR/ShareViewController.m"

echo "Built: $APPEX"

# If an app bundle path was provided, install and re-sign
if [ -n "${1:-}" ]; then
  APP_BUNDLE="$1"
  PLUGINS_DIR="$APP_BUNDLE/Contents/PlugIns"
  mkdir -p "$PLUGINS_DIR"
  rm -rf "$PLUGINS_DIR/Send to Untune.appex"
  cp -R "$APPEX" "$PLUGINS_DIR/"
  echo "Installed into: $PLUGINS_DIR/Send to Untune.appex"

  # Sign inside-out: extension first, then the outer app
  codesign --force --sign - \
    --entitlements "$SCRIPT_DIR/ShareExtension.entitlements" \
    "$PLUGINS_DIR/Send to Untune.appex"

  codesign --force --sign - "$APP_BUNDLE"
  echo "Re-signed: $APP_BUNDLE"
else
  # Just sign the standalone appex
  codesign --force --sign - \
    --entitlements "$SCRIPT_DIR/ShareExtension.entitlements" \
    "$APPEX"
fi
