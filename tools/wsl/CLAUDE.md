# tools/wsl/

The WSL (Linux) side of a developer machine.

- `enso-toolchain.sh` — sourced, never run: puts the pinned GraalVM, sbt,
  GraalPy, Node and Rust on the `PATH` for a `wsl -e bash -lc` command, which
  otherwise gets none of `~/.bashrc`'s setup and silently uses the Windows
  binaries under `/mnt/c`. It reads the versions from the checkout
  (`graalMavenPackagesVersion`, `.node-version`), so a toolchain bump needs no
  edit here.

## Installing

1. Copy it to `~/.enso-toolchain.sh` and source it from `~/.profile` and
   `~/.bashrc`:
   `[ -f "$HOME/.enso-toolchain.sh" ] && . "$HOME/.enso-toolchain.sh"`.
2. Put the toolchain where it looks, at the `toolchain:` pins in
   `build-config.yaml` (no sudo needed):
   - GraalVM CE: unpack the release's Linux archive into `~/.graalvm/` (the
     archive name `setup-jvm` builds, `.github/actions/setup-jvm/action.yml`;
     check its `.sha256`).
   - sbt: unpack `sbt-<version>.tgz` into `~/.sbt/` (giving `~/.sbt/sbt/bin`).
   - GraalPy: the **community** standalone
     (`graalpy3.<n>-community-<version>-linux-amd64.tar.gz`) into
     `~/.graalpy/`. Only `test/Examples_Tests`' Python spec needs it.
   - Node: through nvm or fnm (`~/.local/bin/fnm`); the script installs
     `.node-version` on first use.
   - Rust: rustup; `rust-toolchain.toml` picks the version.
   - flatc, `cs` (Coursier, for the format hook): in `~/.local/bin`.
3. Check: `corepack pnpm --filter build-scripts run toolchain-check` from a
   Linux clone, after sourcing the script.

## Rules

- Edit this copy and copy it to `~` again. The script once lived only in a
  WSL home directory and was lost with the distro (2026-11-17).
- `~/.local/bin` goes on the `PATH` before the pinned GraalVM and sbt, so an
  older `sbt` launcher there cannot win.
- It must survive being sourced under `set -e` / `set -o pipefail` (nvm.sh does
  not): keep the option save and restore at the end.
