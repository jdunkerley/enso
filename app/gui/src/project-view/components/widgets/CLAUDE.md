# components/widgets/

Small input components the node widgets build on (not widgets themselves: those
are in `../GraphEditor/widgets/`, see its `CLAUDE.md`).

- `DropdownWidget.vue` — the list every dropdown menu draws: the selection menus
  (`WidgetSelection`, `WidgetMultiSelection` and the function definition's
  argument defaults, all through
  `GraphEditor/widgets/WidgetSelection/SelectionSubmenu.vue`) and the kind
  picker's list (`KindChip`).
  - **One highlight**, moved by the mouse (`pointermove`, not `:hover`, so a
    list scrolled under a still pointer keeps the keys' highlight) and, with the
    `keyboard` prop, by the keys. It is kept by entry key, and dropped when the
    entry leaves the list (a filter), so Enter never chooses a hidden entry.
  - **`keyboard`** (set by `SelectionSubmenu` on its top-level list): while the
    list is shown, a capturing `window` listener takes Up and Down
    (`listBindings`, as the component browser's list), Enter, and Home and End
    (outside a text field, where they move the caret), wherever the focus is: a
    text input that filters the list keeps the focus, and the node does not move
    (the arrow keys move a selected node). The first Up or Down starts from the
    chosen entry, and they wrap around at the ends, as in the kind picker. Enter
    with nothing highlighted is left alone (the text input then accepts what was
    typed); Escape is the edit handler's. A submenu's list has no `keyboard`.
  - `dropdownHighlight.ts` — the framework-free part: where a move takes the
    highlight, and how far to scroll the list to show it.
- `CheckboxWidget.vue`, `NumericInputWidget.vue`, `AutoSizedInput.vue`,
  `DraggableList.vue` — the inputs the boolean, number, text and vector widgets
  use.
- `index.ts` — the glob that loads every built-in widget.
