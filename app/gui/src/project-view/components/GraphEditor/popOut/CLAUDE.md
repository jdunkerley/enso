# popOut

"Pop out" turns an argument's value in a node into a node of its own and leaves
a reference to it in its place (spec:
`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`,
part A).

- `autoscope.ts` - `qualifyAutoscoped`: rewrites auto-scoped names (`..Month`)
  to qualified ones (`Date_Period.Month`), since they mean nothing outside their
  argument.
- `expectedTypes.ts` - `expectedTypesIn`: the type expected at each argument
  inside a value, which `qualifyAutoscoped` needs.
- `popOut.ts` - `canPopOut`, `popOutCode` and `usePopOut`: the eligibility
  check, the code of the new node, and the edit (one undo step, through
  `createNodes`'s `inSameEdit`).

- `usePopOutDrag.ts` - the drag's state (source, ghost, Escape, drop outside the
  node). `GraphNode.vue` feeds it from its own `useClickableDraggable`: a drag
  that starts inside a port `WidgetPort` marks with `data-pop-out-port` (and
  `data-pop-out-name`, `data-pop-out-type`) pops out instead of moving the node.
  `GraphNodes.vue` forwards the `popOut` event and `GraphEditor.vue` calls
  `usePopOut`.

Number, text and slider inputs stop `pointerdown`, so they can't start a pop-out
drag; drag a non-input part of the argument (such as the `Date.new` text).
