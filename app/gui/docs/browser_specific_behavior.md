# Browser-specific behavior

This document details behavior that is inconsistent between browsers and needs
to be worked around.

## List of inconsistent behaviors

### Drag event missing coordinates

Firefox sets `MouseEvent.pageX` and `MouseEvent.pageY` to `0` for `drag` events.

#### Fix

Listen to `dragover` as well as `drag`, and skip the events without coordinates:

```ts
function onDrag(event: MouseEvent) {
  if (event.pageX !== 0 || event.pageY !== 0) {
    // original body here
  }
}
useEventListener(document, "drag", onDrag, { capture: true });
useEventListener(document, "dragover", onDrag, { capture: true });
```

#### Affected files

- [`DragModal.vue`](../src/components/Drive/DragModal.vue)

### Drag event propagation in text inputs

Text selection in text inputs DOES NOT WORK on Firefox, when the text input is a
child of an element with `draggable="true"`. See [Firefox bug 800050].

[Firefox bug 800050]: https://bugzilla.mozilla.org/show_bug.cgi?id=800050

#### Fix

Turn `draggable` off on every element that MAY contain a text input while a text
input inside it has the focus (on `focusin` of a text input; back on at
`focusout`).

#### Affected browsers

- Firefox (all versions)

#### Affected files

- [`EditableSpan.vue`](../src/components/EditableSpan/EditableSpan.vue) - the
  text inputs that are affected
- [`AssetRow.vue`](../src/dashboard/pages/dashboard/components/AssetRow.vue) -
  fixes text selection in `EditableSpan.vue`
