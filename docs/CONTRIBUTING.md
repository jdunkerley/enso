# Contributing to Enso

Thank you for helping. This guide covers how to report a problem, suggest an
idea and send a change. How to build, run and test Enso is on the wiki, in
[Building and Running](https://github.com/jdunkerley/enso/wiki/Building-and-Running).

Everyone taking part is expected to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting a bug

1. [Search the issues](https://github.com/jdunkerley/enso/issues?q=is%3Aissue)
   first. If you're not sure whether it's a duplicate, file it anyway.
2. Open a [bug report](https://github.com/jdunkerley/enso/issues/new/choose).
   Clear reproduction steps make the biggest difference.
3. Include the Enso version and your operating system.
4. For a problem in a project, attach the engine log. Open the **Logs** panel at
   the bottom of the project view and download the session's log.

**A security problem must not be reported in a public issue.** See the
[security policy](./SECURITY.md).

## Suggesting a feature

Open a [feature request](https://github.com/jdunkerley/enso/issues/new/choose).
Say what you're trying to do, not only the change you have in mind.

## Sending a pull request

1. Base your branch on `develop`, and open the pull request against `develop`.
2. Follow the style guide for each language you touch. The formatters are the
   authority; the
   [Style Guides](https://github.com/jdunkerley/enso/wiki/Style-Guide) cover the
   rest.
3. Run the formatters and the tests for what you changed. The commands are in
   [Building and Running](https://github.com/jdunkerley/enso/wiki/Building-and-Running#formatting-and-lint).
   The pre-commit hook formats staged files; see
   [Formatting hook](#formatting-hook).
4. **Changelog:** a new feature, or a change users can see, needs an entry in
   `CHANGELOG.md` under `# Next Release`. Anything else (bug fixes, docs,
   refactoring, tests, CI, dependency bumps) takes the `CI: No changelog needed`
   label instead. The Changelog check fails a PR that has neither.
5. **Visual changes:** attach before and after screenshots, or a screencast for
   anything animated or interactive.
6. **Documentation:** if your change makes a
   [wiki](https://github.com/jdunkerley/enso/wiki) page wrong, update the page
   too, and say so in the pull request. Wiki edits aren't reviewed and run no
   CI.

### Formatting hook

`corepack pnpm install` installs a Husky pre-commit hook that runs lint-staged
(`lint-staged.config.mjs`) on the files you staged, and only on those:

| Staged files                                  | Formatter                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| TypeScript, Vue, JSON, Markdown, YAML, CSS, … | Prettier                                                               |
| `.rs`                                         | `rustfmt`, edition from the owning crate, `rustfmt.toml` from the repo |
| `.java`                                       | google-java-format, the version in `project/plugins.sbt`, Google style |
| `.scala`, `.sbt`                              | scalafmt, the version in `.scalafmt.conf`                              |

A language's tool only starts when files of that language are staged, so a
Markdown-only commit starts no JVM. Rust, Java and Scala are handled by
`tools/pre-commit/format-staged.mjs`:

- **A missing tool never blocks a commit.** Without `rustfmt`, a JDK 21+, or
  Coursier (`cs`), or when a download or Coursier fetch fails (offline), the
  hook prints a `pre-commit: skipping ...` notice and the commit goes ahead; CI
  will still check that language. Only a formatter rejecting a staged file (a
  syntax error) fails the commit.
- Java downloads the pinned google-java-format jar once, to
  `~/.cache/enso-format/`, verified against a SHA-256 pinned in the script.
  Scala runs `cs launch` of the pinned scalafmt-cli (or a `scalafmt` on `PATH`
  reporting that exact version).
- Rust is formatted one staged file at a time, through `rustfmt`'s stdin, with
  the edition read from the file's `Cargo.toml` (or the workspace's). Nothing
  else is read or written, so untracked, deleted or broken files elsewhere in
  the workspace don't matter.
- To bypass the hook, use `git commit --no-verify`. The same checks run in CI
  (`sbt scalafmtCheckAll javafmtCheckAll`, `cargo fmt -- --check`, Prettier).

[CI and Workflows](https://github.com/jdunkerley/enso/wiki/CI-and-Workflows)
explains which checks run on a pull request and what the labels do.

## Where to learn more

- The [developer wiki](https://github.com/jdunkerley/enso/wiki), starting at
  [IDE Architecture](https://github.com/jdunkerley/enso/wiki/IDE-Architecture)
  or the [Runtime Guide](https://github.com/jdunkerley/enso/wiki/Runtime-Guide).
- The `CLAUDE.md` files throughout the repository. Each describes its folder in
  detail, and they are kept current.
