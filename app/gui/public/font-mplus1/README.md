# M PLUS 1

- **Source:** https://github.com/coz-m/MPLUS_FONTS (variable font build
  `MPLUS1[wght].ttf`, `wght` axis 100-900 per its `fvar` table)
- **Version:** 1.001 (from the `name` table, ID 5)
- **Copyright:** Copyright 2021 The M+ FONTS Project Authors
  (https://github.com/coz-m/MPLUS_FONTS)
- **Designer:** Coji Morishita / UNDERFOREST DESIGN
- **Licence:** SIL Open Font License, Version 1.1. Full text in
  [`OFL.txt`](./OFL.txt), copied from
  https://github.com/coz-m/MPLUS_FONTS/blob/master/OFL.txt.
- **File:** `MPLUS1-Variable.woff2`.

## Modification

`MPLUS1-Variable.woff2` is an unmodified format conversion (TTF to WOFF2) of the
upstream `MPLUS1[wght].ttf`, version 1.001, made with fontTools
(`TTFont(src, recalcTimestamp=False)`, `flavor = "woff2"`, `save`). There is no
subsetting: the glyph set (6,650 glyphs), the character map (6,335 code points),
the `wght` axis (100-900) and its 9 named instances are unchanged, and every
table other than `head` is byte-identical once decompressed. `head` differs only
in the checksum and in flag bit 11, which the WOFF2 specification requires to be
set on converted fonts; the empty `DSIG` stub (no signatures) is dropped, as
WOFF2 conversion invalidates font signatures. The file was renamed without the
brackets. The font is still distributed under the OFL, with the copyright notice
and licence text above.

OFL section 2 requires the copyright notice and licence text to accompany every
copy of the font. Vite copies this directory verbatim into `dist/`, so every
distributed build (Electron package and cloud build) carries it alongside the
`.woff2` file.
