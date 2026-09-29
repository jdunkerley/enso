# Project view assets

Stylesheets, fonts and icons for the project view (the graph editor).

- `icons.svg` — the icon sprite: one `<symbol id="...">` per icon, used through
  `SvgIcon` / `svgUseHref` and by standard library `icon:` doc tags. **Draw new
  icons to `docs/style-guide/icons.md`.**
- `__tests__/iconStyle.test.ts` — checks every symbol against the guide's
  mechanical rules. `iconStyleKnownViolations.ts` lists the icons that broke a
  rule when the check was added: remove an id when you fix it (the test fails
  until you do) and never add one.
- `scripts/generateIconMetadata.mjs` (in `app/gui`) turns the sprite into the
  gitignored `util/iconMetadata/iconName.ts`. Rerun it after any change to
  `icons.svg`: `corepack pnpm --filter enso-gui run generate-icons`. It fails on
  a duplicate id; `util/iconMetadata/__tests__/stdlibIconTags.test.ts` checks
  that every standard library `icon:` tag names a real icon.
- `base.css` — design tokens (`--font-sans`, `--font-code`, `--font-mono`,
  colours) and the `@font-face` imports from the `font-*.css` files.
- `font-*.css` — one `@font-face` file per family; the font files and their
  licence notices live in `public/font-*/`. Give every `src` a `format()` and
  every face a `font-display` (`block` for M PLUS 1, which drives text
  measurement and is preloaded from `index.html`). A renamed or added font
  directory must also be listed in `build_tools/build/paths.yaml`.
- `font-monaspace.css` / `public/font-monaspace/` — Monaspace Neon and Radon
  (variable woff2, v1.400, unmodified upstream files; see the README there).
  `--font-mono` is Neon under the `enableMonaspaceCodeFont` feature flag, which
  is on by default and kept for one release as a kill switch (the
  `:root.monaspaceCodeFont` block in `base.css`; the class comes from
  `src/providers/codeFont.ts`). Neon is preloaded from `index.html`. #113
  removes the flag and DejaVu Sans Mono.
- `--font-code` is node text (expressions, bindings, component browser entries,
  the AI pending node): M PLUS 1, or Monaspace Neon under the `monoNodes`
  feature flag (on by default, kept for one release as a kill switch;
  `:root.monoNodes` in `base.css`, class from `src/providers/codeFont.ts`). #113
  removes it along with `enableMonaspaceCodeFont`. Nodes are ~14% wider than in
  M PLUS 1; widths are measured per session, never saved.
- `--font-mono-comment` is the code editor's comment face: `--font-mono`, or
  Monaspace Radon under the flag plus the "Handwritten comments" setting
  (`:root.monaspaceCodeFont.handwrittenComments`; both on by default). Radon is
  not preloaded: `src/providers/codeFont.ts` loads it only while both are on.
  Comment tokens carry the stable class `tok-comment`
  (`util/codemirror/highlight.ts`) besides their CSS-module colour class. Radon
  shares Neon's 0.62em advance; never pair it with a face that does not, or
  comments leave the column grid.
- Ligatures on `--font-mono` text go through `--font-mono-variant-ligatures` /
  `--font-mono-feature-settings` (the code editor, and anything editable) and
  their `-readonly` variants (docs code, tables, visualizations), which the
  "Code ligatures" setting (`:root.codeLigatures`) switches. A new `--font-mono`
  consumer should set one pair; Monaspace's coding ligatures must stay off
  wherever there is a caret.
- `icon-*.svg`, `icons/` — standalone images imported directly by components,
  not part of the sprite.
