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
   The pre-commit hook runs Prettier on staged files; don't skip it.
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

[CI and Workflows](https://github.com/jdunkerley/enso/wiki/CI-and-Workflows)
explains which checks run on a pull request and what the labels do.

## Where to learn more

- The [developer wiki](https://github.com/jdunkerley/enso/wiki), starting at
  [IDE Architecture](https://github.com/jdunkerley/enso/wiki/IDE-Architecture)
  or the [Runtime Guide](https://github.com/jdunkerley/enso/wiki/Runtime-Guide).
- The `CLAUDE.md` files throughout the repository. Each describes its folder in
  detail, and they are kept current.
- User documentation at [help.enso.org](https://help.enso.org).
