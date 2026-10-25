# Enso (community fork)

This is a community fork of [Enso](https://github.com/enso-org/enso), the visual
and textual data-preparation tool built by Enso Analytics. It contains the two
halves of Enso:

- **The Enso IDE**: a desktop app (Electron, with a Vue graph editor) for
  building data workflows visually or as Enso code.
- **The Enso engine**: the Enso language's compiler and interpreter (on
  GraalVM), its language server and the standard library.

The fork adjusts the build and runs **without Enso Analytics' cloud services**.
The IDE is local-only: there is no sign-in and no cloud drive. Projects, labels,
version history (local git) and secrets stay on your machine. It is intended for
community contributions and development, and for building and running Enso for
personal use (or where that fits the
[license terms](https://ensoanalytics.com/eula) of Enso Analytics). It is not
intended for commercial use or distribution.

## Download

Installers are on this repository's
[releases page](https://github.com/jdunkerley/enso/releases):

| Platform              | Installer                                  |
| --------------------- | ------------------------------------------ |
| Windows               | `enso-win-x64-<version>.exe`               |
| Linux                 | `enso-linux-x86_64-<version>.AppImage`     |
| macOS (Apple silicon) | `enso-mac-arm64-<version>.dmg`, when built |

Stable releases are marked "Latest". Release candidates and nightly builds are
prereleases. The installers are unsigned. See
[Getting Enso](https://github.com/jdunkerley/enso/wiki/Getting-Enso) for the
release channels and updates.

## Using Enso

User documentation for the language, the libraries and the IDE is at
[help.enso.org](https://help.enso.org). Some of it describes Enso Cloud
features, which this fork does not have.

## Building from source

You need Node (through corepack), a GraalVM JDK, sbt and Rust. The pinned
versions are in the repository, and a check command tells you what is missing:

```bash
corepack pnpm install
corepack pnpm --filter build-scripts run toolchain-check
```

Build an installer for your platform:

```bash
corepack pnpm --filter build-scripts run ide-local
```

[Building and Running](https://github.com/jdunkerley/enso/wiki/Building-and-Running)
covers everything else: the engine on its own, running the IDE in development
mode, tests and formatting.

## Documentation for developers

The developer documentation is in this repository's
[wiki](https://github.com/jdunkerley/enso/wiki). Good places to start:

- [IDE Architecture](https://github.com/jdunkerley/enso/wiki/IDE-Architecture):
  how the IDE, the project manager and the engine fit together.
- [Runtime Guide](https://github.com/jdunkerley/enso/wiki/Runtime-Guide): a tour
  of the engine.
- [CI and Workflows](https://github.com/jdunkerley/enso/wiki/CI-and-Workflows):
  what runs on a pull request, and how releases are made.

## Contributing

Issues and pull requests are welcome. Read the
[contributing guide](docs/CONTRIBUTING.md) first, and report security issues as
described in the [security policy](docs/SECURITY.md). Everyone taking part is
expected to follow the [Code of Conduct](docs/CODE_OF_CONDUCT.md).

## License

The Enso engine is licensed under [Apache 2.0](LICENSE), and the Enso IDE under
[AGPL 3.0](app/gui/LICENSE).

Enso is developed upstream by [Enso Analytics](https://www.ensoanalytics.com) at
[enso-org/enso](https://github.com/enso-org/enso).
