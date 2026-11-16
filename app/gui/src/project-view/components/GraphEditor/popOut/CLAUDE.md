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

The drag is routed in `GraphNode.vue` from ports marked `data-pop-out-port`.
