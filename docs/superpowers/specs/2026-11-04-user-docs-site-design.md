# User documentation site (help.enso.org successor)

Issue: #240 (local versioning user docs) led here. Status: design approved by
the owner, 2026-11-04; this spec writes it down and grounds it in the code.

## Goal and scope

A user documentation site for the fork, the successor of help.enso.org (which
the owner built upstream), published from `develop` to GitHub Pages at
`https://jdunkerley.github.io/enso/`. It has two halves, as help.enso.org did:

- **Guides:** hand-written Markdown about using the IDE.
- **Components:** an API reference generated from the standard libraries'
  documentation comments, one page per function, each showing the function as
  the graph editor draws it.

In scope: the `docs-site/` package (Docusaurus), the generator, the first set of
guides, CI that builds the site on pull requests and deploys it from `develop`,
and a design for per-release versions that changes no URL. The IDE's links to
the site are a follow-up PR, specified here (section 7) so the URL scheme is
fixed once.

Out of scope: see the last section. Developer documentation stays in the wiki.

## Decisions (the owner's, 2026-11-04)

1. **Content:** a generated API reference plus hand-written guides, like
   help.enso.org.
2. **Hosting:** in this repository, published from `develop` to GitHub Pages for
   now. Per-release versioned docs (Docusaurus versioning, `develop` = "next")
   arrive once there is a release, and that switch changes no URL.
3. **IDE links** once the site is live (follow-up PR): F1 / "Open documentation"
   on a component opens its page; "Documentation" in the settings menu; the base
   URL in the IDE's config. #566 (open at the time of writing) removes the old
   help.enso.org links.
4. **Each function entry looks as it does in the graph editor**, as on
   help.enso.org: a component "node" with icon, group colour, name and parameter
   pills, with the return type and "Type = default" as tooltips. Colours and
   icons come from the IDE itself, so the two stay identical, and the tooltips
   work from the keyboard and on touch, not on hover only.

The agreed design (presented and approved):

- A new top-level `docs-site/` pnpm workspace package: Docusaurus, hand-written
  guides, and a TypeScript `generator/` that writes the API section into a
  git-ignored folder.
- **Generator input:** the `catalogue.json` of every library in a built
  distribution (`2026-10-31-library-catalogue-design.md` §1).
- **Doc comments are read with the GUI's own parser,** imported from the
  workspace, not copied, so the site and the IDE's help panel agree.
- **Rejected:** the engine's `enso --docs` (`DocsEmitMarkdown` is a ~60-line
  stub: headings and raw text, no arguments or types); parsing `.enso` sources
  with the WASM parser (it would redo export and visibility resolution,
  extension methods and signatures, all of which the catalogue already has).
- Local search (no external service). Unit tests on fixture catalogues; the
  build fails on a broken internal link.
- CI builds the site (no publish) on pull requests that touch `docs-site/**`,
  `distribution/lib/**` or the doc parser, and on `develop` also deploys it. It
  reuses the engine build's distribution artifact rather than compiling the
  standard libraries a second time.
- Delivery: this spec, then a plan, then three PRs (generator and skeleton;
  guides; CI and deploy). The site is user-facing: a changelog entry, and the
  owner reviews a preview build before the first deploy.

## Where things are today

(From a read of the code at `eeef85f221`, 2026-11-04.)

- **The catalogue.** `TruffleCompilerContext.writeCatalogue` (Note [Library
  Catalogue]) writes `catalogue.json` next to each library's `package.yaml`
  whenever `enso --compile` serialises the library's suggestions, so
  `indexStdLibs` (`project/DistributionPackage.scala`) produces one for every
  standard library in every built distribution, at
  `built-distribution/enso-engine-*/enso-*/lib/Standard/<Lib>/<version>/catalogue.json`.
  `ciBuildEngineDistribution` then checks them with the language server's rule
  (`ShippedCataloguesSpec`). `Database_Test_Suite` and `Visualization` say
  `catalogue: false` and have none. The catalogue is generated, never committed.
- **Its format** (`LibraryCatalogue.toJson`,
  `engine/polyglot-api/.../LibraryCatalogue.scala`):

  ```json
  {
    "format": 1,
    "library": "Standard.Table",
    "version": "0.0.0-dev",
    "engineVersion": "2026.1.1-dev",
    "sourceHash": "…",
    "entries": [ … ]
  }
  ```

  The entries use `SuggestionJson`, the codec the language server sends, so the
  TypeScript shape is `SuggestionEntry` in
  `app/ydoc-shared/src/languageServerTypes/suggestions.ts`. Only global entries
  outside `Internal` modules and without `private: true` are kept
  (`LibraryCatalogue.isPublished`). Per kind:
  - `"type": "module"`: `module`, `documentation`, `reexport`.
  - `"type": "type"`: `module`, `name`, `params`, `parentType`, `documentation`,
    `reexport`.
  - `"type": "constructor"`: `module`, `name`, `arguments`, `returnType`,
    `documentation`, `annotations`, `reexport`.
  - `"type": "method"`: `module`, `name`, `arguments`, `selfType`, `returnType`,
    `isStatic`, `documentation`, `annotations`, `reexport`. Getters and
    conversions are written as methods too (`getterToMethod`,
    `conversionToMethod`). A conversion is a method named `from`, not static,
    whose first argument is `that` (`SuggestionJson.isConversion`).
  - Every kind also carries `reexports` (the full set; `reexport` is its first
    element), which the TypeScript type does not declare.
  - An argument is
    `{name, reprType, isSuspended, hasDefault, defaultValue?, tagValues?}`.
    Methods list `self` first (`SuggestionBuilderTest`).

