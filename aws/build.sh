#!/usr/bin/env bash
# Puts the Lambda handler next to the shared server code, so the AWS function runs exactly
# what Netlify runs. Output: aws/.build/ (not committed).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/.build}"
rm -rf "$out" && mkdir -p "$out"
cp -r "$here/../netlify/functions" "$out/functions"
cp -r "$here/../netlify/lib" "$out/lib"
cp "$here/lambda/handler.mjs" "$out/handler.mjs"
echo "Built Lambda code in $out"
