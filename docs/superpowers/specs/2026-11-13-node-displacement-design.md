# Nodes make room: pushing neighbours when a node changes size

Date: 2026-11-13. Status: design, revised after review.

## Summary

When a visualization opens under a node, or a node is resized, the nodes in the
way move out of the way. When the visualization closes, or the node shrinks,
they return to where they were.

Upstream started this in enso-org/enso#14904 ("Move components when resizing
viz"), which this fork carries as `nodesDisplacing.ts`. It pushes on open and on
a handle drag, but does not restore on close, moves more nodes than it needs to,
and is outside undo. This design replaces it.

## What the code does today

`app/gui/src/project-view/components/GraphEditor/nodesDisplacing.ts`, called
from a watcher on the visualization's size in `GraphNode/nodeVisualization.ts`.
Read from the code; not run.

- **It pushes on a handle drag and on open, including the Ctrl-hover preview.**
  The watcher acts only while `resizing` is set. `GraphVisualization.vue`
  reports `resizing` during a handle drag and also from the moment a
  visualization is hidden until it has next rendered (`isClosedOrOpening`), so
  an open, or a preview, pushes.
- **Closing probably pulls nothing back.** `resizing` is still false when the
  size watcher runs on a close. This follows from the watchers' order and has
  not been run.
- **The node's height handle and the table-editor widget's resize move
  nothing.**
- **A left-handle drag pushes nodes to the right.** The pure function ignores a
  change to the top or left edge, but the watcher builds both rectangles from
  the node's current position, so a widening by the left handle reaches it as a
  growth of the right edge.
- **A block push.** If any node is within 32px of the growing edge, every node
  beyond that edge moves by the same amount, whether or not it would have
  overlapped.
- **A per-component memory.** Shrinking pulls nodes back only as far as the
  point where the push began, kept in one variable per `GraphNode`
  (`lastPushStart`). It is lost when the component unmounts and on reload.
- **Outside undo.** The moves are written with the `local:autoLayout` origin, so
  undoing a resize leaves the neighbours pushed.

## Behaviour

### Which changes push neighbours

A node pushes its neighbours only when the user directly resizes it or shows or
hides its visualization. A size change that is a side effect of editing pushes
nothing.

| Change                                              | Pushes                                         |
| --------------------------------------------------- | ---------------------------------------------- |
| Visualization shown or hidden (button or shortcut)  | Yes                                            |
| Visualization resize handle dragged (right, bottom) | Yes                                            |
| Node height handle dragged                          | Yes                                            |
| Table-editor widget resized (its width)             | Yes                                            |
| Visualization previewed with Ctrl-hover             | No: transient. A change from today's behaviour |
| Node content grows (new argument, longer text)      | No: nodes would shuffle during an edit         |
| Node collapsed, expanded, or edited in place        | No: same reason                                |
| Left edge dragged                                   | No: the right edge stays still. A change       |
| Visualization type switched, fullscreen left        | No size change, so nothing to do               |

Editing a node hides its visualization while the edit lasts. That moves nothing:
the neighbours stay pushed.

### Which nodes move, and where

- A node moves only if the changed node's new rectangle, grown by a gap in the
  direction of the push, would overlap it. It moves just far enough to clear the
  gap.
