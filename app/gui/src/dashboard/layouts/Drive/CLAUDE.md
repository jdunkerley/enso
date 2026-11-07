# layouts/Drive

The drive's composables and helpers (#91): `driveView.ts` (the shown-versus-
target location), `driveActions.ts`, `assetItems.ts`, `suggestions.ts`,
`drag.ts` and `autoScroll.ts` (drag and drop), `pressPropagation.ts`,
`parentEntry.ts` (the parent-folder entry, below), and the accessibility pieces
below. The components using them are `../AssetsTable.vue` (the table),
`#/pages/dashboard/components/AssetRow.vue` (a row) and
`#/pages/dashboard/components/ParentDirectoryRow.vue` (the parent-folder entry).

## The parent-folder entry (#640)

Inside a folder below its category's root, the table's first body row is a `..`
entry ("Parent folder", test id `parent-directory-row`) that opens the folder
above. `parentEntryDirectoryId` decides when it shows: not at a category's root,
not in Recent, not while the query (as typed or as debounced) has text, and not
before the shown folder's details (its `parentId`) have loaded. It is outside
the `v-for` of the assets, so it stays first whatever the sort.

- **Not an asset.** It is never selected (no `aria-selected`), renamed, dragged,
  deleted or labelled, has no context menu (its `contextmenu` is swallowed so
  the table's does not open), and its other cells are empty. A click clears the
  selection.
- **Opening.** A double click, Enter or Space opens the parent through
  `driveView.navigate` with `PARENT_ENTRY_NAVIGATION_SOURCE`, so its icon
  becomes a spinner until the parent is shown.
- **Keyboard.** In `AssetsTable.vue`'s keyboard model it is index
  `PARENT_ENTRY_INDEX` (`-1`), before the first asset: ArrowUp from the first
  asset reaches it (`arrowKeyIndex`), ArrowDown leaves it, and Shift+Arrow never
  extends a selection onto it. In the roving tab stop it is the key
  `PARENT_ENTRY_KEY`, so with nothing selected or focused it is the grid's tab
  stop. The asset rows' `aria-rowindex` and the table's `aria-rowcount` count it
  while it shows; the rubber-band selection skips its height.
- **Drops.** It takes the drops a directory row takes, through the same
  `dropInto` (`paste` with `move`, or an upload of dropped files), into the
  parent folder; it shows the same `selected` highlight while a drag is over it,
  holding a drag over it for two seconds opens the parent, and the drop is
  announced as "into the parent folder" (destination `{ type: 'parent' }`).
- The keyboard focus ring is shared with `AssetRow.vue` through
  `driveRowFocusRing.css` (the `DriveRow` class).

## The table's accessibility model (#208)

- **An ARIA `grid`, not a `treegrid`.** The listing is flat: opening a directory
  replaces the listing with its contents (the shown-versus-target location of
  `driveView.ts`), so no row ever expands in place and `aria-expanded`,
  `aria-level`, `aria-setsize` and `aria-posinset` would describe a structure
  that is not there. The `<table>` carries `role="grid"`,
  `aria-multiselectable`, an `aria-label` and `aria-rowcount` (`-1` while more
  pages may load); the header row is `aria-rowindex="1"` and each asset row its
  index + 2 (index + 3 while the parent-folder entry, at 2, shows). Asset rows
  keep `aria-selected`. The page objects find the table with
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

## Column widths

`columnWidths.ts` holds the widths the user dragged the columns to, saved in
`localStorage` (`driveColumnWidths`) once a drag ends (`persist`, on the
handle's `resizeEnd`; a width changes in memory on every move) and shared by
every category; the limits and defaults are `COLUMN_WIDTH_LIMITS` in
`columnUtils.ts`, and the handle is `$/components/ColumnResizeHandle/`. The
table lays out from its `<colgroup>` (`table-fixed`): every column but Name has
a width, and Name, until it is given one, takes what the others leave (the table
is then `max(100%, sum)` wide, so it scrolls sideways only once the columns need
more than the panel). A cell other than Name clips what does not fit; the name
cell's contents shrink instead, so that its focus rings are not clipped. A press
on a handle must not start the rubber-band selection, so `AssetsTable.vue`'s
`preventSelection` skips `[data-column-resize-handle]`; each heading cell is
named by its heading (`aria-labelledby`), not by its content, which would take
in the handle's name.