- **What the catalogue cannot give.** `SuggestionBuilder.buildTypeSignature`
  drops a signature's `! Errors` part
  (`case tpeError: Type.Error => buildTypeSignature(tpeError.typed)`), so
  `Table.filter`'s `returnType` has no `! No_Such_Column | …`, which
  help.enso.org showed. `defaultValue` is the engine's rendering of the default
  (`buildDefaultValue`), not the source text; for a call it puts the arguments
  before the function name, so it may differ from what help.enso.org showed
  (open question 4).
- **The doc-comment parser.** The help panel's data comes from
  `documentationData` in
  `app/gui/src/providers/openedProjects/suggestionDatabase/documentation.ts`:
  `prerenderMarkdown` (`app/ydoc-shared/src/ast/documentation.ts`) joins
  hard-wrapped lines; `ensoMarkdownParser`
  (`app/ydoc-shared/src/ast/ensoMarkdown.ts`, a Lezer Markdown dialect with
  tables, strikethrough and YAML front matter) parses it; `extractMetadata` and
  the zod schema in
  `app/gui/src/project-view/components/ComponentHelp/metadata.ts` read the front
  matter (`icon`, `group`, `aliases`, `macros`, `private`, `unstable`,
  `advanced`, `deprecated`, `suggested`, `added`, `modified`, `removed`,
  `upcoming`); `getDocumentationSummary` takes the first sentence. The panel
  itself renders the Markdown in a CodeMirror view (`MarkdownEditor`), which is
  browser-only, so the site reuses the parser, not the renderer.
- **Can it run in Node?** By reading the imports, not by running it:
  - `ensoMarkdown.ts` imports only `@lezer/markdown` (the workspace fork).
  - `metadata.ts` imports `yaml`, `zod`, Lezer types and `@/util/assert` (a
    re-export of `ydoc-shared/util/assert`).
  - `documentation.ts` imports `GroupInfo` and `DeepReadonly` as types only, and
    `isIconName` from the generated `iconName.ts` (written by `generate-icons`,
    which the root `postinstall` runs).
  - **But** `prerenderMarkdown` lives in `ydoc-shared/src/ast/documentation.ts`,
    which also imports `./ffi` (the `rust-ffi` WASM parser and `hash-wasm`) and
    `./token` (the generated AST). Importing it needs the WASM parser built and
    `generate-ast` run, both of which need Cargo. `prerenderMarkdown` itself
    uses only `ensoStandardMarkdownParser`.
  - The GUI's modules use the Vite aliases `@` (`src/project-view`), `$` (`src`)
    and `#` (`src/dashboard`) from `app/gui/vite.config.ts`.
  - The GUI's unit tests run under `jsdom`, so nothing proves today that these
    modules load without a DOM. `ydoc-shared`'s tests run in Node.
- **Group colours.** Component groups are declared in `package.yaml`
  (`component-groups: new:` and `extends:`,
  `lib/scala/pkg/.../ComponentGroup.scala`); today only `Standard.Base` declares
  any, each with an `oklch()` colour (`Input`, `File`, `Selections`, …,
  `Errors`). A doc comment names its group in the front matter
  (`group: Standard.Base.Selections`, or a bare name resolved against the
  entry's own library: `getGroupIndex`). The GUI sets one CSS variable per
  group, named by `groupColorVar` (`--group-color-<library>-<group>` with
  non-word characters as `-`, in
  `app/gui/src/project-view/composables/nodeColors.ts`), to
  `group.color ?? colorFromString(group.name)` (inline in
  `app/gui/src/components/WithCurrentProject.vue`), with
  `--group-color-fallback` (`#006b8a`,
  `app/gui/src/project-view/assets/base.css`) for none. A node with no group is
  coloured from its value's type (`computeNodeColor`:
  `colorFromString(typeName.key())`, an `oklch(0.464 0.14 h)` hue from a
  murmurhash of the name, `app/gui/src/project-view/util/colors.ts`).
- **Icons.** The one icon set is the sprite
  `app/gui/src/project-view/assets/icons.svg` (197 `<symbol>`s, drawn in
  `currentColor`); `generate-icons` mirrors its ids into `iconName.ts`. A
  component's icon is `suggestionEntryToIcon`
  (`app/gui/src/project-view/util/getIconName.ts`): the doc's `icon:` if it is a
  known name, `collection` for a module, otherwise `DEFAULT_ICON` (`enso_logo`).
  That file also imports Vue and the computed-value registry, so the rule needs
  lifting out before Node can import it.
