#!/usr/bin/env bash
# docs-site/scripts/extract-catalogues.sh <built-distribution.tar> <out-dir>
# Extracts each library's catalogue.json and package.yaml from the engine build's artifact into
# <out-dir>/lib/<namespace>/<name>/<version>/, which `generate -- --lib <out-dir>/lib` reads.
set -euo pipefail
tar_file=$1
out_dir=$2
work=$(mktemp -d)
tar -xf "$tar_file" -C "$work" --wildcards \
  'built-distribution/*/lib/*/*/*/catalogue.json' \
  'built-distribution/*/lib/*/*/*/package.yaml'
lib=$(ls -d "$work"/built-distribution/*/*/lib)
mkdir -p "$out_dir"
mv "$lib" "$out_dir/lib"
rm -rf "$work"
count=$(find "$out_dir/lib" -name catalogue.json | wc -l)
echo "Extracted $count catalogues"
[ "$count" -gt 0 ]
