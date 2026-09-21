# Enso

Enso Analytics is a visual/textual programming environment for data preparation
and analysis. This repository contains **two top-level products that share this
monorepo**:

- **Enso Engine** — the Enso language implementation: parser, compiler,
  interpreter (Truffle/GraalVM), language server, and the Enso standard library.
  Written in Scala, Java, and Rust.
- **Enso IDE** — a desktop application (Electron) with a visual graph editor and
  a dashboard for project/cloud management. Written in TypeScript; Vue is the
  main UI framework. The Dashboard feature is still in React as a historical
  artifact and is being progressively migrated to Vue.

The two products are glued together by several generated/shared artifacts: the
Rust parser is compiled to **both** WASM (for the GUI) and a JNI `cdylib` (for
the JVM), and its AST types are code-generated into Java so the engine can
deserialize parser output.

## Top-level layout

- `app/` — Desktop app (Electron), GUI (Vue; the Dashboard feature is still
  React while it's being ported), ydoc server, markdown/table CodeMirror
  grammars, Rust→WASM bindings. pnpm monorepo.
- `engine/` — The Enso language engine. Mixed Scala/Java under `sbt`. Runtime
  uses GraalVM Truffle.
- `lib/rust/` — Rust workspace libraries (parser, prelude, reflect/metamodel,
  zst). Some crates ship to crates.io.
- `lib/java/` — JPMS-friendly wrappers around third-party Java libraries, plus
  interpreter DSL, persistance, and ydoc server.
- `lib/scala/` — Scala support libraries (pkg, project-manager, editions,
  logging, etc.).
- `build_tools/` — The `./run` CLI (Rust). The end-to-end build orchestrator for
  the IDE/engine bundle.
- `distribution/` — Packaged output layout, templates, and the **Enso standard
  library sources** under `distribution/lib/Standard/`.
- `std-bits/` — Java helpers that the Enso standard library calls via host
  interop.
- `test/` — Enso-language test projects (one per standard library module).
- `tools/` — Auxiliary dev tools (IGV plugin, http test helper, CI scripts,
  benchmark analysis).
- `docs/` — Extensive developer documentation (RFCs, style guides, runtime
  internals, LSP protocol). Start at `docs/README.md`.
- `project/` — SBT plugins and build helpers for the engine.
- `internal/`, `patches/` — Build plumbing.

## Build systems

Three, **which one to use depends on what you're building**:

- **Cargo** — for everything under the `[workspace]` in root `Cargo.toml`
  (build_tools + lib/rust + app/rust-ffi).
- **pnpm + Vite/esbuild** — for the TypeScript monorepo (packages listed in
  `pnpm-workspace.yaml`).
- **SBT** — for the Scala/Java engine (`build.sbt`). See
  `docs/sbt-cheatsheet.md`.

Bazel was previously being rolled out as a fourth ("target") build system and
has been removed from the IDE side; some dormant `BazelSupport` hooks remain in
the engine's `build.sbt`.

The `./run` (or `run.cmd` / `run.ps1`) script at the repo root dispatches to the
Enso build CLI (in `build_tools/cli/`) — the end-to-end orchestrator. It runs
the CLI via `cargo run -p enso-build-cli`.

## Languages and toolchains

- Rust: stable channel pinned in `rust-toolchain.toml` (currently 1.90.0) with
  `wasm32-unknown-unknown` target. Workspace `Cargo.toml` pins dependency
  versions — members reference them with `{ workspace = true }`. `rustfmt.toml`
  and `clippy.toml` are repo-wide; follow them.
- Scala/Java: GraalVM-based. See `docs/infrastructure/` for `sbt`, native-image,
  dual-JVM, and GraalVM upgrade guides.
- TypeScript: TS `catalog:` version in `pnpm-workspace.yaml`. Use
  `corepack pnpm` (not bare `pnpm`/`npm`).

### Changing a dependency version

The lockfile, not the manifest, decides what you get. Four traps, each of which
has silently produced a wrong result here:

- **Editing a caret range downward does nothing.** `pnpm install` honours the
  existing lockfile, so `"^8.52.0"` keeps resolving 8.70.0. To hold a version
  down, pin it exactly, add a `pnpm.overrides` entry, or simply leave it out of
  the `pnpm update` argument list.
- **The `catalog:` in `pnpm-workspace.yaml` does not move with `pnpm update`.**
  Bumping direct dependencies while the catalog stays put leaves two copies of
  the same package, and TypeScript treats them as unrelated types
  (`EditorView is not assignable to EditorView`). Move both halves together.
- **Transitive pins survive `pnpm update`, including `--depth Infinity`.**
  `pnpm.overrides` is what actually dedupes them — that is why `@lezer/lr` has
  an entry there.
- **A broken install is not repaired by re-running `pnpm install`.** If an
  experiment leaves the tree inconsistent (pnpm 11+ silently ignores the whole
  `pnpm` field in `package.json`, dropping `overrides` and
  `patchedDependencies`), the damage persists and produces failures that look
  entirely genuine. `rm -rf node_modules` before trusting any measurement.

## Conventions worth knowing up front

- **Always add a `CHANGELOG.md` entry.** Every PR gets one — the `Changelog` CI
  job fails otherwise, and reaching for the `CI: No changelog needed` label
  should be the rare exception, not the reflex. Add it to the `# Next Release`
  section under the right heading (`#### Enso IDE`,
  `#### Enso Language & Runtime`, `#### Enso Standard Library`), in the existing
  `- [Description][NNN]` form with a matching link definition, where `NNN` is
  the PR number. Write it for someone reading release notes, not for a reviewer
  reading the diff.
- Licensing is split: Engine = Apache-2.0, IDE = AGPL-3.0 (see
  `app/gui/LICENSE`).
- The Rust workspace follows `docs/style-guide/rust.md`; additional house rules
  live in `~/.claude/skills/rust-guidelines` (load it before Rust edits).
- When a module, crate, or package lacks a CLAUDE.md, create one when you start
  working in it — see `~/.claude/skills/project-structure`.
- **A pin that is deliberately frozen must say so next to itself.** Several
  versions here are held back on purpose and are indistinguishable from neglect
  without a note — `akka` 2.6.20 (relicensed to BSL at 2.7, so this is an
  Apache-2.0 floor), `playwright` (see `pnpm-workspace.yaml`),
  `electron-builder` 26.8.1 (pinned by its patch). Treat an unexplained old pin
  as a question, not a task.

## Verifying changes

- **Verify on Linux, not only on Windows.** Several classes of bug here are
  invisible on Windows: `prettier-plugin-organize-imports` silently corrupts Vue
  SFCs only on Linux (#19), and the Playwright integration suite cannot run on
  native Windows at all (#21). WSL is the practical route;
  `~/.enso-toolchain.sh` sets up Node/GraalVM/sbt/Maven/Rust there.
- **An incremental typecheck is not a verification after a dependency change.**
  TypeScript's `*.tsbuildinfo` reports success while skipping exactly the files
  whose module resolution changed. Delete the caches first, and measure the
  baseline on `develop` the same way before concluding a change broke anything:

  ```bash
  find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete
  find . -name '.eslintcache'   -not -path '*/node_modules/*' -delete
  ```

- **Integration tests are timing-sensitive.** Several pass in isolation and fail
  only under `--workers=2` with a whole spec running. A single run is not
  evidence in either direction — run the full spec several times on both
  branches and compare rates.
- **Toolchain versions are duplicated all over, and nothing enforces it.**
  Bumping `graalVersion` or `sbt.version` is not finished until every copy
  moves. `git grep` the _old_ version before pushing — it is the only reliable
  check. Known sites:
  - `.github/workflows/formatting.yml` — `javaVersion` and `sbtVersion` (with
    "please ensure this is in sync" comments); `enso4igv.yml` — its own
    `java-version`. sbt fails hard on a mismatch
    (`Running on GraalVM version X. Expected GraalVM version Y.`), so this
    surfaces as the _formatting_ job failing, not a build.
  - `test/Base_Tests/data/native_libs.json` and
    `test/Cloud_Tests/data/native_libs.json` — fixtures keyed by
    `component/truffle-api-<graalVersion>.jar`. These fail only in the Standard
    Library test jobs, ~20 minutes in.
  - `tools/ci/docker/engine/Dockerfile` — the `jdk-community` base image tag.
  - `distribution/**/THIRD-PARTY/NOTICE` — generated by `gatherLicenses`; goes
    stale silently, since no CI job checks it.
  - `maven_install.json` — the dormant Bazel pin; needs Bazel to repin.
- **A clean `sbt compile` proves less than it looks.** It does not exercise
  `gatherLicenses` (legal-review report shape), `bloopInstall` (BSP config for
  Metals/IntelliJ), the YAML round-trip in `DistributionPackage.scala`, or any
  test actually running — `Test/compile` only proves test sources build. Say
  which of these a change did _not_ verify.
- **Run the formatting job's own command after touching `project/plugins.sbt` or
  `project/build.properties`.** Neither `compile` nor `buildEngineDistribution`
  invokes `scalafmtCheck`, so a green native-image build is silent about an
  sbt/plugin version mismatch (sbt-scalafmt 2.6.x refuses to start below sbt
  1.12.9). The check is cheap:

  ```bash
  sbt "scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck"
  ```

## Cross-cutting gotchas

- The Rust parser is the source of truth for the AST. Changing it means
  regenerating Java bindings (`lib/rust/parser/generate-java/`) and re-bundling
  WASM (`app/rust-ffi/`). The engine and IDE both consume it.
- "Polyglot" has multiple meanings here: (1) GraalVM polyglot — Enso calling
  JS/Python/Java at runtime; (2) Enso Polyglot Bridge (EPB) — an internal
  sub-language for single-threaded language contexts; (3) `ydoc-server-polyglot`
  — the ydoc server bundled to run inside the GraalVM/JVM process. Don't
  conflate them.
- The "standard library" has two halves: pure Enso sources in
  `distribution/lib/Standard/` and Java helpers in `std-bits/`. Adding a new
  stdlib primitive usually touches both.