- **The old URL scheme.** `suggestionDocumentationUrl` in
  `app/gui/src/providers/openedProjects/suggestionDatabase/entry.ts:211-227`
  (removed by #566) built
  `https://help.enso.org/docs/api/<library>/<module path segments>/<rest>`,
  where `<rest>` is the definition path with the module path removed, so
  `Table.filter` in `Standard.Table.Table` is
  `…/Standard.Table/Table/Table.filter`. It returned nothing for constructors,
  types and modules, and for libraries outside `Standard`.
- **CI.** `engine-checks-platform.yml`'s `build-engine-distribution` job runs
  `sbt "clean; all ciBuildEngineDistribution"` and uploads `built-distribution`
  and `test` as one tar, artifact
  `Engine Distribution (GraalVM CE) (native,test) (linux, amd64)` (and the
  Windows one). The engine checks run on every `develop` push, and on a pull
  request whenever `engine-changed-files.yml` matches, which includes
  `distribution/**`. `ide-packaging.yml`'s `find-backend` job already finds the
  newest `develop` run whose commit is an ancestor of the commit being built and
  downloads its artifacts (`actions: read`, `run-id`, `github-token`).
- **GitHub Pages is not enabled** on the repository (the Pages API answers 404)
  and there is no `github-pages` environment.
- **No React in the workspace.** The IDE's UI is Vue throughout since #75;
  `pnpm-lock.yaml` has no `react`. Docusaurus brings React back, inside
  `docs-site/` only (open question 2).

## 1. Content

### Guides

Hand-written Markdown in `docs-site/docs/`, one page each. The first set:

| Page                      | Covers                                                                                                   | Source of truth                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `intro`                   | What Enso is, what the site holds, where the developer docs are (the wiki).                              | —                                                                                           |
| `getting-started`         | Create a project, add components, connect them, read a result; the component browser and the help panel. | the IDE                                                                                     |
| `installing-and-updating` | The installer on each platform, where things go, how updates are offered and applied.                    | `2026-10-18-standard-installer-and-updates-design.md`                                       |
| `local-versioning`        | Saving versions of a project locally, labels, restoring; closes #240.                                    | `2026-10-16-local-git-versioning-design.md`, `2026-10-11-local-labels-and-recent-design.md` |
| `secrets`                 | Creating, using and removing local secrets; what is stored where.                                        | `2026-10-18-local-secrets-design.md`                                                        |
| `engine-logs`             | The engine logs panel: opening, docking, filtering, what to send with a bug report.                      | `2026-10-20-engine-logs-panel-design.md`                                                    |
| `samples`                 | The bundled sample projects and how to open one.                                                         | the IDE                                                                                     |

Screenshots are taken from a local installer build, light theme, and stored next
to the page. Each guide is written for someone using the IDE, not for a
developer of it.

### Components (the API reference)

Generated into `docs-site/docs/api/` (git-ignored) from every catalogue in the
distribution the build is given. Pages:

- **Components intro** (`/docs/api/`, hand-written, as help.enso.org's
  `api/intro`): what the reference covers, that the IDE's help panel shows the
  same text, and a list of libraries.
- **Library page:** the library's `Main` module documentation and its modules.
- **Module page:** the module's documentation, its types, and its module-level
  functions (each as a node with its summary).
- **Type page:** the type's documentation, its parent type, its constructors,
  static and instance methods (each as a node with its summary, linking to its
  page), its conversions, and the extension methods other libraries define on
  it, grouped by library.
- **Function page:** one per method and per constructor (section 2).

Conversions get no page: they are listed on the target type's page as "from
`Text`", "from `Integer`", …, with their documentation, since every conversion
is named `from` and none is a component. Getters are methods in the catalogue
and get method pages, as the component browser shows them.

## 2. Page design

### The component node

At the top of every function page, under the `h1`, and smaller in every list of
functions, the function drawn as a graph-editor node, as help.enso.org did:

```html
<div
  class="ComponentNode"
  style="--node-color: var(--group-color-Standard-Base-Selections)"
>
  <svg class="icon" aria-hidden="true">
    <use href="/enso/img/icons.svg#preparation" />
  </svg>
  <button class="name" aria-describedby="t-ret">filter</button>
  <span role="tooltip" id="t-ret">Returns Table &amp; Any</span>
  <button class="param optional" aria-describedby="t-1">column</button>
  <span role="tooltip" id="t-1"
    >Column | Expression | Text | Integer = Missing_Argument.throw
    "column"</span
  >
  …
</div>
```

- **Shape:** help.enso.org's CSS, kept: a 32 px pill with 16 px radius, the icon
  24 px with a 4 px margin, the name in weight 600, each parameter after a 2 px
  `#0003` divider in `#fffc`, weight 400. White text on the group colour. The
  node is a React component, `docs-site/src/components/ComponentNode.tsx`, used
  from the generated MDX.
- **Colour:** exactly the graph editor's rule, through the GUI's own code:
  - The entry's group (`documentationData` → `groupIndex`, against the groups of
    every library's `package.yaml`) gives `var(<groupColorVar(group)>)`.
  - The generator writes `docs-site/src/css/groups.generated.css` with one
    variable per group, named by `groupColorVar` and set by the same function
    `WithCurrentProject.vue` uses (lifted into `nodeColors.ts` as
    `groupColor(group)`, section 4), plus `--group-color-fallback`.
  - With no group, the graph editor colours a node by the type of its value,
    which a static page cannot know. The site uses the declared return type
    instead (`colorFromString` of its `ProjectPath` key, as `computeNodeColor`
    does), and `--group-color-fallback` when the return type is `Any` or a union
    (open question 11).
  - The node keeps these colours in dark mode, as the graph editor's nodes do.
- **Icon:** `suggestionEntryToIcon`'s rule (doc `icon:` if it is in `icons.svg`,
  else `enso_logo`), lifted out of `getIconName.ts` (section 4). The generator
  copies `app/gui/src/project-view/assets/icons.svg` into
  `docs-site/static/img/icons.svg` (git-ignored) at every run, so the site
  always ships the IDE's current sprite, and the node draws
  `<use href="<baseUrl>img/icons.svg#<icon>">`. An unknown icon name is counted
  and reported by the generator, as the GUI warns in development.
