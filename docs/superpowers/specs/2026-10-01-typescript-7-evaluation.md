# TypeScript 7 Evaluation

**Date:** 2026-10-01 **Ticket:** #149 (part of the dependency programme #20)
**Follow-ups:** #165 (TypeScript 6.0.3), #166 (TypeScript 7 adoption gates)

## Recommendation: wait for TypeScript 7, and move to 6.0 now

- **Do not switch the catalog to 7.0.** In this repo it breaks `pnpm install`,
  `vue-tsc`, typed linting, `vite build`, one Vitest file and our AST generator.
  It also silently disables `prettier-plugin-organize-imports`. Six tools, plus
  our own codegen, need the JavaScript API that 7.0 does not ship.
- **Do not add `tsgo` as an extra CI check either.** It saves no CI time,
  because the GUI's `vue-tsc` runs still bound `ci:typecheck`. It cannot see
  `.vue` files, so it covers only the non-Vue configs. Keeping it green needs
  workarounds (see below). And the only clean side-by-side package is a
  discontinued pre-release. TypeScript 6.0 turns every option 7 removes into an
  error, so it guards against drift more cheaply than a `tsgo` check would.
- **Do now: TypeScript 5.9.3 → 6.0.3 (#165).** It keeps the JS API, both
  `vue-tsc` and `@typescript-eslint` accept it, and it holds every 7-specific
  config fix. In the spike it cost 30 + 5 new errors in CI-checked configs.
- **Revisit 7 when the gates in #166 are green.** The main gates are TypeScript
  7.1's stable API, Vue Language Tools v4's content mapper, and typed linting
  support from `typescript-eslint`.

The native compiler itself was not the problem. It was 4.3–8× faster on every
config it could check, and on the plain-TypeScript configs it reported the same
errors over the same files as 5.9, with one exception (`app/common`, below).

## Research (as of 2026-10-01)

| Topic                   | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript 7            | 7.0.2 GA on 2026-07-08 (RC 7.0.1 on 2026-06-18). The npm package is still `typescript` and the binary still `tsc`. Nightlies are `typescript@next` (`7.1.0-dev.20260930.4`). 6.0.3 (2026-04-16) is the last 6.x. The 7.0 package exports only `version` and `unstable/*` — **no programmatic API until 7.1**. 7.0 removes `baseUrl`, `moduleResolution: node10/classic`, `target: es5`, AMD/UMD/System and others, and changes defaults (`strict`, `types: []`, …). [1]                          |
| Side-by-side            | Microsoft's recipe aliases 7 as `"@typescript/native": "npm:typescript@^7.0.2"` and keeps the 6 API as `"typescript": "npm:@typescript/typescript6@^6.0.2"` (binary `tsc6`). `@typescript/native-preview` (binary `tsgo`) stopped at `7.0.0-dev.20260707.2`, the day before GA. [1]                                                                                                                                                                                                              |
| `vue-tsc` / Volar       | No 7 support. `vue-tsc` 3.3.11 patches `typescript/lib/tsc` at load time, which a native binary cannot allow (vuejs/language-tools#5381, closed; discussion #6121, 2026-07-10). Vue Language Tools v4 replaces `vue-tsc` with a TypeScript **content mapper** (`contentMappers` in tsconfig + `tsc --runExternalCode`), which is only in 7.1 nightlies (vuejs/language-tools#6170, draft; `@vue/content-mapper` not yet on npm). Community stopgaps: `vue-tsgo` 0.3.0, `golar` 0.1.10. [2][3][4] |
| `@typescript-eslint`    | 8.71.0 peers `typescript >=4.8.4 <6.1.0`. On 7 it throws `typescript-eslint does not support TS 7.0`. typescript-eslint#12518 (2026-07-08) was closed "not planned", and #10940 tracks 7 support against the 7.1 API. [5][6]                                                                                                                                                                                                                                                                     |
| Editors                 | VS Code: the "TypeScript 7" extension / `js/ts.experimental.useTsgo` runs the native language service, but warns about any extension that contributes a tsserver plugin (Vue - Official does), and `.vue` files need a content mapper (microsoft/TypeScript#64356, 2026-09-20). WebStorm 2026.2 supports 7 for React/Angular. Its Vue support on 7 is "being worked on" (JetBrains, 2026-09). [7][8]                                                                                             |
| Vite / esbuild / Vitest | esbuild and Vite's TS transform do not use `typescript`. But `@vitejs/plugin-vue` → `@vue/compiler-sfc` loads it to resolve imported types in `defineProps<T>()`, and on 7 that fails (measured below). Vitest only cares through the same plugin.                                                                                                                                                                                                                                               |

## How it was measured

- **Code:** `develop` at `20578fae2c` (TypeScript 5.9.3, `vue-tsc` 3.3.11).
- **Host:** WSL2 (Ubuntu), 32 threads, Node 24.21.0. Private clones on the Linux
  filesystem (`~/enso-i149*`), not `/mnt/c`.
- **Compilers:** 5.9.3 and `vue-tsc` from the lockfile. `typescript@7.0.2`
  installed outside the repo and run against it. `@typescript/native-preview`
  `7.0.0-dev.20260707.2` installed side by side (it gave identical error and
  file counts to 7.0.2 on every config). `typescript@6.0.3` came from a clone
  with the catalog switched.
- **Method:** every config run with
  `-p <config> --noEmit --extendedDiagnostics`. Before each run, every
  `*.tsbuildinfo` and `.eslintcache` was deleted. Three runs per compiler per
  config. Errors were counted as `error TS` lines, and files from the `Files:`
  line. The GUI's `.vue` configs used `vue-tsc` on 5.9; `tsgo` was also pointed
  at them to show what it does there.
- **Readiness fixes applied to both sides** (all neutral on 5.9 and now in
  #165). Without them, 7 stops at the config error and reports nothing else.
  That looked like `lang-markdown` going from 59 errors to 1, an error that
  vanished because nothing was checked:
  - `app/gui/tsconfig.node.json`: drop `baseUrl`.
  - `app/{lang,lezer}-markdown/tsconfig.json`: `moduleResolution` `node` →
    `bundler`.
  - `app/ydoc-shared/parser-codegen/tsconfig.json`: `NodeNext`.
  - `parser-codegen/codegen.ts`: emit `export namespace` rather than
    `export module`. That is TS1540 on 6 and 7, and regenerating changes 4 lines
    of `ast.ts`.

## Error counts and wall-clock: 5.9 (or `vue-tsc`) vs 7.0.2

Mean of three cold runs, in seconds. Errors and files are shown as 5.9 / 7.

| Config                                                  | 5.9 s |  7 s | Speed-up |     Errors 5.9 / 7 |   Files 5.9 / 7 |
| ------------------------------------------------------- | ----: | ---: | -------: | -----------------: | --------------: |
| `common`                                                |  6.29 | 1.31 |     4.8× |          0 / **2** |       401 / 401 |
| `electron-client`                                       |  3.19 | 0.71 |     4.5× |              0 / 0 |       737 / 737 |
| `project-manager-shim`                                  |  2.02 | 0.34 |     6.0× |              0 / 0 |       473 / 473 |
| `table-expression`                                      |  0.86 | 0.15 |     5.8× |              0 / 0 |       279 / 279 |
| `ydoc-channel` build / test                             |  1.75 | 0.31 |     5.6× |              0 / 0 |  310+316 / same |
| `ydoc-inspect`                                          |  1.24 | 0.26 |     4.8× |              0 / 0 |       238 / 238 |
| `ydoc-server` build / test                              |  4.38 | 0.79 |     5.5× |              0 / 0 |  531+537 / same |
| `ydoc-shared` build / test                              |  5.30 | 1.08 |     4.9× |              0 / 0 |  425+588 / same |
| `ydoc-shared/parser-codegen`                            |  0.58 | 0.09 |     6.5× |              0 / 0 |       188 / 188 |
| `ydoc-server-polyglot` (not in CI)                      |  0.46 | 0.09 |     4.9× | 28 / 28 (same set) |       135 / 135 |
| `lang-markdown` (not in CI)                             |  0.45 | 0.07 |     6.4× | 59 / 59 (same set) |         37 / 37 |
| `lezer-markdown`                                        |  0.53 | 0.07 |     8.0× |              0 / 0 |         30 / 30 |
| `gui` `tsconfig.scripts.json`                           |  1.47 | 0.34 |     4.3× |              0 / 0 |       160 / 160 |
| `gui` `tsconfig.node.json` (`vue-tsc`)                  |  5.48 | 0.93 |     5.9× |          0 / **5** |       827 / 822 |
| `gui` `tsconfig.app.json` (`vue-tsc`)                   | 28.92 | 4.66 |   (6.2×) |        0 / **133** | 3910 / **3650** |
| `gui` `tsconfig.app.vitest.json` (`vue-tsc`, not in CI) | 14.02 | 2.59 |   (5.4×) |          503 / 512 | 3483 / **3401** |

`pnpm run ci:typecheck` (parallel, as CI runs it) took 27.7 / 28.1 / 28.2 s on
5.9. It is bounded by `app/gui`'s two `vue-tsc` runs. Across all the non-`.vue`
configs, 5.9 took 34.0 s of CPU-serial time and 7 took 6.6 s.

What the differences are:

- **`gui` app configs: 7 cannot check them.** It skips every `.vue` file (260
  fewer files), and the 133 errors are mostly the fallout: 68× TS2307 "Cannot
  find module './X.vue'". It is no substitute for `vue-tsc`, so the speed-up in
  brackets compares different work.
- **`gui` node config: 5 errors are TypeScript 6's DOM lib, not 7.** `tsc6`
  reports the same 5, in `integration-test/mock/lsHandler.ts`
  (`FileSystemDirectoryHandleAsyncIterator`). The 5 missing files are
  `@types/react` and `csstype`. 5.9 adds them through an implicit
  `react/jsx-runtime` import into every `.ts` module under `jsx: react-jsx`; 7
  adds them only for files with JSX. The source-file set is identical.
- **`common`: 2 errors only 7 reports.**
  `TS2300 Duplicate identifier 'containSubset'` between `@types/chai` 5.2.2 and
  Vitest 3.2.4's own chai augmentation, which surfaces because `app/common` sets
  `skipLibCheck: false`. 5.9 and 6.0 report nothing. 7.0.2 and the 7.1 nightly
  report it on every run, with any `--checkers` count (cf.
  microsoft/typescript-go#1192). Vitest 4 dropped that augmentation.
- **Everything else: identical** error sets and file counts.

### TypeScript 6.0.3 (catalog switch, with the readiness fixes)

All plain-TS configs are unchanged, with the same file counts.
`gui/tsconfig.app.json` goes from 0 to **30** errors: 11× TS2320 in Dashboard
React components, 11 in `WidgetTableEditor/tableInputArgument.ts`, 4 in
`WidgetText.vue`, and 4 elsewhere. `gui/tsconfig.node.json` gets the 5 DOM-lib
errors above. `tsconfig.app.vitest.json` goes from 503 to 518. One cold run of
`tsconfig.app.json` took 18.4 s against 25.7 s on 5.9. Without the readiness
fixes, 6.0 also fails on TS5101 (`baseUrl`), TS5107 (`node10`) and TS1540
(`module`). This is the scope of #165.

## What breaks

### (a) Catalog switched to `typescript: 7.0.2`

Results are from a full `pnpm install`, then running each tool's binary
directly. `pnpm run` re-runs the failed `prepare` first, which would mask
everything else. The same matrix on 5.9 (with the readiness fixes) passed
throughout.

| Step                                                     | On 7.0.2                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm install`                                           | **Fails.** `app/lezer-markdown` `prepare` → `@marijn/buildtool` → `rollup-plugin-dts`: `ts.sys` is undefined.      |
| `tsc` builds (`common`, `ydoc-*`, shim, …)               | Pass, except `app/common` (the TS2300 above).                                                                      |
| `generate-ast.mjs` (parser-codegen)                      | **Fails.** It imports `ts.factory` / the printer, which no longer exist in the API.                                |
| `ydoc-server-polyglot` / `ydoc-inspect` bundle (esbuild) | Pass.                                                                                                              |
| `vue-tsc` (any gui config)                               | **Fails.** `ERR_PACKAGE_PATH_NOT_EXPORTED: ./lib/tsc`.                                                             |
| `eslint` (gui, ydoc-server)                              | **Fails.** `typescript-eslint does not support TS 7.0`.                                                            |
| `prettier --check`                                       | Passes, **but `organize-imports` is silently a no-op.** Unsorted imports were left unsorted, where 5.9 sorts them. |
| Vitest (`ydoc-shared`)                                   | Passes.                                                                                                            |
| Vitest (`gui`)                                           | **1 of 132 files fails** (`TableHeader.test.ts`): `@vue/compiler-sfc` cannot resolve imported `defineProps` types. |
| `vite build` (gui)                                       | **Fails**, for the same compiler-sfc reason (`GrowingSpinner.vue`).                                                |

`pnpm install` did not warn about `@typescript-eslint`'s `<6.1.0` range. The
existing `typescript` override applied to 7 as intended: `vue-tsc` and
`@marijn/buildtool` were moved onto 7.0.2.

### (b) `tsgo` side by side, 5.9 kept for `vue-tsc`/eslint

- **The `npm:typescript@7.0.2` alias is a trap.** Installed as
  `"@typescript/native": "npm:typescript@7.0.2"`, it escaped the `typescript`
  override (pnpm matched the alias name), but its `tsc` bin replaced the root
  `node_modules/.bin/tsc`: `tsc --version` printed `7.0.2`. Packages without
  their own `typescript` dependency (`app/common`, for one) resolve `tsc` from
  the root, so `pnpm run compile` would quietly build them with 7.
- **`@typescript/native-preview@7.0.0-dev.20260707.2`** (binary `tsgo`) installs
  cleanly next to 5.9 and matched 7.0.2's results exactly. But it is a pre-GA
  build of a package that is no longer published, so a pin to it could never
  take a 7.0.x fix.
- **A green `tsgo` step would need workarounds.** `app/common` would need
  `--skipLibCheck` (or Vitest 4). `gui/tsconfig.node.json` would need the
  DOM-lib fix in `lsHandler.ts` first, and the `gui` app configs would have to
  be left out entirely.
- **It saves no CI time.** It cannot check the GUI app, the bulk of the code.
  The ~28 s `ci:typecheck` is set by `vue-tsc` on the GUI, which still has to
  run, so `tsgo` would add a ~7 s step rather than replace anything.

## Reproducing

The scripts live in the spike's scratch space. They are short enough to restate.
For each `(package dir, tsconfig)` pair:

```bash
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
/usr/bin/time -f %e <tsc|vue-tsc|tsgo> -p <config> --noEmit --extendedDiagnostics \
  | tee log; grep -cE 'error TS[0-9]+' log; grep '^Files:' log
```

To compare error _sets_ rather than counts, take
`grep -oE '^[^ ]+\([0-9]+,[0-9]+\): error TS[0-9]+' log | sort` from both sides
and `diff` them. Use `--listFiles` (or `--explainFiles`) when the file counts
differ. For the tool matrix, call `node_modules/.bin/<tool>` directly so
`pnpm`'s pre-run dependency check cannot mask the result.

## Sources

1. Announcing TypeScript 7.0, Microsoft, 2026-07-08 —
   https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ ; npm
   `typescript` dist-tags and `exports`, read 2026-10-01.
2. vuejs/language-tools#5381 (TypeScript 7 support, closed) and discussion #6121
   (2026-07-10) — https://github.com/vuejs/language-tools/issues/5381 ,
   https://github.com/vuejs/language-tools/discussions/6121
3. vuejs/language-tools#6170, "content mapper (v4 alpha)", draft —
   https://github.com/vuejs/language-tools/pull/6170
4. "vue-tsc and Volar.js Enter the tsgo Era…", 2026-06-21 —
   https://www.elecmonkey.com/en/blog/vue-tsc-runtime-patch-hack ; npm
   `vue-tsgo` 0.3.0, `golar` 0.1.10.
5. typescript-eslint#12518, "TypeScript 7.0.2 Support", closed not planned,
   2026-07-08 —
   https://github.com/typescript-eslint/typescript-eslint/issues/12518
6. typescript-eslint#10940, "Use TS 7 for type information", open —
   https://github.com/typescript-eslint/typescript-eslint/issues/10940
7. microsoft/TypeScript#64356 (content mappers and the tsserver-plugin warning,
   2026-09-20) — https://github.com/microsoft/TypeScript/issues/64356
8. TypeScript 7 in WebStorm, JetBrains, 2026-09 —
   https://blog.jetbrains.com/webstorm/2026/09/typescript-7-in-webstorm-faster-coding-assistance-for-angular-and-react-no-migration-required/
