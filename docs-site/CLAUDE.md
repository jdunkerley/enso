# docs-site

The user documentation site: hand-written guides plus a Components reference
generated from every standard library's `catalogue.json`, one page per function,
each drawn as the graph editor draws it. Docusaurus 3; React is used here and
nowhere else in the repository. Published from `develop` to
`https://jdunkerley.github.io/enso/` (the workflows are in
`.github/workflows/docs-site*.yml`; see "CI"). Design:
`docs/superpowers/specs/2026-11-04-user-docs-site-design.md` (the versioning
design is its section 6); plan:
`docs/superpowers/plans/2026-11-04-user-docs-site.md`.

## Layout

- `docs/` — the pages. `intro.md` and the guides are hand-written;
  `docs/api/index.md` (the Components intro) is hand-written and kept by the
  generator; everything else under `docs/api/` is generated and git-ignored.
- `generator/src/` — the generator (TypeScript, run under `vite-node`):
  `catalogue.ts` and `groups.ts` read a distribution's `lib`; `model.ts`
  classifies entries into pages, paths and indexes; `sections.ts` and `mdx.ts`
  turn doc comments into MDX; `componentNode.ts` computes the node's props;
  `pages.ts` writes each page; `sidebarData.ts`, `output.ts`, `report.ts` and
  `main.ts` write the rest and print the report. A `*.test.ts` sits beside each.
- `generator/fixtures/` — `lib/` (two small fixture libraries covering every
  case) and `golden/` (`Table.filter`'s real catalogue entry and its reviewed
  page, `Table.filter.mdx`).
- `src/` — `components/ComponentNode.tsx` (the node; its prop types come from
  `generator/src/componentNode.ts`), `theme/MDXComponents.tsx` (makes
  `<ComponentNode>` available to MDX), `css/custom.css` (site colours, link
  underlines), `pages/index.tsx` (the root redirects to the guides).
- `e2e/` — Playwright: axe in both colour modes, keyboard, hover and touch
  tooltips, on the built site.
