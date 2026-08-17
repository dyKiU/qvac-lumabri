#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <lumabri-checkout>" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
lumabri_dir=$(CDPATH= cd -- "$1" && pwd)

if [ ! -f "$lumabri_dir/lumabri.c" ]; then
  echo "not a Lumabri checkout: $1" >&2
  exit 2
fi

if grep -q 'cmd_gateway' "$lumabri_dir/lumabri.c"; then
  echo "Lumabri already provides the gateway; patch not needed"
  exit 0
fi

git -C "$lumabri_dir" apply --check "$repo_dir/native/lumabri-gateway.patch"
git -C "$lumabri_dir" apply "$repo_dir/native/lumabri-gateway.patch"
chmod +x "$lumabri_dir/gateway_test.sh"
echo "Applied Lumabri gateway patch"
