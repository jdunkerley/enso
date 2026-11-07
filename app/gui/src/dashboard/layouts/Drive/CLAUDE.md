# layouts/Drive

The drive's composables and helpers (#91): `driveView.ts` (the shown-versus-
target location), `driveActions.ts`, `assetItems.ts`, `suggestions.ts`,
`drag.ts` and `autoScroll.ts` (drag and drop), `pressPropagation.ts`,
`samples.ts`, and the accessibility pieces below. The components using them are
`../AssetsTable.vue` (the table) and `#/pages/dashboard/components/AssetRow.vue`
(a row).

`samples.ts` is the bundled samples (`<projects>/Samples`): the shim's
`samples/status` (query options in `$/utils/samplesQuery.ts`) says which project
rows are bundled samples, which have an update, and how an update would keep
each one's edits (`route`: in version history, or as the copy `copyName`). The
user-facing word is "Update", never "Reset" (owner's ruling on #622):

- **The pill.** `ProjectNameColumn.vue` shows "Update available" on a sample
  with an update, as a `Button` (`testId="sample-update-badge"`, an `aria-label`
  naming the sample, a focus ring) that binds `STOP_PRESS_PROPAGATION`, so a
  press neither selects nor opens the row. It is disabled, with a tooltip, while
  the project is open or opening (`isOpenOrOpening`, the context menu's test).
- **Update Sample** in a sample's context menu (`useSampleMenuEntries`,
  `AssetContextMenu.vue`), disabled the same way. The pill and the entry both go
  through `useConfirmedSampleUpdates`: a sample with edits of the user's
  (`route` not `null`) is updated only after `UpdateSamplesModal.vue` says how
  they are kept ("Your current version stays in version history", or "Your
  edited copy will be kept as …", and, for a versioned sample whose ignored
  files the update would overwrite, why it is a copy: `ignoredChanges`); one
  with none is updated at once.
- **Update All** in the toolbar (`DriveBarToolbar.vue`, `useUpdateAllButton`,
  `testId="update-all-samples"`), shown only while the current folder is the
  installed `Samples`; disabled, with a tooltip, when no sample has an update or
  one that has is open. Its confirmation lists each sample with an update and
  its route; the shim updates exactly those (`samples/update-all`).
- **Toasts** (`useUpdateSamples`) say what happened: updated, the previous
  version in version history, or the copy kept; a warning for a copy kept
  because the version could not be saved (`fellBack`) and for a copy still named
  as its sample (`unrenamed`); for Update All, what failed.

There is no Reset All. A sample's original comes back three ways: Update Sample
on it (any sample, for every user); its version history, when versioning is on;
and, for a deleted sample or a changed or deleted `Samples/Data` file (which
have no row to act on), renaming or deleting the `Samples` folder, which the
next start reinstalls whole. The pill and the dialog read the samples' states
again when the Drive enters `Samples` and before a confirmation opens
(`useUpdateAllButton`, `useConfirmedSampleUpdates`), so the route and copy name
shown are current; with nothing left to update, Update All says so instead of
asking. A host without samples (the Vite dev server) answers with an error, read
as no samples. The Playwright mock is `integration-test/mock/localSamples.ts`
(no samples unless a spec adds them; `route: 'version'` makes one versioned);
the spec is `dashboard/localSamples.spec.ts`.

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
