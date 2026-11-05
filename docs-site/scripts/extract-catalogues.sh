#!/usr/bin/env bash
# docs-site/scripts/extract-catalogues.sh <built-distribution.tar> <out-dir>
# Extracts each library's catalogue.json and package.yaml from the engine build's artifact into
# <out-dir>/lib/<namespace>/<name>/<version>/, which `generate -- --lib <out-dir>/lib` reads.
set -euo pipefail
tar_file=$1
out_dir=$2
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# `built-distribution/<edition>/<version>/lib/<namespace>/<name>/<version>/<file>`: `*` in a GNU tar
# pattern also matches `/`, so the patterns name the depth only loosely and the check below pins it.
tar -xf "$tar_file" -C "$work" --wildcards \
  'built-distribution/*/lib/*/*/*/catalogue.json' \
  'built-distribution/*/lib/*/*/*/package.yaml'
mapfile -t libs < <(find "$work/built-distribution" -mindepth 3 -maxdepth 3 -type d -name lib)
if [ "${#libs[@]}" -ne 1 ]; then
  echo "Expected exactly one built-distribution/<edition>/<version>/lib, found ${#libs[@]}" >&2
  exit 1
fi
mkdir -p "$out_dir"
mv "${libs[0]}" "$out_dir/lib"
count=$(find "$out_dir/lib" -name catalogue.json | wc -l)
echo "Extracted $count catalogues"
[ "$count" -gt 0 ]
