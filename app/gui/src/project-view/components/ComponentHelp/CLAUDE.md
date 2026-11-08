# ComponentHelp

The component help: the right panel's Help tab (`../ComponentHelpPanel.vue`
hosts `../ComponentHelp.vue`), showing the documentation of the selected
component, or of the entry highlighted in the component browser. F1
(`graph.openDocumentation`) and the toolbar's help button open it
(`../GraphEditor/helpActions.ts`).

- `ir.ts` — the documentation of an entry, with its types, constructors and
  methods; `history.ts` — the panel's back/forward stack.
- `DocsBreadcrumbs.vue`, `DocsHeader.vue`, `DocsList.vue` — the top bar's path
  and the lists below the text.
- `DocsSignature.vue` / `signature.ts` — a function's signature drawn as the
  docs site draws it (`docs-site/src/components/ComponentNode.tsx`): name and
  arguments on the group colour, optional ones in italics, types in tooltips.
- `DocsSiteLink.vue` — "View on docs site ↗", only for entries with a page
  (`suggestionDocumentationUrl`: the `Standard.*` libraries; not the user's code
  or conversions).
- `resultTables.ts` — doc comments indent their examples' result tables, which
  CommonMark reads as code; the panel dedents an indented block of `|` rows into
  a GFM table, by the docs site generator's rule
  (`docs-site/generator/src/mdx.ts`).
- `metadata.ts` — the doc comments' front matter (also used by the docs site's
  generator).

The text itself is a read-only `MarkdownEditor`; its look (the docs site's) is
in `../MarkdownEditor/`, from the `--docs-*` tokens in `assets/base.css`.
