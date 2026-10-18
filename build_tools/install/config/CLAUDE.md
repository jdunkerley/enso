# enso-install-config

Shared types for the installer/uninstaller. Encodes the install plan (paths,
registry entries, shortcut targets, uninstall metadata) that both halves read.

Also embeds build-time resources via `embed-resource` from `build.rs` of
consumers.

Keep serialization stable — the uninstaller may read a manifest written by a
much older installer.

The electron-builder config is embedded at build time. With
`ENSO_BUILD_ELECTRON_BUILDER_CONFIG` unset, `build.rs` embeds an empty stub so
the crates still compile (`cargo check`), and the binary panics on start-up.
With it set, a config that fails to parse fails the build: before that guard, a
removed field (`protocols`, dropped with the cloud deep links) shipped an
installer that exited silently with code 101. Fields the IDE may stop emitting
should be `#[serde(default)]`.