- **Name:** the method's name for instance methods (`filter`), `Type.name` for
  static methods and constructors (`Table.new`, `Filter_Condition.Equal`), as
  the component browser labels them.
- **Parameters:** every argument but `self`, in order. Optional ones (a default
  that is not `Missing_Argument.…`, the GUI's `isRequiredArgument`) are italic,
  as help.enso.org's `parameter default` class was. A suspended argument
  (`isSuspended`) is shown with a leading `~` in its tooltip.
- **Tooltips:** on the name, `Returns <return type>`; on a parameter, `<type>`
  or `<type> = <default>`. Type names are shown unqualified
  (`Column | Expression | Text | Integer`), as the graph editor shows them; the
  qualified, linked forms are in the Arguments section. The return type has no
  error list (the catalogue does not carry it; open question 3); the Errors
  section has them.
- **Keyboard and touch:** each pill is a `<button>` with `aria-describedby`
  pointing at a `role="tooltip"` element. The tooltip shows on hover, on focus,
  and on tap (a tap toggles it; tapping elsewhere closes it), stays while the
  pointer is over it, and closes on Escape (WCAG 1.4.13). Without JavaScript,
  CSS `:hover` and `:focus-visible` still show it. Its text is plain (no links),
  so it stays a tooltip in the ARIA sense. The whole node has an `aria-label`
  with the full signature, so a screen reader hears it in one go.

### Function page sections

URL and breadcrumbs first (Library › Module › Type › function), then, as on
help.enso.org:

1. **`h1`** `Table.filter`, then the node.
2. **Badges** where the front matter says so: Deprecated, Unstable, Advanced,
   and "Added in …" / "Modified in …" / "Removed in …" from `added`, `modified`,
   `removed`.
3. **Group / Aliases line:** "**Group**: Selections / **Aliases**:
   `filter rows`, `where`". The group's display name is its last segment; the
   aliases are `aliasesAndMacros` (aliases and macro names, sorted), as the
   component browser matches them. Either half is left out when empty.
4. **Documentation:** the doc comment up to its first `##` heading: the summary
   and body, including any argument-like bullets the author put there.
5. **Arguments:** a table built from the catalogue: name, type (each named type
   linked to its page), default, and the description from the doc's
   `## Arguments` bullet that starts with that argument's name in a code span
   (in `Table.filter`, the bullet that opens with `column` in double backticks).
   The allowed values (`tagValues`) are listed when the catalogue has them. If
   the doc has bullets that match no argument, they follow the table unchanged,
   so nothing the author wrote is lost.
6. **Returns:** the return type (linked) and the doc's `## Returns` section.
7. **Examples:** the doc's `## Examples` section as written: each `###` title,
   its code block, then the text and the result table the author wrote ("Returns
   a Table" and a Markdown table, e.g. `Table.enso`'s `filter`). Nothing is
   executed. Code blocks are labelled `enso`; there is no Enso grammar for Prism
   yet, so they are unhighlighted (a follow-up).
8. **Errors:** the doc's `## Errors` section.
9. **Remarks:** the doc's `## Remarks` section with its `###` sub-headings.

Any other `##` section in a doc comment is rendered after Remarks under its own
heading, so the page never drops text. A section the doc does not have is left
out. The `h2`s are what Docusaurus's table of contents lists.

The sections are found on the Lezer tree of `ensoMarkdownParser` (the same
`ATXHeading2` nodes the help panel sees), not by regular expressions on the
text. The text is emitted as MDX, so the generator escapes the characters MDX
gives meaning to (`{`, `}`, `<`, `>`) in text nodes, leaving code spans and code
blocks alone. The CI run on a real distribution compiles every page, so a doc
comment that defeats the escaping fails the build rather than the deploy.

### URLs

One page per function, following help.enso.org and the IDE's old
`suggestionDocumentationUrl`, under `/enso/docs/api/`:

| Page                  | Path                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| Components intro      | `/enso/docs/api/`                                                                 |
| Library               | `/enso/docs/api/Standard.Table/`                                                  |
| Module                | `/enso/docs/api/Standard.Table/Table/`                                            |
| Type                  | `/enso/docs/api/Standard.Table/Table/Table/`                                      |
| Method                | `/enso/docs/api/Standard.Table/Table/Table.filter/`                               |
| Constructor           | `/enso/docs/api/Standard.Base/Data/Filter_Condition/Filter_Condition.Equal/`      |
| Module-level function | `/enso/docs/api/Standard.Base/Data/read/`                                         |
| Extension method      | `/enso/docs/api/Standard.Table/Extensions/Table_Conversions/Text.parse_to_table/` |
| Guide                 | `/enso/docs/local-versioning/`                                                    |

The rule (one function, `apiPath(entry)`, section 4): the defining library, then
the defining module's path within it, one segment per name, then the member as
`<self type's simple name>.<name>`, or the bare name for a module's own
function. An extension method lives under the module that defines it, not under
its self type, matching the old function for every case it handled.

- **Trailing slash:** `trailingSlash: true`, so each page is
  `<path>/index.html`. A segment like `Table.filter` then never looks like a
  file extension to GitHub Pages, and `…/Table.filter` (no slash, as the old IDE
  links were) redirects to it. To be checked on the first deploy (open question
  8).
- **Operators:** a method whose name is not an identifier (`+`, `==`, `<`, …)
  gets `op-` and the name's UTF-8 bytes in hex (`Integer.op-2b`), since `*`,
  `<`, `>` and `|` are not allowed in Windows file names. The page's title keeps
  the real name.
- **Collisions:** the generator fails when two entries map to one path, or to
  paths that differ only in case (a constructor `Value` and a method `value`
  would collide on Windows and macOS file systems). If the first real run finds
  any, the rule is extended then (open question 9).

### Sidebars and navigation

- **Top bar:** Guides, Components, Developer (a link to the wiki), the search
  box, and the dark-mode toggle. Later, the version picker (section 6).
- **Guides sidebar:** hand-written (`docs-site/sidebars.ts`).
- **Components sidebar:** generated, one per library, so a page carries only its
  own library's tree: modules, then types (collapsed) with their constructors
  and methods. The Components intro has a sidebar of the libraries.

### Search

A local search plugin that builds its index at build time and loads it in the
browser on first use; no external service. The candidate is
`@easyops-cn/docusaurus-search-local` (supports versioned docs and a base URL);
PR 1 confirms it, measures the index size on the full reference, and pins it
exactly. The function pages put their aliases in the visible Group/Aliases line
and in `keywords`, so searching "where" finds `Table.filter`, as the component
browser does.

### Dark mode

Docusaurus's colour modes, following the system by default. The site's own
colours are CSS variables defined for both modes; the nodes keep the graph
editor's colours in both (white on a mid-lightness colour, readable on either
background). The axe run (section 8) covers both modes.

## 3. The generator

`docs-site/generator/`, TypeScript, run before `docusaurus build`.

**Inputs:**

- A distribution's library root (`built-distribution/enso-engine-*/enso-*/lib`),
  or a list of library directories. For each, `catalogue.json` and
  `package.yaml`. A library without a catalogue is skipped and listed in the
  run's report. Later, spec 3's library zips carry a catalogue each; they are
  just more library directories.
- The GUI's icon sprite and the parser modules (below), from the workspace.

**Steps:**

1. Read every catalogue (`format` must be 1; anything else fails the run with
   the library's name). Read every `package.yaml`'s `component-groups` into
   `GroupInfo`s (`{project, name, color}`), as the language server gives them to
   the GUI.
2. For each entry, `documentationData(documentation, library, groups)`: the
   prerendered Markdown, summary, icon, group, aliases and macros, and the
   flags. This is the GUI's function, so the site shows what the help panel
   shows.
3. Classify: module; type; constructor; conversion (`SuggestionJson`'s rule);
   module function (`selfType` is the module); static or instance method;
   extension method (`selfType` is a type of another module, often another
   library).
4. Build the index of types: every type's qualified name (`module.name`) to its
   page. A `reexport` creates no page; a type reexported from its library's
   `Main` gets "Exported from `Standard.Table`" on its page.
5. Write the pages (MDX with front matter: `id`, `slug`, `title`,
   `sidebar_label`, `description` = the summary, `keywords` = the aliases), the
   sidebars, `groups.generated.css`, and copy `icons.svg`.
6. Report: counts by kind and library; entries without documentation; unknown
   icons; type names that resolved to no page.

**Linking between types.** Every type name the catalogue gives qualified
(`reprType`, `returnType`, `selfType`, `parentType`, the parts of a union or an
intersection) links to its type page when the index has it; otherwise it is
shown unlinked (a type of a library not in the build, or `Any`). In prose, a
code span that is exactly a type's simple name, or `Type.member`, links when it
resolves to one page in the entry's own library or in `Standard.Base`; anything
ambiguous stays plain. Every link is a relative doc path, so Docusaurus's
broken-link check covers them.

**Parser reuse.** The generator imports the GUI's code; nothing is copied. PR 1
makes three small moves so that the imports load in Node without the WASM parser
or a DOM, and the GUI imports the moved code from the new place:

- `prerenderMarkdown` (and its helper) moves out of
  `ydoc-shared/src/ast/documentation.ts` into a module that imports only
  `ensoMarkdown.ts`; `documentation.ts` re-exports it, so its callers do not
  change.
- The icon rule of `suggestionEntryToIcon` and `DEFAULT_ICON` move into a module
  with no Vue or graph imports; `getIconName.ts` re-exports them.
- `WithCurrentProject.vue`'s `group.color ?? colorFromString(group.name)`
  becomes `groupColor(group)` in `nodeColors.ts`, and `groupColorVar`,
  `groupColor` and `isRequiredArgument` sit in modules the generator can load
  without the graph store (`nodeColors.ts` imports the graph types as types
  only; that is checked in PR 1, and the functions move if not).

The generator runs under `vite-node` (already used in `ydoc-shared`) with a
config that takes the `@`, `$` and `#` aliases from `app/gui/vite.config.ts` and
the `source` export condition, so it loads the TypeScript sources as the GUI's
tests do. Its first test is a Node (not `jsdom`) smoke test that imports every
module it uses and parses `Table.filter`'s doc comment, which is the proof the
reading above could not give. If a module still drags in browser or WASM code,
the fix is another move of the same kind, never a copy.

**The URL function.** `apiPath(entry)` lives in `app/common` (as
`src/docsSite/apiPath.ts`), so the generator and, in the follow-up, the IDE call
the same code; its tests carry over the cases the old
`suggestionDocumentationUrl` handled.

**Output:** `docs-site/docs/api/**`, `docs-site/src/css/groups.generated.css`,
`docs-site/static/img/icons.svg`, all git-ignored and listed in
`.prettierignore` (the hand-written `docs/api/index.md` excepted). Re-running
the generator replaces them; it never touches `docs/api/index.md`.

**Scale.** The standard libraries have thousands of methods (Base's suggestions
cache alone is 1.48 MB), so the reference is several thousand pages. PR 1
measures the build's time and memory on a 4-vCPU runner. If Docusaurus's default
bundler is too slow, the first lever is its Rspack option
(`future.experimental_faster`); the second is splitting the reference into one
docs instance per library (open question 7).

## 4. The package

```
docs-site/
  CLAUDE.md
  package.json            name "docs-site"; scripts below
  docusaurus.config.ts    url https://jdunkerley.github.io, baseUrl /enso/, trailingSlash true
  sidebars.ts             the guides; reads the generated API sidebars if present
  docs/                   guides (Markdown, committed)
  docs/api/               generated (git-ignored), except index.md (the intro)
  generator/              src/, fixtures/, tests
  src/components/         ComponentNode.tsx and its tooltip
  src/css/                custom.css; groups.generated.css (generated)
  static/img/             logo; icons.svg (generated)
```

One docs plugin instance holds the guides and the reference, so a release's
version snapshot (section 6) takes both together: version X's API pages with
version X's guides. (The approved design named the two folders `guides/` and
`api/`; they sit under `docs/` so that one instance holds both.)

**Scripts.** `generate` (the generator), `start` and `build` (Docusaurus),
`serve`, `typecheck`, `lint`, `test:unit`. The root's `ci:*` scripts run
`typecheck`, `lint` and `test:unit` in every workspace package, so those cover
`docs-site` once it is listed in `pnpm-workspace.yaml`. The package defines no
`compile` script, because the root's `pnpm -r compile` would otherwise try to
build the site without a distribution. For the same reason `typecheck` and
`test:unit` need no distribution: the tests use the fixtures, and `sidebars.ts`
reads the generated sidebars' JSON when it exists and uses an empty Components
sidebar when it does not.

**Dependencies.** Docusaurus 3 (current minor, pinned exactly), React as it
requires, the search plugin, and `ydoc-shared`, `enso-common` as `workspace:*`.
This adds React to `pnpm-lock.yaml` (open question 2). Node is the repository's
(`.node-version`).

## 5. Build and CI

Three routes, so that no job compiles the standard libraries just for the site.

**A. A pull request that changes doc comments** (`distribution/lib/**`): the
engine checks run anyway and build the distribution. A new reusable workflow,
`docs-site-build.yml` (`workflow_call`), is called from
`engine-checks-platform.yml` by a job that `needs: build-engine-distribution`
and runs only for Linux and GraalVM CE. It downloads that run's
`Engine Distribution (GraalVM CE) (native,test) (linux, amd64)` artifact (same
run, so no extra permission), extracts only the `lib` tree, installs the
workspace with `--ignore-scripts` and runs `generate-icons` (no Rust needed,
thanks to the moves in section 3), runs the generator and `docusaurus build`,
and uploads the built site as an artifact, `docs-site`.

**B. A pull request that changes only the site or the parser** (no engine
change): a new workflow, `docs-site.yml`, on `pull_request` with a `paths`
whitelist: `docs-site/**`, the parser and colour modules of section 3,
`app/gui/src/project-view/assets/icons.svg`, `app/common/src/docsSite/**`,
`pnpm-lock.yaml`, and its own workflow files. The whitelist leaves out
`docs/superpowers/**`, which `checkPullRequestsIgnoreSpecs` accepts. Its first
job finds the newest successful `develop` run of `engine-pull-request.yml` whose
commit is an ancestor of the PR's merge commit and that has the Linux
distribution artifact (the `find-backend` pattern of `ide-packaging.yml`;
`actions: read`); the second calls `docs-site-build.yml` with that `run-id`. A
pull request that changes both kinds of file runs both routes; the second is a
few minutes and harmless.

**C. Deploy from `develop`:** every `develop` push runs the engine checks, which
run route A. A new workflow, `docs-site-deploy.yml`, triggers on `workflow_run`
of "✨ Engine" (`types: [completed]`, `branches: [develop]`) and by hand. It
deploys when the triggering run's `docs-site` artifact exists (the site built,
even if an unrelated test failed): it downloads it from that run
(`actions: read`), re-uploads it with `actions/upload-pages-artifact` (the Pages
deploy reads the artifact of its own run), and runs `actions/deploy-pages`.
Permissions: `contents: read`, `actions: read`, `pages: write`,
`id-token: write`, only in this workflow; the engine workflow's permissions do
not change. Environment `github-pages`, restricted to `develop`;
`concurrency: pages` without cancelling a deploy in progress.

**The preview.** Each pull request's `docs-site` artifact is the preview: the
owner downloads it and runs `corepack pnpm --filter docs-site run serve` on it.
Pages has no per-PR previews.

**Policy** (`tools/ci/check-workflows.mjs`, `.github/CLAUDE.md`):

- every job has `timeout-minutes` (30 for the build, raised only if PR 1's
  measurement needs it);
- every workflow has a top-level `permissions:`;
- the `pull_request` trigger leaves out `docs/superpowers/**`;
- actions are pinned by major tag (`upload-pages-artifact`, `deploy-pages` at
  their current majors, at least two weeks old);
- no job runs `sbt`, so `setup-jvm` is not needed;
- `docs-site-build.yml` goes on the list in `engine-changed-files.yml`, as a
  workflow the engine checks use;
- the GUI gate (`gui-changed-files.yml`) gains `docs-site/**` in its first list,
  so the GUI checks' typecheck, lint and unit tests cover the package, and in
  the second list's `files_ignore`, so a site change does not package the IDE.

**One-time setup by the owner:** enable GitHub Pages with "GitHub Actions" as
the source, and restrict the `github-pages` environment to `develop` (open
question 1). The repository has no user or organisation Pages site with a custom
domain, so the project site is at `jdunkerley.github.io/enso/`.

## 6. Future versioning

Docusaurus versioning, set up so that no page's path changes when it starts:

- **Until the first release:** no versions. `develop`'s docs are at
  `/enso/docs/…`.
- **At the first release:** the release job runs
  `docusaurus docs:version <version>`, which snapshots `docs/` (guides and the
  reference generated from that release's distribution) into `versioned_docs/`.
  That version becomes `lastVersion` and is served at the unprefixed
  `/enso/docs/…`; `develop`'s docs (`current`, labelled "next") move to
  `/enso/docs/next/…`; older releases are at `/enso/docs/<version>/…`. A version
  picker appears in the top bar.
- **So:** every path after `/docs/` stays what it is; a link to
  `/enso/docs/api/Standard.Table/Table/Table.filter/` keeps working and shows
  the newest release. Only `develop`'s content gains the `/next/` prefix, which
  nobody outside the project needs to have bookmarked.
- **Where snapshots live:** `versioned_docs/` is committed by the release
  workflow to `develop` (the generated reference of each release included, a few
  MB each), so a deploy from `develop` rebuilds every version. Whether to keep
  all releases or the last few is decided at the first release.
- The IDE's links (section 7) take the version into account then (open question
  5).

## 7. IDE links (follow-up PR)

After #566 has merged and the site is live:

- **Base URL in the IDE's config:** `https://jdunkerley.github.io/enso/docs/`,
  overridable like the other URLs in `app/gui/src/config.ts`.
- **F1 / "Open documentation"** on a component, and the help panel's button,
  open `<base>/api/<apiPath(entry)>/` (the shared function), for entries of the
  libraries the site documents. Other entries (the user's own project) show no
  link.
- **"Documentation"** in the settings menu opens `<base>intro/`.
- `suggestionDocumentationUrl` returns, built on `apiPath`, with its old tests.
- This is a visible change: a changelog entry, and the owner's OK after an
  installer check.

## 8. Testing

- **Generator unit tests** (Vitest, Node environment) on small fixture
  catalogues in `docs-site/generator/fixtures/`, written by hand in the exact
  `SuggestionJson` shape: a module, a type with a parent, a constructor, static
  and instance methods, a getter, two conversions to one type, an extension
  method from another library, a reexport, an operator, a module function, an
  entry with no documentation, a doc with every section and front-matter field,
  an unknown icon, an ungrouped entry. Assertions: paths, classification,
  sections, the Arguments table, links, colours, icons; the path-collision and
  case-collision failures; a catalogue of another `format` fails.
- **A golden page:** `Table.filter`'s real doc comment and arguments as a
  fixture; the generated MDX is compared with a checked-in expectation, and the
  owner compares the rendered page with the IDE's help panel during the preview
  review.
- **Parity with the IDE:** the generated `groups.generated.css` values equal
  `Standard.Base`'s `package.yaml` colours; every icon the generator emits is a
  symbol of `icons.svg`; `apiPath` passes the old `suggestionDocumentationUrl`
  cases. These follow from importing the GUI's code; the tests stop a later move
  from breaking it silently.
- **The Node smoke test** of section 3.
- **The real build** (CI routes A and B): the full distribution, with
  `onBrokenLinks`, `onBrokenAnchors` and `onBrokenMarkdownLinks` set to `throw`,
  and a floor on the number of function pages, so an empty catalogue cannot
  deploy an empty reference.
- **Accessibility:** a Playwright check on the built site (the same pinned
  `@axe-core/playwright` as the GUI) of a function page, a type page and a
  guide, in light and dark mode, with no violations; and a keyboard test: Tab
  reaches each pill, focus shows its tooltip, Escape hides it; a tap shows it on
  a touch viewport.
- **Linux:** run the generator and the build in WSL once before PR 1 merges
  (root `CLAUDE.md`, "Verify on Linux"); paths with dots and case are where the
  two hosts differ.

## 9. Delivery

Three PRs after the plan:

1. **Generator and skeleton:** `docs-site/` with Docusaurus, the node component,
   the generator and its tests, the three moves of section 3, `apiPath` in
   `app/common`, the Components intro, a placeholder guides intro, the GUI gate
   change, `docs-site/CLAUDE.md`, and `docs-site/` in the root `CLAUDE.md`'s
   layout and a pointer in `docs/CLAUDE.md`. Nothing is published, so
   `CI: No changelog needed`. **Needs the owner's preview review** (a local
   build on a full distribution, shared as screenshots and the built site): the
   node's look against the graph editor, the page sections, the URLs.
2. **Guides:** the pages of section 1, with screenshots.
   `CI: No changelog needed` (not yet published). **Needs the owner's review of
   the text.** Closes #240.
3. **CI and deploy:** `docs-site-build.yml`, `docs-site.yml`,
   `docs-site-deploy.yml`, the `engine-changed-files.yml` entry, the axe and
   keyboard tests in CI, and the changelog entry (`#### Enso IDE`: the user
   documentation site). **Merges after the owner's OK on the preview artifact**,
   and after the one-time Pages setup; the first deploy follows on `develop`.
   Afterwards, the first `develop` run's deploy log is checked (a `develop`-only
   step cannot be proven on the PR).

