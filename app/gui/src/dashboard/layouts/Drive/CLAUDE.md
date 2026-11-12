# layouts/Drive

The drive's composables and helpers (#91): `driveView.ts` (the shown-versus-
target location), `driveActions.ts`, `assetItems.ts`, `suggestions.ts`,
`drag.ts` and `autoScroll.ts` (drag and drop), `pressPropagation.ts`,
`samples.ts`, `parentEntry.ts` (the parent-folder entry, below), and the
accessibility pieces below. The components using them are `../AssetsTable.vue`
(the table), `#/pages/dashboard/components/AssetRow.vue` (a row) and
`#/pages/dashboard/components/ParentDirectoryRow.vue` (the parent-folder entry).

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

## Dropping a folder into itself (#644)

A folder cannot be dropped into itself or into a folder inside it. Holding a
drag over a folder opens it, so the drag can end up inside the folder it
carries; every drop target then refuses it: the rows and the `..` entry do not
accept the drag (no highlight), and `dropInto`, `doPaste` and `useMoveAssets` do
nothing with it (the table says "Cancelled moving …"). The check is
`canDropAssetsInto` in `$/utils/dropTarget`, which reads the nesting from the
local directory ids (they carry the path); `canDropRowsInto` in `drag.ts`
applies it to a drag payload. A multiple selection is refused as a whole when
any of its folders contains the target. The shim's `filesystem-move` refuses
such a move too (`isInsidePath`), though the file system itself would reject it
(`EINVAL` on Linux and macOS, `EPERM` on Windows), leaving the tree untouched.
The spec is `dashboard/dropIntoSelf.spec.ts`.

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
  stop. Moving to another folder forgets it as the remembered tab stop and
  keyboard anchor (`forgetTabStop`), unless the focus is on it (Enter on it
  keeps it focused in the folder above). The asset rows' `aria-rowindex` and the
  table's `aria-rowcount` count it while it shows.
- **Rubber band.** `rubberBandAssetIndex` turns a position of the band into an
  asset index: it clamps the position below the sticky heading in viewport
  coordinates, adds the `Scroller` content's `scrollTop` (the rows scroll there,
  not in the table's root), and only then subtracts the heading and the entry,
  which scrolls away with the rows.
- **Drops.** It takes the drops a directory row takes, through the same
  `dropInto` (`paste` with `move`, or an upload of dropped files), into the
  parent folder; it shows the same `selected` highlight while a drag is over it,
  and the drop is announced as "into the parent folder" (destination
  `{ type: 'parent' }`). Holding a drag over it for two seconds opens the
  parent; the entry stays mounted, so when its target changes under a drag it
  restarts the delay (`useDragDelayAction`'s `restart`) and a held drag keeps
  climbing until the category's root, where the entry is gone. Its highlight and
  pending open clear on any `dragend` or `drop` in the document, and on a
  `dragleave` with no `relatedTarget` (the drag left the window); `AssetRow.vue`
  clears its highlight on such a `dragleave` too.
- The keyboard focus ring is shared with `AssetRow.vue` through
  `driveRowFocusRing.css` (the `DriveRow` class), scoped in both
  (`<style scoped src>`).

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
