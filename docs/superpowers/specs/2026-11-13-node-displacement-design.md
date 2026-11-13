# Nodes make room: pushing neighbours when a node changes size

Date: 2026-11-13. Status: design, awaiting review.

## Summary

When a visualization opens under a node, or a node is resized, the nodes in the
way move out of the way. When the visualization closes, or the node shrinks,
they return to where they were.

Upstream started this in enso-org/enso#14904 ("Move components when resizing
viz"), which this fork carries as `nodesDisplacing.ts`. That work covers one
trigger only, dragging a visualization's resize handle, and it moves more nodes
than it needs to. This design replaces it.

## What the code does today

`app/gui/src/project-view/components/GraphEditor/nodesDisplacing.ts`, called
from a watcher in `GraphNode/nodeVisualization.ts`.

- **One trigger.** The watcher returns early unless a visualization resize
  handle is being dragged (its `resizing` flag). Opening or closing a
  visualization, the node's own height handle, and the table-editor widget's
  resize move nothing.
- **Right and bottom edges only.** A drag that moves the top or left edge is
  ignored.
- **A block push.** If any node is within 32px of the growing edge, every node
  beyond that edge moves by the same amount, whether or not it would have
  overlapped.
- **A session-only memory.** Shrinking pulls nodes back only as far as the point
  where the push began, kept in one variable (`lastPushStart`). It is lost on
  reload and when another node is resized.
- **Outside undo.** The moves are written with the `local:autoLayout` origin, so
  undoing the resize leaves the neighbours pushed.

## Behaviour

### Which changes push neighbours

A node pushes its neighbours only when the user directly resizes it or shows or
hides its visualization. A size change that is a side effect of editing pushes
nothing.

| Change                                              | Pushes                                 |
| --------------------------------------------------- | -------------------------------------- |
| Visualization shown or hidden (button or shortcut)  | Yes                                    |
| Visualization resize handle dragged (right, bottom) | Yes                                    |
| Node height handle dragged                          | Yes                                    |
| Table-editor widget resized                         | Yes                                    |
| Visualization previewed with Ctrl-hover             | No: transient, the graph would jump    |
| Node content grows (new argument, longer text)      | No: nodes would shuffle during an edit |
| Node collapsed, expanded, or edited in place        | No: same reason                        |
| Top or left edge dragged                            | No: would push up or left              |
| Visualization type switched, fullscreen left        | No size change, so nothing to do       |

### Which nodes move, and where

- A node moves only if the changed node's new rectangle, grown by a 32px gap,
  would overlap it. It moves just far enough to clear the gap.
- **Cascade.** If that move makes it overlap another node (with the gap), that
  node moves too, and so on.
- **Direction.** A node that starts below the changed node's old bottom edge
  moves down. One that starts to the right of its old right edge moves right. A
  node that is both (diagonal) moves down. Nothing moves up or left.
- A node pushed by the cascade moves in the same direction as the node that
  pushed it.
