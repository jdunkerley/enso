# CI Tools

Scripts that the GitHub workflows run:

- `windows-installer-smoke.ps1` — installs the Windows installer silently,
  checks it is registered and starts, then uninstalls it (IDE packaging, #251).
  It refuses to run where an Enso is already installed.
- `wait-for-macos-runner.sh` — gates jobs on the self-hosted Mac being online
  (#288).

# Workflow policy

`check-workflows.mjs` checks the hand-written workflows and composite actions
against the rules that the CI generator's unit tests used to enforce: pull
request triggers ignore specs and plans, `setup-node` disables the package
manager cache before pnpm is set up, releases are IDE-only and read only
allow-listed secrets, only macOS release jobs may fail, macOS jobs are gated on
the self-hosted Mac, `macos-checks.yml` runs only what is requested, IDE
packaging needs no cloud account, Windows packaging smoke-tests the installer,
the toolchain pins in `build-config.yaml` equal the build's own copies, no job
runs sbt before `setup-jvm`, and in `tools/build-scripts` only `src/lib/sbt.ts`
starts sbt. "Runs sbt" covers wrappers (`timeout`, `env`, `xvfb-run`, `cmd /c`,
…), `bash -c`/`pwsh -Command` scripts, local composite actions, and any
`tools/build-scripts` command whose entry point imports `src/lib/sbt.ts`. It
prints one line per violation and exits 1 if there is any:

```bash
node tools/ci/check-workflows.mjs [repo-root]
```

Test it with `node --test tools/ci/check-workflows.test.mjs`. Each rule has a
passing and a failing fixture there; adding a rule means adding both.

# Toolchain pins

`toolchain-pins.mjs` reads the `toolchain:` block of `build-config.yaml` exactly
as `setup-jvm`'s awk does; the policy and `tools/build-scripts`'
`toolchain-check` use it. `toolchain-pins.test.mjs` runs that awk program over
the same fixtures and requires the same answers, so the readers cannot drift.
