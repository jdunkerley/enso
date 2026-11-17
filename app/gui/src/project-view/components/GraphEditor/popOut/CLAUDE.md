# popOut

"Pop out" turns an argument's value in a node into a node of its own and leaves
a reference to it in its place (spec:
`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`,
part A).

- `autoscope.ts` - `qualifyAutoscoped`: rewrites auto-scoped names (`..Month`)
  to qualified ones (`Date_Period.Month`), since they mean nothing outside their
  argument.
- `expectedTypes.ts` - `expectedTypesIn`: the type expected at each argument
  inside a value; `resolvedAutoscopedTypes`: the type of each auto-scoped
  constructor the graph database has resolved (the method call info of the
  application it heads, as `WidgetFunction` uses to show the constructor's
  arguments; the entry's `memberOf`). `qualifyAutoscoped` needs one of them.
- `popOut.ts` - `canPopOut`, `popOutCode` and `usePopOut`: the eligibility
  check, the code of the new node, and the edit (one undo step, through
  `createNodes`'s `inSameEdit`, with the imports of the types written).

A resolved constructor's type wins over the declared one; the declared type is
only the fallback. Declared types mislead: `Data.read`'s `format` is untyped
(`Any`), and a declared interface such as `File_Format` has no `Delimited`
constructor even though `..Delimited` is valid there (#837).

- `usePopOutDrag.ts` - the drag's state (source, ghost, Escape, drop outside the
  node). `GraphNode.vue` feeds it from its own `useClickableDraggable`: a drag
  that starts inside a port `WidgetPort` marks with `data-pop-out-port` (and
  `data-pop-out-name`, `data-pop-out-type`) pops out instead of moving the node.
  `GraphNodes.vue` forwards the `popOut` event and `GraphEditor.vue` calls
  `usePopOut`.

Number, text and slider inputs, the vector editor (`DraggableList`) and the
table editor handle `pointerdown` themselves, so they can't start a pop-out
drag; drag a non-input part of the argument (such as the `Date.new` text).

`canPopOut` refuses every plain identifier, not only references to other nodes:
constructors such as `True` and `Nothing` parse as identifiers too, and so are
not popped out.

The new node's assignment is appended at the end of the method body, which would
leave it after the statement that now uses it (Enso bindings are sequential), so
`usePopOut` moves that line to just above the statement using it, inside the
same edit (the line moves whole, keeping its metadata).