Then the IDE links PR (section 7), and versioning at the first release (section
6).

## Out of scope

- Developer documentation: it stays in the wiki. The site's top bar links to it.
- Copying anything from upstream help.enso.org: content, styles or code. Its
  page structure and node design are re-implemented from the owner's
  description.
- Running examples: result tables are the author's text.
- Error lists in return types (needs an engine change and a catalogue format
  bump; open question 3).
- Syntax highlighting for Enso code blocks.
- Per-PR hosted previews, a custom domain, analytics.
- Documentation of the user's own projects' functions.
- Libraries fetched from a release index (library spec 3); the generator takes
  their catalogues once they exist.

## Open questions

1. **Pages setup (owner):** enable GitHub Pages with the "GitHub Actions" source
   and restrict the `github-pages` environment to `develop`; neither exists
   today.
2. **React in the lockfile (owner):** Docusaurus brings React into
   `pnpm-lock.yaml` for the first time since #75, confined to `docs-site/`.
   VitePress (Vue) would avoid that but has no equivalent of Docusaurus's
   versioning, which decision 2 relies on. Proceed with Docusaurus?
3. **Errors in the return-type tooltip (owner):** the catalogue's `returnType`
   has no `! Errors` (`SuggestionBuilder.buildTypeSignature` drops
   `Type.Error`), so the name's tooltip shows `Returns Table & Any`, not
   help.enso.org's `… ! No_Such_Column | …`. Adding them is an engine change and
   catalogue format 2; is the Errors section enough for now?