- **Input nodes** (the function's arguments) are never moved, and nodes with no
  measured rectangle are neither moved nor treated as obstacles.
- The moves are immediate. There is no animation.

### Returning

Each pushed node remembers its **home**: its position before the first push.

- When the visualization closes, or the node shrinks, each node it pushed
  returns towards its home as far as the gap allows. Closing returns them all
  the way.
- **Moved by hand.** A pushed node that the user drags, or moves with the arrow
  keys, forgets its home and stays where it was put.
- **Home taken.** If another node, one that is not itself returning, now
  overlaps the home, the pushed node stays where it is and forgets its home.
- **Two pushers.** A node pushed by two nodes keeps its first home and returns
  only when neither still pushes it.
- **Tidy up** clears every home: the tidied layout is the new home.
- **Deleting** a node counts as closing it: the nodes it pushed return in the
  same undo step.
- **Copy and paste** does not copy a home.

The home is saved with the project, so closing a visualization that has been
open for weeks still restores the layout.

### Undo

The neighbours' moves belong to the same undo step as the action that caused
them. Undoing "show visualization" hides it and puts the neighbours back in one
step. A handle drag is one undo step from mouse down to mouse up.

## Design

### Saved state

One optional field is added to `NodeMetadataFields`
(`app/ydoc-shared/src/ast/tree.ts`):

```ts
displaced?: { home: { x: number; y: number }; by: ExternalId[] }
```

- `home`: the node's position before the first push.
- `by`: the nodes whose size change pushed it, directly or through the cascade.
- A node without the field is at home. Projects saved before this change have no
  field, so they load unchanged, and a project saved with it opens in an older
  build, which ignores the unknown field.

### One rule for open, resize and close

Whenever node S changes size through one of the triggers, from rectangle `old`
to rectangle `new`:

1. Every node whose `by` is exactly `[S]` is treated as being at its `home`.
2. The cascade runs from `new`: any node within the gap of it moves just clear,
   in the direction given by its position relative to `old`, and pushes what it
   then overlaps.
3. The results are written. A node that ends at its home loses the field. A node
   that ends elsewhere keeps `home` (or gets its previous position as `home` if
   it had none) and has S in `by`.

Growing pushes; shrinking lets nodes return as far as the gap allows; closing is
a shrink to the bare node. Because the rule always starts from the homes,
applying it twice gives the same result as applying it once, and a resize made
in many small steps ends in the same layout as one made in a single step. No
state is kept outside the metadata.

A node that lists S and another node in `by` is left where it is in step 1. It
is moved in step 2 only if `new` reaches it. If `new` does not reach it, S is
removed from its `by`.

The home-taken rule is applied in step 3: a node whose result is its home, but
whose home is overlapped by a node not moved in this pass, stays at its current
position and loses the field.

### Code

| Piece                                          | Role                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GraphEditor/nodeDisplacement.ts`              | The rule above as a pure function: S, `old`, `new`, and each other node's rectangle and `displaced` field in; new positions and fields out. No Vue and no store. Replaces `nodesDisplacing.ts`.             |
| `visualizationSize`                            | The width and height formula now inside `GraphVisualization.vue` (`MIN_WIDTH_PX`, `MIN_CONTENT_HEIGHT_PX`, `DEFAULT_CONTENT_HEIGHT_PX`), moved to a shared function used by the component and by the store. |
| Graph store (`providers/openedProjects/graph`) | An internal `relayoutAround(S, old, new)` that calls the pure function and writes positions and fields inside the caller's edit.                                                                            |
| `nodeVisualization.ts`, `GraphNode.vue`        | The `visibleSize` watcher, the `resizing` flag and the `onResize` callback are removed.                                                                                                                     |

A visualization's size is not measured from the DOM: it is computed from the
saved width and height, the node's own size and the three constants. So the
store knows the rectangle a visualization will have before it renders, and can
write the size change and the moves in one edit.

The Ctrl-hover preview needs no special case. It never writes metadata, so it
never reaches the store.

### Triggers

All go through the store, so every caller gets the behaviour:

- `setNodeVisualization`, when `visible`, `width` or `height` changes. This
  covers the visualization button, the `graph.toggleVisualization` shortcut on a
  selection, and the handle drag.
- `setNodeHeight`, for the node's height handle.
- The table-editor widget's resize (`ResizableWidget.vue`). Its size is stored
  in the expression, and the node's resulting size is known only after render,
  so `new` is taken as `old` plus the drag's delta. That is exact for height,
  and for width whenever the table is the node's widest part.
- Node deletion: `relayoutAround` with `new` empty.
- Tidy up, drag finish and arrow-key moves: clear the field on the nodes they
  place.

When several nodes change in one action (the shortcut on a multi-selection),
they are processed top to bottom in one edit, each seeing the positions the
previous one produced, so the result does not depend on selection order.

### Undo

- Show, hide, delete and Tidy up are each one edit already. The moves are
  written in that edit, with the default user-action origin, not
  `local:autoLayout`.
- A handle drag writes on every frame. Yjs merges edits into one undo step only
  while they arrive within its capture timeout (500ms by default), so a pause
  mid-drag would split the step. The undo step is held open from the start of a
  handle drag to its end, and closed with `undoStackBoundary` afterwards.

  This is the reading of Yjs's default behaviour, not a measurement: the
  implementation must confirm how a drag is grouped today before changing it.

### Edge cases

- **A node that is pushed and also pushes.** When it is pushed, its whole
  rectangle, open visualization included, is the obstacle in the cascade. The
  nodes it had pushed are moved by the cascade like any other.
- **A pusher removed by something other than the user's delete** (a code-editor
  edit, a version restore). No layout runs. A `by` entry naming a node that no
  longer exists is dropped when the field is next read, and the node stays where
  it is.
- **A project saved with a visualization already open by an older build.**
  Nothing has a home, so closing it moves nothing. Pushing starts at the next
  open or resize.

## Testing

- **Unit tests on the pure function**, which holds most of the behaviour:
  - push, cascade and the direction choice;
  - open then close returns every node to its exact position;
  - a grow then a shrink in steps equals one change to the final size;
  - moved by hand, home taken, two pushers;
  - Tidy up, delete, input nodes, unmeasured nodes.
- **Unit tests on the store:** show, hide and a multi-frame drag are each one
  undo step, and redo reverses each.
- **Playwright:** a visualization opened above a node moves it and closing moves
  it back; Ctrl-hover moves nothing; a pushed node dragged by hand stays after
  the close.
- `__tests__/displacing.test.ts` is replaced, since the algorithm it tests is
  removed.

## Delivery

Two pull requests:

1. **The rule, and show and hide.** The metadata field, the pure function,
   `visualizationSize`, the store wiring for show, hide and the visualization
   handle drag, the returning rules, undo. Removes the old algorithm.
2. **The remaining triggers.** The node height handle, the table-editor widget,
   and the clearing on Tidy up and delete.

Each is a feature: a `CHANGELOG.md` entry, and before and after screenshots.

## Not included

- Pushing up or left.
- Pushing when a node's content grows.
- Animating the moves.
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
