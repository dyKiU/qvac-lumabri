#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <lumabri-checkout> [adapter-patch]" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
lumabri_dir=$(CDPATH= cd -- "$1" && pwd)
patch_rel=${2:-native/lumabri-gateway.patch}

case "$patch_rel" in
  native/*.patch) ;;
  *)
    echo "invalid adapter patch path: $patch_rel" >&2
    exit 2
    ;;
esac
patch_file="$repo_dir/$patch_rel"

if [ ! -f "$lumabri_dir/lumabri.c" ]; then
  echo "not a Lumabri checkout: $1" >&2
  exit 2
fi

if [ ! -f "$patch_file" ]; then
  echo "adapter patch not found: $patch_rel" >&2
  exit 2
fi

if grep -q 'cmd_gateway' "$lumabri_dir/lumabri.c"; then
  echo "Lumabri already provides the gateway; patch not needed"
  exit 0
fi

lumabri_head=$(git -C "$lumabri_dir" rev-parse HEAD 2>/dev/null || echo unknown)
apply_err=$(mktemp)
if ! git -C "$lumabri_dir" apply --check "$patch_file" 2>"$apply_err"; then
  echo "Lumabri gateway patch does not apply at ${lumabri_head}:" >&2
  sed 's/^/  /' "$apply_err" >&2
  rm -f "$apply_err"
  echo >&2
  echo "Likely Lumabri main moved ahead of the patch base. Rebase the overlay:" >&2
  echo "  docs/lumabri-gateway-patch.md" >&2
  echo "Then refresh dev-next lumabri.sourceRef in contracts.json and run:" >&2
  echo "  npm run check:native-upstreams && npm run docs:contracts" >&2
  exit 1
fi
rm -f "$apply_err"
git -C "$lumabri_dir" apply "$patch_file"
chmod +x "$lumabri_dir/gateway_test.sh"
echo "Applied Lumabri gateway patch"
