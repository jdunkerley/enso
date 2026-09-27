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
- `icon-*.svg`, `icons/` — standalone images imported directly by components,
  not part of the sprite.