4. **Default values as the engine renders them:** `defaultValue` comes from
   `SuggestionBuilder.buildDefaultValue`, which for a call puts the arguments
   before the function name; check against the first real catalogue whether
   tooltips read well (`Missing_Argument.throw "column"`) or the engine's
   rendering needs fixing.
5. **Which docs a release IDE opens (owner, at versioning):** the newest
   release's (`/docs/…`) or its own version's (`/docs/<version>/…`, which needs
   an alias for the newest version, e.g. client redirects).
6. **Search plugin:** `@easyops-cn/docusaurus-search-local` is third-party;
   confirm it, and that its index for several thousand pages is an acceptable
   first-search download (measured in PR 1).
7. **Build scale:** time and memory of a Docusaurus build of several thousand
   pages on a 4-vCPU runner, unmeasured; Rspack or per-library instances are the
   fallbacks.
8. **Dotted path segments on GitHub Pages:** `trailingSlash: true` should make
   `Table.filter/` safe and redirect the slashless form; confirm on the first
   deploy.
9. **Path collisions:** whether any library has members whose paths differ only
   in case, or a submodule and a type of one name in one module; the generator
   reports them on its first real run, and the rule is extended then.
10. **The doc comments' result tables:** they are indented more deeply than the
    surrounding text in the source (`Table.enso`'s `filter`); confirm on the
    real catalogue that `prerenderMarkdown` and the parser read them as tables,
    not code blocks, as the help panel shows them.
11. **Colour of an ungrouped component:** the graph editor colours it by its
    computed value's type, which a static page cannot know; the site uses the
    declared return type, and the fallback colour for `Any` or a union. Good
    enough?
12. **docs/CLAUDE.md:** the decisions note says it still names help.enso.org as
    the user docs, but on `develop` (`eeef85f221`) it names no user docs at all;
    PR 1 adds a pointer to `docs-site/` instead of a correction.
