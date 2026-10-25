# tools/

Utility binaries and scripts that aid engine/GUI development. **Not** a catch-all for misc files — each subdir has a specific justified purpose.

## Subdirs

- `http-test-helper/` — Local HTTP mock server used by `test/Base_Tests`. Java, built via SBT.
- `enso4igv/` — Enso language support for the GraalVM Ideal Graph Visualizer (IGV). Load this when debugging Truffle compilation graphs. See `docs/runtime-guide.md` §Tips.
- `performance/` — Engine benchmarks and analysis scaffolding (`engine-benchmarks/`, `benchmark-analysis/`).
- `ci/` — CI helper scripts: `windows-installer-smoke.ps1` (installs, starts and uninstalls the Windows installer in IDE packaging, #251), `wait-for-macos-runner.sh` (gates jobs for the self-hosted Mac, #288), `check-workflows.mjs` (the workflow policy check: the rules the retired CI generator's tests enforced, run in CI over `.github/workflows` and composite actions; test with `node --test tools/ci/*.test.mjs`) and `toolchain-pins.mjs` (reads the `toolchain:` pins in `build-config.yaml` exactly as `setup-jvm` does, for the policy and `tools/build-scripts`' `toolchain-check`).
- `build-scripts/` — TypeScript package with the build logic: `version`,
  `toolchain-check`, `ide-local` (a developer's whole IDE build) and the CI
  commands. Node runs it directly; see its CLAUDE.md.
- `legal-review/`, `legal-review-helper/` — Third-party dependency license-review inputs and helpers.
- `simple-library-server/` — Minimal HTTP library-server stub for testing the library download flow without touching the real library repository.

## Conventions

- Each tool must stay runnable without the full repo build. If it needs the engine, make that explicit via environment variables or args.
- Don't put production code here: it belongs in `engine/` or `lib/`.
