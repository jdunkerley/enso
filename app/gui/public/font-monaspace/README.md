# Monaspace

- **Source:** https://github.com/githubnext/monaspace, release
  [`v1.400`](https://github.com/githubnext/monaspace/releases/tag/v1.400)
  (published 2026-03-28), asset `monaspace-webfont-variable-v1.400.zip`
  (6,919,478 B; SHA-256
  `7e643a4c9f3994b8819308656c1c049af8c571666a74ed216764b9aae4908b40`, matching
  the digest published for that asset by the GitHub API).
- **Version:** 1.400 (from the `name` table, ID 5:
  `Version 1.400 (Monaspace Neon Var)` / `Version 1.400 (Monaspace Radon Var)`;
  `head.fontRevision` reads as `1.399993896484375`, the usual float rounding of
  a `Fixed` value and not a different version).
- **Copyright:** Copyright (c) 2023, GitHub
  (https://github.com/githubnext/monaspace) with Reserved Font Name "Monaspace",
  including subfamilies: "Argon", "Neon", "Xenon", "Radon", and "Krypton".
- **Licence:** SIL Open Font License, Version 1.1. Full text in
  [`OFL.txt`](./OFL.txt), fetched from
  https://raw.githubusercontent.com/githubnext/monaspace/v1.400/LICENSE (the
  release zip does not include a licence file; the repository's `LICENSE` at the
  `v1.400` tag is the same text referenced by the report).
- **Files:** `MonaspaceNeonVar.woff2` (renamed from `Monaspace Neon Var.woff2`,
  510,832 B, SHA-256
  `6569968f448ae856ab5b57dff1f13b109b220ca8e3f664169e135fcb5c4f0721`) and
  `MonaspaceRadonVar.woff2` (renamed from `Monaspace Radon Var.woff2`, 796,308
  B, SHA-256
  `6411b3c2b3e02e3913248184800d6c5a83bb1ccd1472daeb7bfee605c176cb33`).

## Modification

Both files are **unmodified upstream files**, copied byte-for-byte from the
release zip's `Variable Web Fonts/Monaspace Neon/` and `.../Monaspace Radon/`
directories — only the name changed (spaces removed) to match this repository's
other font directories. No subsetting, no recompression, no table changes.
`fontTools` confirms, for both files:

- `wght` axis: 200-800 (default 200)
- `wdth` axis: 100-125 (default 100)
- `slnt` axis: -11 to 0 (default 0)
- 42 named instances
- `unitsPerEm`: 2000

Glyph counts differ between the two families, as expected (Neon: 3,606 glyphs,
2,460 mapped code points; Radon: 3,552 glyphs, 2,460 mapped code points).

Because the files are unmodified and unsubset, the OFL Reserved Font Name clause
applies as shipped: **do not subset or otherwise modify these files without
renaming** per OFL section 5 (RFN). Shipping the full files also keeps the
non-Latin glyphs available that data values may use.

OFL section 2 requires the copyright notice and licence text to accompany every
copy of the font. Vite copies this directory verbatim into `dist/`, so every
distributed build (Electron package and cloud build) carries `OFL.txt` alongside
the `.woff2` files.

## Status

Added by #109. Monaspace Neon is `--font-mono` (the code editor, documentation
code, tables and visualizations; #110) and `--font-code` (node text; #112), and
is preloaded from `index.html`. It is the only bundled monospace face: the
fallbacks are system fonts (#113). Since #111, Monaspace Radon is the code
editor's comment face (the "Handwritten comments" setting, on by default). It is
not preloaded: `src/providers/codeFont.ts` loads it while the setting is on.

## Upgrading

Pin to a specific release tag, as above. The upstream README notes that ligature
handling changes in every point release, so an upgrade needs its own PR with
before/after screenshot checks, not a routine version bump.
