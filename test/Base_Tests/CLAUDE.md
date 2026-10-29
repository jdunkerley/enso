# test/Base_Tests

Enso test project for `Standard.Base`. `src/Main.enso` registers every spec;
specs are grouped by area (`Data/`, `Network/`, `Runtime/`, `Semantic/`,
`System/`). HTTP specs need `http-test-helper` (see `README.md`).

## Where things are tested

- `src/Data/Numbers_Spec.enso` — `Integer`, `Float` and `Number` arithmetic,
  including `^` (the `Integer ^` builtin is `PowNode` in `engine/runtime`).

## Running by hand

Follow the root `CLAUDE.md` ("Running an Enso test project by hand"): run from
`test/`, not the repo root, and pass `-enableassertions`. The second argument is
a filter matched against group and spec names; a filter that matches nothing
still exits 0, so check the number of tests reported.

```bash
cd test && JAVA_TOOL_OPTIONS="-enableassertions" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso \
  --no-ir-caches --run "$PWD/Base_Tests" "pow"
```
