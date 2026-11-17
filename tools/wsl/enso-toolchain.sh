# Enso toolchain for WSL: GraalVM (JAVA_HOME), sbt, GraalPy, Node (via nvm or fnm), Rust.
#
# Source it; don't run it. ~/.bashrc stops early in non-interactive shells, so `wsl -e bash -lc`
# gets none of its setup - start such commands with this instead:
#
#   wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide && sbt compile'
#
# Install: copy this file (tools/wsl/enso-toolchain.sh in the repo) to ~/.enso-toolchain.sh and
# source it from ~/.profile and ~/.bashrc. Edit the repo copy and copy it again; do not edit ~ only.
#
# The versions come from the checkout, so a GraalVM or Node bump in the repo needs no edit here:
#   - GraalVM: `graalMavenPackagesVersion` in project/Dependencies.scala, matched against
#     ~/.graalvm/graalvm-community-openjdk-<version>+* (JDK 25.0.x) or
#     ~/.graalvm/graalvm-community-<version>+* (the 25.5 line and later)
#   - Node:    .node-version (through nvm if installed, else fnm; installed on first use)
#   - GraalPy: the newest ~/.graalpy/graalpy*/bin (pin: graalPyVersion; CI's setup-jvm installs it)
# The checkout is the git repository containing $PWD, else $ENSO_REPO, else /mnt/c/Repos/Enso/ide.
#
# Maven is only used by tools/enso4igv; it is added to PATH if installed, not required.

_enso_toolchain() {
    local repo
    # Fails inside a Windows git worktree seen through /mnt/c; fall back below.
    repo=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || repo=
    if [ -z "$repo" ] || [ ! -f "$repo/project/Dependencies.scala" ]; then
        repo=${ENSO_REPO:-/mnt/c/Repos/Enso/ide}
    fi
    if [ ! -f "$repo/project/Dependencies.scala" ]; then
        echo "enso-toolchain: no Enso checkout at $repo (set ENSO_REPO)." >&2
        return 1
    fi

    # Keep Windows binaries (sbt.bat, Windows node, cargo.exe) off the PATH.
    PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)
    # ~/.local/bin (fnm, cs, flatc) goes first, so the pinned GraalVM and sbt below go before it.
    case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) PATH=$HOME/.local/bin:$PATH ;; esac

    # --- GraalVM ---
    local graal graal_home
    graal=$(sed -n 's/.*val graalMavenPackagesVersion *= *"\([^"]*\)".*/\1/p' \
        "$repo/project/Dependencies.scala")
    # Both naming forms: graalvm-community-openjdk-<v>+... and graalvm-community-<v>+...
    graal_home=$(ls -d "$HOME"/.graalvm/graalvm-community-openjdk-"$graal"+* \
        "$HOME"/.graalvm/graalvm-community-"$graal"+* 2>/dev/null | sort -V | tail -n1)
    if [ -n "$graal_home" ]; then
        export JAVA_HOME=$graal_home
        PATH=$JAVA_HOME/bin:$PATH
    else
        echo "enso-toolchain: GraalVM $graal is not in ~/.graalvm. Download" \
            "graalvm-community-jdk-${graal}_linux-x64 from" \
            "https://github.com/graalvm/graalvm-ce-builds/releases and unpack it there." >&2
    fi

    # --- sbt ---
    [ -x "$HOME/.sbt/sbt/bin/sbt" ] && PATH=$HOME/.sbt/sbt/bin:$PATH

    # --- Maven (optional) ---
    local mvn_home
    mvn_home=$(ls -d "$HOME"/.maven/apache-maven-* 2>/dev/null | sort -V | tail -n1)
    [ -n "$mvn_home" ] && PATH=$mvn_home/bin:$PATH

    # --- GraalPy (optional) ---
    local graalpy_home
    graalpy_home=$(ls -d "$HOME"/.graalpy/graalpy* 2>/dev/null | sort -V | tail -n1)
    [ -n "$graalpy_home" ] && PATH=$graalpy_home/bin:$PATH

    # --- Node: nvm if installed, else fnm ---
    local node
    node=$(tr -d '[:space:]' < "$repo/.node-version" 2>/dev/null)
    export NVM_DIR=$HOME/.nvm
    if [ -s "$NVM_DIR/nvm.sh" ] && [ -n "$node" ]; then
        . "$NVM_DIR/nvm.sh"
        nvm use "$node" >/dev/null 2>&1 || {
            echo "enso-toolchain: installing Node $node through nvm." >&2
            nvm install "$node" >/dev/null && nvm use "$node" >/dev/null
        } || echo "enso-toolchain: could not set up Node $node." >&2
    elif [ -x "$HOME/.local/bin/fnm" ] && [ -n "$node" ]; then
        eval "$("$HOME/.local/bin/fnm" env --shell bash)"
        fnm use "$node" >/dev/null 2>&1 || {
            echo "enso-toolchain: installing Node $node through fnm." >&2
            fnm install "$node" >/dev/null && fnm use "$node" >/dev/null
        } || echo "enso-toolchain: could not set up Node $node." >&2
    fi
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    # --- Rust (rust-toolchain.toml picks the version) ---
    [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

    export PATH
}

# Callers may source this under `set -e` or `set -o pipefail`, and nvm.sh does not
# survive either. Run with both off, then put back exactly what the caller had.
# `$(set +o)` alone would lose errexit: command substitutions do not inherit it, so
# read that one from `$-` in this shell.
_enso_toolchain_opts=$(set +o)
case $- in *e*) _enso_toolchain_errexit=1 ;; *) _enso_toolchain_errexit= ;; esac
set +e +o pipefail
_enso_toolchain
_enso_toolchain_status=$?
eval "$_enso_toolchain_opts"
[ -n "$_enso_toolchain_errexit" ] && set -e
unset -f _enso_toolchain
unset _enso_toolchain_opts _enso_toolchain_errexit
return "$_enso_toolchain_status" 2>/dev/null || true
