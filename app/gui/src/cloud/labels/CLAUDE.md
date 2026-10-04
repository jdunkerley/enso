# src/cloud/labels/

The drive's **labels popover** (#198): choosing, creating and deleting the
organization's labels for the selected assets. Vue, ported from the React
`ManageLabelsModal` and `ColorPicker` ("Rulings from #198" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).

- `ManageLabelsModal.vue` — the popover, meant for the modal stack: the React
  drive opens it with `setVueModal` (the row's context menu) or
  `useVueModalTrigger` (the labels column's edit buttons), passing the element
  it is anchored to (`anchor`, through `Popover.vue`'s `PopoverAnchor`) and,
  where React's focus scope knew it, where focus returns (`opener`). Escape
  closes only the innermost popover and is stopped there, so that the
  dashboard's global Escape binding does not close every modal.
- `ManageLabelsForm.vue` — its content (loaded inside the popover's
  `SuspenseLoader`): the search, the label pills, the list, "Create Label" (a
  nested popover with `ColorPicker.vue`) and the delete confirmations
  (`ConfirmDeleteModal.vue` through `useModals().ask`).
- `NotFoundLabel.vue` — "Create <search>" when nothing matches.
- `labelChanges.ts` — which labels an asset gets when a state changes
  (framework-free, tested on its own).
- The labels query is `../properties/queries.ts`' `labelsQueryOptions`, with
  React's key; the mutations are `backendMutationOptions`
  (`@/composables/backend`).
- Kept React quirks (each a visible change, for a separate decision) are listed
  in the files' comments and in the rulings.
- Tests: `__tests__/`.
