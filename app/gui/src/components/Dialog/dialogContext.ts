/**
 * @file How content inside a `Dialog.vue` or `Popover.vue` closes it. `DialogClose.vue` uses it.
 */
import { createContextStore } from '@/providers'

/** What a dialog or popover tells its content. */
export interface DialogContext {
  /** Close the dialog, as a dismissal (`@dismiss` fires, as for Escape or the close button). */
  readonly close: () => void
}

export const [provideDialogContext, injectDialogContext] = createContextStore(
  'Dialog',
  (context: DialogContext) => context,
)
