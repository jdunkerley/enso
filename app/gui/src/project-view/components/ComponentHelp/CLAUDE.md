# ComponentHelp

The component help: the right panel's Help tab (`../ComponentHelpPanel.vue`
hosts `../ComponentHelp.vue`), showing the documentation of the selected
component, or of the entry highlighted in the component browser. F1
(`graph.openDocumentation`) and the toolbar's help button open it
(`../GraphEditor/helpActions.ts`).

- `ir.ts` — the documentation of an entry, with its types, constructors and
  methods; `history.ts` — the panel's back/forward stack.
- `DocsBreadcrumbs.vue`, `DocsHeader.vue`, `DocsList.vue` — the top bar's path
  and the lists below the text. The entry's component group (its category) sits
  at the top bar's right, so the text's front-matter tags leave it out
  (`withoutFrontMatterIdeKeys` in `sections.ts`).
- `DocsSignature.vue` / `signature.ts` — a function's signature drawn as the
  docs site draws it (`docs-site/src/components/ComponentNode.tsx`), in a graph
  node's font (`--font-code`): name and arguments on the group colour, optional
  ones in italics, each argument a pill with its tooltip. A static method or
  constructor is named with its type (`Date.new`), as the component browser
  inserts it. Under the node, the return type sits on the left and ▸ details on
  the right; details expands to one row per argument plus the return type; the
  choice persists in local storage (`expanded.ts`, key
  `enso-help-arguments-expanded`; the panel is outside the settings provider's
  subtree, so it is not a user setting).
- `DocsParamPill.vue` — one argument's pill and tooltip: hover (including over
  the tooltip), focus, tap and Escape, ported from the docs site's `Pill`. Not
  `TooltipTrigger`, which has no keyboard-focus support.
- `expanded.ts` — `useHelpArgumentsExpanded`, the node's expanded state.
- `arguments.ts` — the arguments merged from the signature and the doc comment,
  and `unqualifiedType`. The widget kind is inferred statically: the engine
  builds `@` widgets at run time, so the panel cannot ask it.
- `sections.ts` — a doc comment's `##` sections, found on the Lezer tree. It is
  shared with the docs site's generator, which imports it through
  `docs-site/generator/src/gui.ts`. `panelText` drops a `## Arguments` the
  signature already shows and splits off `## Remarks` (a collapsed `<details>`).
- `examples.ts` — an example's Copy button turns its code into clipboard nodes.
  It is kept free of graph-editor value imports so the docs-site generator can
  import it (the planned style check).
- `DocsSiteLink.vue` — "View on docs site ↗", only for entries with a page
  (`suggestionDocumentationUrl`: the `Standard.*` libraries; not the user's code
  or conversions).
- `resultTables.ts` — doc comments indent their examples' result tables, which
  CommonMark reads as code; the panel dedents an indented block of `|` rows into
  a GFM table, by the docs site generator's rule
  (`docs-site/generator/src/mdx.ts`).
- `metadata.ts` — the doc comments' front matter (also used by the docs site's
  generator). The panel drops the `group` and `arguments` keys from the front
  matter it shows (`sections.ts`): `arguments:` is display configuration, not
  documentation.

The text itself is a read-only `MarkdownEditor`; its look (the docs site's) is
in `../MarkdownEditor/`, from the `--docs-*` tokens in `assets/base.css`.
