# distribution/

Inputs, templates, and authored content that make up a **shipped Enso
distribution**. Most runtime behavior lives elsewhere; this directory is mostly
data and layout.

## Layout

- `lib/Standard/` — **The Enso standard library.** `.enso` source files. One
  directory per module (`Base`, `Table`, `Database`, `AWS`, …). Every module
  pins a version under `0.0.0-dev/` (the placeholder version used during
  development — release engineering rewrites it). See `lib/Standard/CLAUDE.md`.
- `engine/` — Auxiliary files shipped alongside the compiled engine (component
  group metadata, etc.).
- `bin/` — Scripts shipped in the distribution.
- `edition.template.yaml` — Template for edition manifests produced at release
  time.
- `manifest.template.yaml` — Template for the distribution manifest.

## Editions and libraries

Library versions and supported engine versions are grouped into **editions**
(see
[Libraries-Editions](https://github.com/jdunkerley/enso/wiki/Libraries-Editions)).
The edition template in this directory is the source of truth for the layout a
release artifact produces.

The fork runs no upstream library repository or edition provider, so nothing in
the template points at enso-org. Every library entry names the one repository,
`release`: a `jar:` URL for `std_image_repo.zip` on the fork's GitHub release.
It is the future home of libraries that are not bundled with the engine (the
build marks every library in a `jar:` repository for upload, `librariesToUpload`
in `build.sbt`). Nothing is uploaded yet: the release workflow does not publish
the zip, so a library that is not bundled fails as not found. The engine looks
bundled libraries (everything in `lib/Standard`, `Standard.Image` included) up
in its own distribution before it consults the repository.

## Changing the standard library

Most changes land in `lib/Standard/<Module>/0.0.0-dev/src/` (Enso) paired with
matching helpers in `std-bits/<module>/`. Always run the matching
`test/<Module>_Tests` suite.

## Do not commit

- Built artifacts (`dist/` at repo root is for outputs).
- Pinned third-party binaries beyond what's needed for bootstrapping.
