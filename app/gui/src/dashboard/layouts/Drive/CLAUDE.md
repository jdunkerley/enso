# layouts/Drive

The drive's composables and helpers (#91): `driveView.ts` (the shown-versus-
target location), `driveActions.ts`, `assetItems.ts`, `suggestions.ts`,
`drag.ts` and `autoScroll.ts` (drag and drop), `pressPropagation.ts`, and the
accessibility pieces below. The components using them are `../AssetsTable.vue`
(the table) and `#/pages/dashboard/components/AssetRow.vue` (a row).

## The table's accessibility model (#208)

- **An ARIA `grid`, not a `treegrid`.** The listing is flat: opening a directory
  replaces the listing with its contents (the shown-versus-target location of
  `driveView.ts`), so no row ever expands in place and `aria-expanded`,
  `aria-level`, `aria-setsize` and `aria-posinset` would describe a structure
  that is not there. The `<table>` carries `role="grid"`,
  `aria-multiselectable`, an `aria-label` and `aria-rowcount` (`-1` while more
  pages may load); the header row is `aria-rowindex="1"` and each asset row its
  index + 2. Rows keep `aria-selected`. The page objects find the table with
  `getByRole('grid')`.
- **One tab stop** (`rovingTabStop.ts`): the row focused last has
  `tabindex="0"`, falling back to the first selected row, then the first row;
  every other row has `-1`, and `useTabStopContents` takes the buttons inside
  those rows out of the Tab sequence too (marking them `data-roving-demoted`,
  and catching controls added later with a mutation observer). Text fields are
  left alone. Focus entering a row (the row or a control in it) makes it the tab
  stop.
- **The keyboard model is still `AssetsTable.vue`'s own** (arrows, Shift and
  Ctrl ranges, Ctrl+Space, Enter, Escape). The roving tab stop only feeds it a
  starting point: with no row selected last (after Escape, or on tabbing back
  in), the arrow keys move from the focused row. Rows show a focus ring only for
  keyboard focus (`:focus-visible`), drawn per cell as an inset shadow, because
  an outline on the `<tr>` disappears under the sticky name cell.
- **Drag and drop is announced** (`dragAnnouncements.ts`) in a polite live
  region (`role="status"`, `data-testid="drive-drag-announcement"`): what is
  being moved on `dragstart`, where it landed on the drop (a directory row by
  title, anywhere else in the table as "the current folder", a target outside
  the table, such as a category button, by its accessible name), or that the
  move was cancelled. `aria-grabbed` and `aria-dropeffect` are deprecated and
  not used. The document's `drop` and `dragend` (capture) feed it, because the
  row a drag started from may be unmounted before the drag ends.
- **Keyboard users move assets with cut and paste**, not drag and drop: select
  the rows, `Mod+X`; select the destination folder (or nothing, for the folder
  being shown), `Mod+V`. `Escape` cancels a pending cut. There is no keyboard
  drag.