- `scripts/serve.mts` — the static server for the built site (see Gotchas).
- Generated and git-ignored: `generated/apiSidebars.json`,
  `src/css/groups.generated.css`, `static/img/icons.svg` (the IDE's sprite),
  `build/`, `.docusaurus/`.

## Scripts

```bash
corepack pnpm --filter docs-site run generate -- --fixtures      # fixture reference
corepack pnpm --filter docs-site run generate -- --lib <dist>/lib # the real one
corepack pnpm --filter docs-site run build                       # docusaurus build
corepack pnpm --filter docs-site run serve                       # http://localhost:3210/enso/
corepack pnpm --filter docs-site run test:unit                   # generator tests
corepack pnpm --filter docs-site run test:e2e                    # needs a build
```

`typecheck`, `lint` and `test:unit` need no distribution (they run in the GUI
checks through the root `ci:*` scripts). `generate` with `--lib` applies the
function-page floor (`MIN_FUNCTION_PAGES` in `main.ts`) unless
`--min-function-pages` is given; `--fixtures` has none.

A real distribution without building one: the catalogues of the newest green
`develop` engine run.

```bash
run=$(gh run list -R jdunkerley/enso -w engine-pull-request.yml -b develop -s success -L 1 --json databaseId --jq '.[0].databaseId')
mkdir -p "$SCRATCH/dist" && cd "$SCRATCH/dist"
gh run download "$run" -R jdunkerley/enso -n "Engine Distribution (GraalVM CE) (linux, amd64)"
tar -xf built-distribution.tar --wildcards 'built-distribution/*/lib/*/*/*/catalogue.json' 'built-distribution/*/lib/*/*/*/package.yaml'
rm built-distribution.tar
# then: generate -- --lib "$(ls -d "$SCRATCH"/dist/built-distribution/*/*/lib)"
```

Keep `$SCRATCH` outside the checkout.

## CI

Three routes (`.github/CLAUDE.md` has the workflow notes):

- **A. Engine checks.** `engine-checks-platform.yml` › Docs site (Linux, GraalVM
  CE) calls `docs-site-build.yml` with the run's distribution: it extracts the
  catalogues (`scripts/extract-catalogues.sh`), uploads them as
  `docs-site-catalogues`, generates, builds, runs the browser tests and uploads
  the site as `docs-site`. A doc comment that breaks the site fails the PR that
  changes it.
- **B. Site-only pull requests.** `docs-site.yml` runs when a PR touches
  `docs-site/` or the GUI code the generator loads. It takes the catalogues of
  the newest `develop` run that has them and whose commit is an ancestor of the
  PR's merge commit (Note [Docs Site Catalogues]), then calls the same build
  with `static-checks` (typecheck, lint, unit tests). These PRs do not run the
  GUI checks.
- **C. Deploy.** `docs-site-deploy.yml` publishes a `develop` engine run's
  `docs-site` artifact with `actions/deploy-pages`, only when the repository
  variable `DOCS_SITE_DEPLOY` is `true`.

`docs-site.yml`'s `paths` whitelist must cover every file the generator loads;
`generator/src/workflowPaths.test.ts` crawls the imports of `gui.ts` and fails
when one is missing. Adding an import to `gui.ts` that leaves the listed
directories means adding a path. The globs cover whole packages
(`app/ydoc-shared/**`, `app/common/**`), so most PRs touching those also run
route B (about 8 minutes); route A runs on every engine-checked PR (about 7.5
runner-minutes, off the critical path). Both are accepted costs. No pnpm-store
or Playwright-browser cache yet: each run installs cold.

**Preview a PR's site:** download the `docs-site` artifact of the PR's run,
unzip it into `docs-site/build`, then
`corepack pnpm --filter docs-site run serve`.

**One-time Pages setup (the repository owner):** Settings › Pages › Source
"GitHub Actions"; Settings › Environments › `github-pages` › deployment branches
`develop` only; Settings › Variables › Actions: `DOCS_SITE_DEPLOY` = `true`.
Until then the deploy job is skipped. After the first deploy check
`curl -sI https://jdunkerley.github.io/enso/docs/api/Standard.Table/Table/Table.filter`
answers a 301 to the slashed URL (OQ 8, the GitHub Pages half); if not, add the
redirect another way.

## Rules

- **The generator imports the IDE's code, never copies it**, and only through
  `generator/src/gui.ts` (PR 3's workflow path list is checked against it). The
  site and the IDE's help panel agree because they run the same functions:
  `documentationData`, the Lezer `ensoMarkdownParser`, `prerenderMarkdown`,
  `extractMetadata`, the group colours, the icon rule, `isRequiredArgument`,
  `projectPathKey` and `apiPath` (`app/common/src/docsSite/apiPath.ts`, which
  the IDE's documentation links will use too). When a GUI module will not load
  in Node, move the needed code into a module that does, re-export it from the
  old place, and import it from the new one. Moves made so far, each because its
  old module reached the WASM parser, Vue or the suggestion database:
  `prerenderMarkdown` (`ydoc-shared/ast/prerenderMarkdown`), `GroupInfo`
  (`suggestionDatabase/groupInfo.ts`), `isRequiredArgument`
  (`suggestionDatabase/argument.ts`), `groupColorVar`/`groupColorStyle`/
  `groupColor` (`project-view/util/groupColors.ts`), the icon rule
  (`project-view/util/entryIcon.ts`) and `ProjectPath.key()`'s rule
  (`project-view/util/projectPathKey.ts`).
- `tsconfig.json` is not composite (the GUI files reached through the aliases
  are not in its `include`) and uses the `source` export condition;
  `vitest.config.ts` restates the GUI's three aliases rather than importing the
  GUI's Vite config. A typecheck that starts reaching a `.vue` file or
  `suggestionDatabase/index.ts` means a GUI module pulled in too much: move the
  type it needs, as `GroupInfo` was.
- Generated text is never formatted or committed; `.prettierignore` and
  `eslint.config.mjs` skip it.

## The golden page

`generator/fixtures/golden/Table.filter.mdx` is a reviewed expectation, not a
snapshot. After a deliberate change to the page layout, regenerate it with a
throw-away script under `generator/fixtures/golden/` (run from `docs-site/` with
`corepack pnpm exec vite-node --config vitest.config.ts <script>`) that does
what `pages.test.ts`'s golden test does and writes the result, then read the
diff before committing. Fix the generator, not the file.

## Measurements (the full reference, 2026-11-05)

From the catalogues of develop run 41928058656 (2026.1.1-dev):

- **Pages:** 3244 function pages (`N`), 35 conversions (listed on their target
  types), 18 libraries with a catalogue; `Standard.Database_Test_Suite` and
  `Standard.Visualization` have none (`catalogue: false`). 785 function pages
  have no documentation (mostly getters); no unknown icons; 81 type names have
  no page (private or builtin types). The floor `MIN_FUNCTION_PAGES` is 2500.
- **Build:** Linux (WSL, 32 cores): 3 min 43 s wall, peak RSS 7.7 GiB, under the
  20-minute and 10 GB limits, so no fallback is on (`@docusaurus/faster` and
  per-library docs instances were not needed). Windows: 216 s. The output is
  about 310 MB.
- **CI (`ubuntu-latest`, 4 vCPU, 16 GB, 2026-11-05):** the build step takes 5 to
  6 minutes (324 s in the engine checks, 317 s and 362 s in `docs-site.yml`)
  with a peak RSS of 5.8 GiB under the 8 GB heap limit, so the 32-core numbers
  above are the upper bound and no fallback is needed. The whole job is about
  7.5 minutes (`timeout-minutes: 30`); with `static-checks` and the WASM build
  it is the same.
- **Search index:** `search-index.json` is 13.2 MB, 2.3 MB gzipped, under the 5
  MB limit, so one index serves the whole site (no `searchContextByPaths`).
- **Dotted paths, local half:** `serve` redirects `…/Table.filter` to
  `…/Table.filter/` and serves the page. The GitHub Pages half is checked after
  the first deploy (plan PR 3).
- **Result tables:** the indented `| … |` rows under "Returns a Table" in
  examples are code blocks to the Markdown parser (so the IDE's help panel shows
  them as code); `mdx.ts` turns a code block made only of table rows into a
  table, so the site shows tables.
- **Case collisions:** 30 pairs, handled by `CaseSafeDirs` (see Gotchas).
- **Accessibility:** the axe, keyboard and touch tests pass on the fixture build
  and on the real `Table.filter` and `Table` pages, in both modes.

## Gotchas

- **No `"type": "module"` in `package.json`.** With it webpack treats
  `.docusaurus/registry.js` as strict ESM and the server build fails with
  `require.resolveWeak is not a function`.
- **`serve` is `scripts/serve.mts`, not `docusaurus serve`.** Docusaurus's
  static handler (`serve-handler`) takes a folder with a dot in its name
  (`Table.filter/`) for a file and answers 404, and every function page is one.
  Ours behaves like GitHub Pages: a folder is served by its `index.html`, and a
  folder asked for without its slash is redirected to it.
- **Paths that differ only in case.** The reference has about thirty (a
  constructor `Name` and a getter `name`, a module `Read` and a function
  `read`). URLs keep both; `CaseSafeDirs` (`model.ts`) gives the later spelling
  of a folder the name `<name>~<n>` so the generated files stay apart on Windows
  and macOS. The Docusaurus build output is still written at the URL paths, so a
  build of the full reference on a case-insensitive file system keeps only one
  page of each pair: build it on Linux (CI does).
- **`vite-node` 3.2.4, not 3.0.3.** 3.0.3 against the repository's Vite 7 fails
  with `__vite_ssr_exportName__ is not defined`.
- **`hoist=false`** (`.npmrc`): every package reached must be declared. No
  package had to be added for Docusaurus. `@mdx-js/mdx` and `remark-gfm` (the
  versions Docusaurus uses) and `@types/react-dom` are dev dependencies for
  `mdxRender.test.ts`, which compiles and renders generated MDX. pnpm 12 also
  asks for a decision on every build script: `core-js` is `false` in
  `pnpm-workspace.yaml`'s `allowBuilds`.
- **MDX escaping** (`mdx.ts`): text escapes `{ } < >`; a Markdown backslash
  escape is kept (`\{`) or made an entity (`\<`), never escaped again; a result
  table's rows are escaped outside their code spans; a block starting with
  `import`/`export` gets its first letter as an entity. `mdxRender.test.ts`
  holds the adversarial cases; add one there for any new path from doc text to
  MDX.
- **Default values are shown as the catalogue gives them.** The engine renders a
  prefix application with its arguments first (`Missing_Argument."column".throw`
  for `Missing_Argument.throw "column"`), #582. The generator does not rewrite
  them.
- **Return types come from the catalogue**, which gives `Any` for a function
  declared `-> Table & Any ! …` (`Table.filter`), so its node says "Returns
  Any".
