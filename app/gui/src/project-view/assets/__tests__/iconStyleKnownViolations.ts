// Icons in `icons.svg` that break a rule of `docs/style-guide/icons.md` today. Checked by
// `iconStyle.test.ts`: remove an id once it is fixed (the test fails until you do), and never add one.
// The lists are the icon cleanup backlog of epic #95.

export type StyleRule =
  | 'canvas'
  | 'colour'
  | 'strokeWidth'
  | 'strokeEnds'
  | 'secondaryTone'
  | 'structure'
  | 'coordinates'
  | 'naming'

export const KNOWN_VIOLATIONS: Record<StyleRule, readonly string[]> = {
  // viewBox 0 0 16 16, width and height 16 (0)
  canvas: [],
  // currentColor only; `*_color` brand marks are exempt (0)
  colour: [],
  // stroke width 2 (1.5 only for a detail inside a filled icon) (0)
  strokeWidth: [],
  // round caps and round joins on every stroke (0)
  strokeEnds: [],
  // one secondary tone, opacity 0.3 (0)
  secondaryTone: [],
  // no transform, clip-path, mask, defs, gradient or inner ids (0)
  structure: [],
  // at most 2 decimals (0)
  coordinates: [],
  // snake_case, no iteration numbers, no paths (10)
  naming: [
    '3_dot_menu',
    'bullet-list',
    'home2',
    'icon/lock',
    'local_scope2',
    'local_scope4',
    'numbered-list',
    'parse3',
    'path2',
    'text3',
  ],
}
