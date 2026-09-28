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
  // viewBox 0 0 16 16, width and height 16 (1)
  canvas: ['expanded_node'],
  // currentColor only; `*_color` brand marks are exempt (0)
  colour: [],
  // stroke width 2 (1.5 only for a detail inside a filled icon) (8)
  strokeWidth: [
    'document',
    'help',
    'info',
    'join2-1',
    'properties',
    'schedule',
    'sessions',
    'versions',
  ],
  // round caps and round joins on every stroke (0)
  strokeEnds: [],
  // one secondary tone, opacity 0.3 (11)
  secondaryTone: [
    'array_new',
    'compass',
    'docs',
    'expanded_node',
    'find',
    'heatmap',
    'join',
    'join2-1',
    'root',
    'union',
    'workflow_play',
  ],
  // no transform, clip-path, mask, defs, gradient or inner ids (0)
  structure: [],
  // at most 2 decimals (0)
  coordinates: [],
  // snake_case, no iteration numbers, no paths (16)
  naming: [
    '3_dot_menu',
    'array_new2',
    'bullet-list',
    'copy2',
    'home2',
    'icon/lock',
    'join2-1',
    'local_scope2',
    'local_scope4',
    'numbered-list',
    'parse3',
    'path2',
    'text2',
    'text3',
    'time2',
    'transform4',
  ],
}
