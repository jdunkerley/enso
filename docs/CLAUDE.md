# docs/

The developer documentation for the Enso Engine (not user docs, which live at
https://help.enso.org) is in this repository's wiki:
https://github.com/jdunkerley/enso/wiki. It moved there from this folder on
2026-10-25. What stays here:

- `superpowers/` — design specs (`specs/`) and implementation plans (`plans/`).
  PRs cite them, and a PR that changes only these files starts no CI workflow.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` — the community files.
  GitHub reads them from this folder.

## Reading the wiki

The wiki is a Git repository. Clone it somewhere outside this checkout (a
scratch directory) and read or grep it like any other docs tree:

```bash
git clone https://github.com/jdunkerley/enso.wiki.git
```

Each page is a Markdown file named after the page: `Runtime-Guide.md`,
`Style-Guide-Rust.md`. Pages sit in one folder per section, but links go by page
name only, so names are unique across the wiki. `Home.md` is the index and
`_Sidebar.md` lists every page by section.

Useful starting points:

- [Runtime-Guide](https://github.com/jdunkerley/enso/wiki/Runtime-Guide) —
  practical tour of the Truffle/GraalVM side; the single most useful page when
  working on the runtime.
- [SBT-Cheatsheet](https://github.com/jdunkerley/enso/wiki/SBT-Cheatsheet) — SBT
  command reference tailored to this project.
- [Style-Guide](https://github.com/jdunkerley/enso/wiki/Style-Guide) — the
  per-language style guides.
- [Language-Server](https://github.com/jdunkerley/enso/wiki/Language-Server) —
  the LS protocol, endpoints and behaviour.

## Editing the wiki

Edit in the browser, or commit to the wiki clone and push. Wiki edits are not
reviewed and run no CI, so when a code change makes a page stale, change the
page in the same piece of work and mention it in the PR body. Link between pages
by page name (`[text](Runtime-Guide#anchor)`); link to code with a full
`https://github.com/jdunkerley/enso/blob/develop/...` URL, since relative paths
do not reach the repository.
