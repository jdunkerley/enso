# MarkdownEditor

The CodeMirror Markdown editor behind the documentation editor and the component
help (read-only), shown as rendered text except on the line being edited.
`../MarkdownEditor.vue` loads `MarkdownEditorImpl.vue` lazily.

- `codemirror/` — the Enso Markdown extension: `decoration/` renders links,
  images, tables, lists, front matter and block lines; `formatting/` the
  toolbar's actions.
- `decoration/blocks.ts` — line classes for headings (`cm-heading`,
  `cm-headingN`), fenced code blocks (`cm-codeBlock`, `-first`, `-last`) and
  quotes (`cm-blockquote`), so that the stylesheet can space and box them.
- **The look is the docs site's** (Infima's type scale and inline code, Prism
  palenight code blocks), scaled to a side panel: `MarkdownEditorImpl.vue`'s
  styles use the `--docs-*` tokens in `assets/base.css`. Change the tokens, not
  the panel that hosts the editor. Dark mode is the page-wide invert filter
  (#105), so code block lines are inverted back to stay dark as on the site.
- `TableEditor.vue` nests editors in table cells.
