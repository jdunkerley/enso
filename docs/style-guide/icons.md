---
layout: style-guide
title: Icon Style Guide
category: style-guide
tags: [style-guide, icons, gui]
order: 7
---

# Icon Style Guide

The IDE draws its icons from one SVG sprite,
`app/gui/src/project-view/assets/icons.svg`: one `<symbol>` per icon, referenced
by id. This guide says how to draw an icon for it. It describes the set we are
converging on: the icons already in the sprite drifted into three drawing
styles, eleven stroke widths, sixteen opacity levels and two grids, and are
being brought into line under epic
[#95](https://github.com/jdunkerley/enso/issues/95).

The set is a **16px, mostly filled, two-tone** set, closer to GitHub Octicons
than to a line set like Lucide. That suits a dense data tool; the rules below
keep it consistent.

<!-- MarkdownTOC levels="2" autolink="true" -->

- [How the rules are enforced](#how-the-rules-are-enforced)
- [The rules](#the-rules)
- [Worked example: `tidy_up`](#worked-example-tidy_up)
- [Exporting from Figma](#exporting-from-figma)
- [Adding an icon](#adding-an-icon)

<!-- /MarkdownTOC -->

## How the rules are enforced

Rules that can be checked mechanically are checked by
`app/gui/src/project-view/assets/__tests__/iconStyle.test.ts`, which runs with
the GUI's unit tests. Icons that broke a rule when the check was introduced are
listed in `iconStyleKnownViolations.ts` next to it. The check fails when:

- an icon **not** on a rule's list breaks that rule, so a new icon must follow
  every rule; or
- an icon **on** a list no longer breaks the rule, so whoever fixes an icon
  removes it from the list and the lists only shrink.

Never add an id to those lists. If a new icon cannot follow a rule, the rule is
wrong: change this guide and the check together.

The rules marked _review_ below cannot be checked mechanically and are the
reviewer's job.

## The rules

Each rule notes how the set stood when this guide was written (September 2026,
266 icons); the check's lists hold the current offenders.

### Canvas

`viewBox="0 0 16 16"`, `width="16"`, `height="16"`, one `<symbol>` per icon.
Icons are rendered at 16px almost everywhere (`SvgIcon.vue`), so drawing at any
other size means every icon gets scaled.

_Today:_ all of them (`expanded_node`, the last 16x14 icon, was redrawn in
#103).

### Live area (_review_)

Keep shapes inside the **1–15 keyline** (1px padding). Standard shapes: a circle
of radius 6.5–7, a 12x12 square (2–14), a 14x10 wide rectangle. Only
deliberately "big" glyphs such as `add` and `minus` may run edge to edge, and
never one that shares a toolbar with keyline icons: a full-bleed `trash` beside
the keyline `align_left` reads about 25% larger.

_Today:_ 83 edge-to-edge icons were fitted to the keyline in #103. About 30
remain, left for later: brand marks, thin-line drawings awaiting the weight
fixes, and the component browser's category icons, which need redrawing as a
family.

### Drawing style (_review_)

**Filled** by default: solid `currentColor` shapes. A **stroke** style is
allowed only for the _tools_ family (align, space, navigate, zoom, select,
close), which is drawn in 2px lines. This split is the end state, not a
transition: the tools read as instruments beside filled objects, which is the
same distinction Fluent and Material make with their filled and outlined sets.

When a stroke would close up at 16px (small boxes, dense lines), draw the shape
filled instead, even inside the tools family. See
[`tidy_up`](#worked-example-tidy_up).

_Today:_ 78% filled; the action icons mix all three styles.

### Stroke weight

Exactly **2px** for stroke icons. 1.5px is allowed only for a detail inside a
filled icon, such as a clock's hands. No other widths.

2px is the established weight (39 icons) and matches the visual mass of the
filled icons; 1.5px strokes look anaemic beside them.

_Today:_ none; the last three (`join2-1`, `sessions`, `versions`) were repointed
or deleted in #104. The 1.33px drawings (12px art scaled by 4/3) and `help` were
redrawn in #103, and `tidy_up` in #98.

### Caps and joins

Every stroke declares `stroke-linecap="round"` and `stroke-linejoin="round"`, on
the element or on an ancestor within the symbol. Undeclared, SVG defaults to
butt caps and miter joins, and the line ends visibly differ from their
neighbours.

_Today:_ every stroke declares both (#100).

### Corner radius (_review_)

`rx="1"` for small filled boxes; `rx="2"` for containers of 10px or more.

_Today:_ 1, 1.5 and 2 are used interchangeably.

### Secondary tone

At most two tones: the main shape, and one secondary shape at `opacity="0.3"`.
The tinted secondary shape is the set's signature (the container behind
`data_input`, the grid behind `column_add`); it gives a two-tone icon from a
single `currentColor`. It has to be one level so that icons look related.

_Today:_ none. `join2-1`, the last three-tone icon, was repointed to `join` in
#104. Six icons used to be tinted as a whole, with no full-tone shape; #103 gave
five of them one (`docs`, `find`, `join`, `union`, `workflow_play`), and the
sixth, `root`, was unused and deleted in #104.

### Colour

`currentColor` only, for both fills and strokes, so the caller decides the
colour and dark mode works. Never `fill="white"` to knock out a shape: leave the
gap. The only exceptions are brand marks, which must be named `*_color`
(`google_color`, `github_color`, ...).

_Today:_ only the brand marks.

### Structure

No `transform`, `clip-path`, `mask`, `filter`, `style`, `<defs>`, gradients or
`id`s inside a symbol (set properties as attributes, where the check can see
them). Flatten on export. Ids inside a symbol share one document with every
other icon and collide; transforms and clips are export residue that make an
icon hard to edit.

_Today:_ none; the Figma clips, ids and transforms were flattened in #100.

### Coordinates

At most 2 decimal places, and on the 0.5px grid wherever the shape allows it
(straight edges, box corners, circle centres) — _review_. Off-grid edges render
blurred at 1x.

_Today:_ every value has at most 2 decimals, but the 12px drawings scaled by 4/3
on export still sit off the 0.5px grid (`2.67`, `13.33`).

### Detail and legibility (_review_)

Minimum feature 2px, minimum gap 1.5px at 16px. An icon that can appear in the
component browser's group list is rendered at **12px** (`ComponentList.vue`) and
must survive that too. A 2px stroke stays crisp at 1x only when centred on a
whole pixel, so stroke centres go on integers and fill edges on integers.

One deliberate exception: `space_zero` ("no spacing") draws two lines 1px apart,
because a touching pair is what it depicts.

_Today:_ `space_zero` had 0.33px gaps and rendered as a solid block, and
`tidy_up`'s boxes filled in; both were redrawn in #98. Others remain (`union`).

### Naming

`snake_case`, family prefix first (`align_left`, `join_inner`, `table_add_row`),
a noun or `verb_noun`. No iteration numbers (`parse3`), no hyphens, no paths
(`icon/lock`), no leading digit. A number is allowed only where it means
something, like a heading level (`header1`). Name the shape's meaning, not its
first caller (`chevron_right`, not `folder_closed`).

A name used in a standard library `icon:` doc tag is effectively permanent:
renaming it means editing `.enso` files, so choose it carefully.

_Today:_ none; the last were renamed or merged in #104 (`parse3` is now `parse`,
`local_scope4` is `select_cell`).

### Every icon is used (_review_)

Every new symbol is referenced by a caller or a standard library `icon:` tag in
the same pull request, and ids are unique (the icon generator fails on a
duplicate). An unused icon is dead weight in every page load. Before deleting
one, search the standard library for its quoted name as well: a widget can name
an icon in a `Choice.Option ... icon="join_inner"` argument, not only in a doc
tag.

_Today:_ none known; 65 unused symbols were removed after this guide was
written, and `sessions`, `versions` and `root` in #104.

## Worked example: `tidy_up`

The _Tidy up_ button sits in the selection toolbar between `align_left` and
`space_default`, both 2px strokes on the keyline. Its first drawing was three
4.5x3 boxes stroked at 1.5px. It broke two rules: the stroke weight (it looked
lighter than its neighbours), and legibility (the 3x1.5px box interiors fill in
at 16px). It also cannot simply be re-stroked at 2px, because the interiors
would vanish.

So it is drawn **filled**: three solid 6x4 blocks in two left-aligned columns
(as Tidy up lays components out), joined by 2px connectors. Filled blocks carry
the same visual mass as a 2px stroke, keep the "arrange into columns" meaning,
and survive 12px. Every edge sits on a whole pixel, the 2px strokes are centred
on whole pixels, and every gap is at least 2px, so it stays crisp at 1x:

```svg
<symbol id="tidy_up" viewBox="0 0 16 16" width="16" height="16" fill="none">
  <rect x="1" y="1" width="6" height="4" rx="1" fill="currentColor"/>
  <rect x="1" y="11" width="6" height="4" rx="1" fill="currentColor"/>
  <rect x="9" y="6" width="6" height="4" rx="1" fill="currentColor"/>
  <path d="M4 5V11M7 3H11C11.55 3 12 3.45 12 4V6" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>
```

A first sketch used half-pixel blocks with a connector 0.5px from a block: it
blurred at 1x and broke the gap rule. Check a candidate rasterised at 1x, not
only at 2x, before choosing it. Redrawn in
[#98](https://github.com/jdunkerley/enso/issues/98).

## Exporting from Figma

The existing icons were drawn in Figma; its default SVG export breaks several
rules at once. Before exporting:

1. Draw on a 16x16 frame with the 1px keyline as a layout guide; snap to the
   0.5px grid.
2. Remove the frame's clip content (_Clip content_ off), or the export wraps
   every icon in a `clip-path`.
3. Flatten rotated or scaled layers, so the export has no `transform`.
4. Keep strokes as strokes (do **not** _Outline stroke_), set round caps and
   joins, and set 2px.
5. Use one colour; set the secondary shape's layer opacity to 30%.

After exporting, replace the `<svg>` wrapper with a `<symbol>`, change every
colour to `currentColor`, delete any `id` and `<defs>`, and round coordinates to
2 decimals.

## Adding an icon

1. Draw it to the rules above and add the `<symbol>` to `icons.svg`.
2. Run `corepack pnpm --filter enso-gui run generate-icons` to regenerate
   `iconName.ts`.
3. Use it: `SvgIcon name="..."` or a standard library `icon:` tag.
4. Run `corepack pnpm --filter enso-gui exec vitest run src/project-view/assets`
   to check it against the rules.
5. Show it beside its neighbours at 16px (and 12px if it can appear in the
   component browser) in the pull request.