- **The gap** is 32px, or the gap the two nodes already had, whichever is
  smaller. Nodes placed 20px apart (Tidy up's tight spacing) stay 20px apart
  when pushed, and a node is never moved by a neighbour that merely grew near
  it.
- **Cascade.** If that move makes it overlap another node, that node moves too,
  and so on.
- **Direction.** When a growing node first reaches another: a node below its
  bottom edge moves down, a node to the right of its right edge moves right, and
  a node that is both (diagonal) moves down. The direction then stays fixed for
  as long as that node is pushed. Nothing moves up or left.
- A node pushed by the cascade gets its direction the same way, from its
  position relative to the node that pushed it.
- **Never moved:** input nodes (the function's arguments); nodes with no
  position or no measured size; a node that already overlapped the changed node
  before it grew.
- The moves are immediate. There is no animation.

### Returning

Each pushed node remembers its **home**: its position before the first push.

- When the visualization closes, or the node shrinks, each node it pushed
  returns towards its home as far as the gap allows. Closing returns them all
  the way.
- **Moved by hand.** A pushed node whose position is changed by anything other
  than this feature (a drag, the arrow keys, Align, Spacing, Tidy up, the code
  editor, a version restore) forgets its home and stays where it was put.
- **Home taken.** If a node that is not one of its pushers now covers the place
  it would return to, it returns as far as it can without overlapping that node
  (keeping the gap), then forgets its home. It does not stay where it was
  pushed: with two visualizations side by side that could leave it hanging far
  below both.
- **Two pushers.** A node pushed by two nodes keeps its first home. When one of
  them stops pushing it, it returns as far as the other allows, and goes home
  when neither pushes it.
- **Tidy up** over the whole graph clears every home: the tidied layout is the
  new home. Over a selection it clears the homes of the nodes it places. Any
  move by hand does the same for the nodes it is given, moved or not.
- **Removing a pusher** (delete, delete and reconnect, collapse into a function)
  counts as closing it: the nodes it pushed return in the same undo step. Only
  the nodes actually removed count: an input node in the selection stays.
- **An AI node replaced in place** keeps its position and its open visualization
  under a new id, so it keeps what it pushes: the nodes it pushed are re-pointed
  at the new id, not released.
- **Moving a pusher** by hand (a drag, the arrow keys, Align, Spacing, Tidy up):
  when the move is committed, the nodes it was pushing are placed afresh from
  where it now is, in the move's undo step. Moved away, they return home. Nudged
  while still over them, they stay pushed, and one pushed further out pushes
  what it reaches. The moved node pushes nothing new at its new place.
- **A left-handle resize moves the node**, so a pushed node resized that way
  forgets its own home, as for any move by hand.
- **A node created or pasted with its visualization already open** pushes
  nothing: only a change to an existing node does.
- **Copy and paste** does not copy a home.

The home is saved with the project, so closing a visualization that has been
open for weeks still restores the layout.

What is guaranteed is **reversal**: opening then closing, or growing then
shrinking back, returns every node to its exact position, however the size got
there. What is not guaranteed is that two different routes to the same size push
a diagonal node the same way: its direction depends on which edge reached it
first.

### Undo

The neighbours' moves belong to the same undo step as the action that caused
them. Undoing "show visualization" hides it and puts the neighbours back in one
step. A handle drag is one undo step from mouse down to mouse up.

The moves are user edits like the action itself, so they clear the redo stack,
as the action does.

## Design

### Saved state

One optional field is added to the node metadata:

```ts
displaced?: {
  home: { x: number; y: number }
  at: { x: number; y: number }
  by: { id: ExternalId; gap: number; dir: 'down' | 'right' }[]
  under?: ExternalId[]
}
```

- `home`: the node's position before the first push.
- `at`: the position this feature last gave the node. If the node's position
  differs from `at`, something else moved it, the field is ignored when read,
  and it is removed at the next write. This is the whole of "moved by hand":
  nothing that moves a node has to know about the field.
- `by`: the nodes whose rectangles reach it, each with the gap kept from it and
  the direction of the push. In a cascade A → B → C, C lists B, and lists A too
  only if A's own rectangle would reach C.
- `under`: the nodes it overlapped at home, if any. They do not count as taking
  its home, so nodes that overlapped before a push return onto each other.
- An entry in `by` naming a node that no longer exists is ignored when read and
  removed at the next write.
- A position within 1px of `at` on each axis is the same position: the file
  rounds positions, so an exact comparison would fail after a reload.

**The position follows from the field.** A pushed node's position is its home
plus, on each axis, the largest offset any of its pushers requires: the distance
needed to clear that pusher's current rectangle by `gap` in `dir`, or zero. An
entry whose offset is zero is dropped. A node with no entries left is at home
and loses the field.

That one statement gives the returning rules: a pusher that shrinks requires a
smaller offset; one that closes requires none; with two pushers the larger
offset wins, and the node comes back part of the way when the larger one goes.

### Recomputing

Whenever a node S changes size through one of the triggers, from rectangle `old`
to rectangle `new`, in one edit:

1. **Start a work list with S**, as (node, old rectangle, new rectangle).
2. **For each item P on the list**, for every other eligible node N:
   - If N lists P in `by`, recompute N's position from its field.
   - Otherwise, if P's new rectangle is larger than its old one on the bottom or
     right: take both nodes where they were at home. If N is below P's old
     rectangle the direction is down; otherwise, if N is right of it, right;
     otherwise (they overlapped, or N is above or left) skip N. Let `g` be the
     smaller of 32 and their distance in that direction. If P's new rectangle,
     extended by `g` in that direction, reaches N, add P to N's `by` with `g`
     and the direction, set N's `home` (and `under`) if it has none, and
     recompute N's position.
   - If N's position changed, add N to the list with its old and new rectangle.
3. **Write** each changed node's position and field (`at` set to the new
   position), or remove the field from a node that is home.

A removed pusher is the same procedure with an empty `new`. A pusher moved by
hand is the same procedure with adding switched off for the moved node itself:
step 2 recomputes the nodes that list it and adds no new entries for it. A node
that this recompute moves further out is put on the list with adding on, so it
pushes what it reaches; without that it would land on its neighbours. A node
never pushes one of its own pushers, directly or through a chain: that is the
one contact that could loop.

Which side N is on, its gap, and whether a pusher is in line with it are all
judged where the nodes were at home; only how far a pusher reaches is read from
where it is now. Judged on current positions, two nodes pushed in the same pass
can each find the other in its way and push each other without end, and a node
pushed right can fall out of line with a pusher that was pushed down. Both
happened in the prototype.

**Home taken** is applied when the list is empty. If a node that moved back
towards its home overlaps a node that is not in its `by` or its `under`, it is
placed clear of that node by 32px, in the direction of the push it is returning
from, and its field is removed.

Positions only ever increase from the homes, and at home a pushed node is always
below or to the right of its pusher, so the list cannot cycle. The
implementation still caps the number of passes and stops with the positions it
has, and a property test over random layouts checks that the cap is never
reached and that reversal holds.

Every rectangle used here is **computed, not measured**: a node's position and
visualization metadata, plus its measured widget size (below). The rectangles in
`graph.nodeRects` lag the metadata by a frame during a drag, include a
Ctrl-hover preview, and do not reflect moves made earlier in the same edit, so
they are not used. Node comments and messages are outside these rectangles, as
they are outside `nodeRects` today.

When several nodes change in one action (the shortcut on a multi-selection),
they are processed top to bottom in one edit, each seeing the positions the
previous one produced.

### Code

| Piece                                          | Role                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GraphEditor/nodeDisplacement.ts`              | The procedure above as a pure function: the changed nodes with their old and new rectangles, and every node's rectangle and `displaced` field in; new positions and fields out. No Vue and no store. Replaces `nodesDisplacing.ts`.                                                                                      |
| `visualizationSize`                            | The width and height formula now inside `GraphVisualization.vue` (`MIN_WIDTH_PX`, `MIN_CONTENT_HEIGHT_PX`, `DEFAULT_CONTENT_HEIGHT_PX`), moved to a shared function used by the component and by the store.                                                                                                              |
| Graph store (`providers/openedProjects/graph`) | A map of each node's measured widget size (the node without its visualization), reported by `GraphNode` beside `update:rect`. `nodeRects` cannot supply it: with a visualization open it holds only the larger of the two widths. An internal `relayout` that calls the pure function and writes into the caller's edit. |
| Undo wrapper (`module.ts`)                     | A method that holds one undo step open and returns a function that closes it.                                                                                                                                                                                                                                            |
| `nodeVisualization.ts`, `GraphNode.vue`        | The `visibleSize` watcher, the `resizing` flag and the `onResize` callback are removed.                                                                                                                                                                                                                                  |
| `GraphVisualization.vue`                       | `isClosedOrOpening` and the `update:resizing` event are removed. The left handle reports the new width and position as one event.                                                                                                                                                                                        |

The Ctrl-hover preview needs no special case. It never writes metadata, so it
never reaches the store.

**Saving the field** needs every one of these, since the ydoc server rebuilds a
node's file metadata field by field:

- `ydoc-shared/src/ast/tree.ts`: `NodeMetadataFields` and `nodeMetadataKeys`.
- `ydoc-server/src/edits.ts`: `nodeMetadataToFile` (new key last, y negated and
  values rounded as for `position`) and `applyNodeMetadataFromFile`.
- `ydoc-server/src/fileFormat.ts`: the schema, tolerant of a malformed value as
  `cachedAppearance` is.
- `gui/src/providers/openedProjects/module/carryOver.ts`:
  `CARRIED_METADATA_KEYS`, so a replaced session keeps the homes with the
  positions.
- `graphClipboard.ts`: the field is stripped from copied metadata.

### Triggers

- **Show, hide and resize of a visualization:** `setNodeVisualization`, when
  `visible`, `width` or `height` changes. The left handle's width and position
  arrive in one call, so the store sees the right edge stay still and pushes
  nothing. The `graph.toggleVisualization` shortcut gets a batch entry point
  that sorts the selection top to bottom.
- **The node's height handle:** `setNodeHeight`. Second pull request, which also
  saves the height (below).
- **A pusher moved by hand:** the commit of a drag or arrow-key move, Align,
  Spacing and Tidy up call `relayout` for each moved node that others list in
  `by`, with its old and new rectangle. A move is not a growth, so step 2 adds
  no new pushers for the moved node; the nodes it was pushing recompute. They
  all go through `setNodePositions`, which also clears the field of every node
  it is given. A node drag holds one undo step from its start to its end, as a
  handle drag does.
- **The table-editor widget** (`ResizableWidget.vue`). It has a right handle
  only, and its size is in the widget's metadata. The node's widget size after
  the change is not known until render, so the new widget width is taken as the
  old one plus the drag's delta; the node's rectangle then follows from the
  usual formula, and does not grow at all while its visualization is the wider
  part. Second pull request.
- **Removal of a node by the user:** `graphStore.deleteNodes`,
  `deleteAndConnectAround` and `collapseNodes`, through `releasePushedBy`. The
  first is an asynchronous edit on a fork, so `relayout` takes the edit to read
  from and write into.
- **Replacement of an AI node:** `repointPushedBy(oldId, newId, edit)` rewrites
  the `by` and `under` entries that name the old id.
- **Every layout call happens at most once per outer transaction.** The node
  database the layout reads is updated only when the transaction commits, so a
  second call in the same transaction would lay out against the old graph. An
  action that changes several nodes passes them in one call.

A pusher that disappears any other way (an edit in the code editor, a version
restore) triggers nothing. The nodes it pushed stay where they are, and their
dangling entries are dropped at the next write.

### Undo

- Show, hide, removal and Tidy up are each one edit already. The moves are
  written in that edit with the default user-action origin, not
  `local:autoLayout`. Nothing else is keyed on that origin for these writes: the
  code editor's sync looks only at its own origin and at text changes.
- A handle drag writes on every frame. Yjs merges edits into one undo step only
  while they arrive within its capture timeout (500ms by default), so a pause
  mid-drag splits the step. The wrapper's new method ends the current step, sets
  the timeout to infinity for the drag, and on release restores it and ends the
  step. The release runs on pointer up, pointer cancel and window blur, since a
  missed release would merge every later edit into the drag.

  How a drag groups into undo steps today has been read from Yjs's defaults, not
  measured. The implementation confirms it first.

### Edge cases

- **A project saved by an older build with a visualization open.** Nothing has a
  home, so closing it moves nothing. Pushing starts at the next open or resize.
- **A project saved by this build, opened and saved by an older one.** The older
  build does not read the field into the document, so its first save removes it
  from every node. The nodes stay where they were pushed, with no home.
  Accepted: there are no older builds in use.
- **Two people in one project.** The field syncs like the rest of the metadata.
  Two clients pushing the same node at once is not designed for.
- **Nodes at identical positions** (the Playwright mock project has some, with
  visualizations open). They overlap before any growth, so they are never pushed
  by each other.

### Saving a node's height

A node's height override (`position.h`) is not written to the project file
today: `nodeMetadataToFile` writes only the position's `vector`, so a node
resized by its height handle shrinks back on reload. With this feature its
neighbours would stay pushed under a node that is no longer tall. The second
pull request saves the height, as a new optional key written and read beside the
position, absent when there is no override.

## Testing

- **Unit tests on the pure function**, which holds most of the behaviour:
  - push, cascade, the direction choice and the kept gap;
  - open then close, and grow then shrink back, return every node to its exact
    position, including with two pushers and a three-node cascade;
  - a node pushed right by one node and down by another;
  - moved by hand (`at` differs), a dangling pusher, two pushers closing in
    either order;
  - input nodes, unplaced nodes, nodes already overlapping;
  - a property test over random layouts: the pass cap is never reached, and
    reversal holds.
- **Unit tests on the store:** show, hide and a multi-frame drag with a pause
  are each one undo step, and redo reverses each; the left handle pushes
  nothing.
- **Unit tests on the ydoc server:** the field survives a save and a reload.
- **Playwright:** a visualization opened above a node moves it and closing moves
  it back; Ctrl-hover moves nothing; a pushed node dragged by hand stays after
  the close. The existing specs that toggle a visualization and then act by
  coordinates (`graphNodeVisualization`, `tableVisualisation`, `undoRedo`, and
  the align, spacing and tidy specs) are run before and after.
- `__tests__/displacing.test.ts` is removed with the algorithm it tests.

## Delivery

Two pull requests:

1. **The rule, and visualizations.** The field and all its saving; the pure
   function; the widget-size map; `visualizationSize`; show, hide and the
   visualization's handles; moved by hand; Tidy up; removal of a pusher; undo,
   including the held step. Removes the old algorithm.
2. **The other two triggers.** The node's height handle and the table-editor
   widget. It gets its own plan once the first has merged, since it builds on
   the measured-size map the first introduces.

Each is a feature: a `CHANGELOG.md` entry, and before and after screenshots.

## Not included

- Pushing up or left.
- Pushing when a node's content grows.
- Animating the moves.
- Making room for node comments and messages.
- Any change to how Tidy up lays nodes out.

## Decisions

| Question                      | Decision                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| Closing a visualization       | Restores the pushed nodes; the Ctrl-hover preview pushes nothing     |
| Which nodes move              | Only those in the way, cascading; not every node beyond the edge     |
| How long a home is remembered | Saved in node metadata                                               |
| Which size changes push       | Direct resizes and show or hide; never a side effect of editing      |
| Undo                          | The moves are part of the causing action's undo step                 |
| When the moves are computed   | At the action, in the same edit; not from a watcher on rendered size |
| Home taken                    | Return as far as possible without overlapping, then forget the home  |
| A pusher moved by hand        | The nodes it pushed return home at the drop; it pushes nothing new   |
| Node height                   | Saved to the project file, in the second pull request                |
