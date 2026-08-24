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

git -C "$lumabri_dir" apply --check "$patch_file"
git -C "$lumabri_dir" apply "$patch_file"
chmod +x "$lumabri_dir/gateway_test.sh"
echo "Applied Lumabri gateway patch"
