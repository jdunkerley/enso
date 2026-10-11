/**
 * @file What a screen reader hears while rows of the drive's table are dragged: the text of a
 * polite live region, saying what is being moved and where it lands, or that the move was
 * cancelled. (ARIA's `aria-grabbed` and `aria-dropeffect` are deprecated, and no screen reader
 * acts on them.) The keyboard route for the same moves is cut and paste.
 */
import { useText } from '$/providers/text'
import { shallowRef } from 'vue'

const NO_BREAK_SPACE_CODE_POINT = 0xa0
/** Appended to every other message, so that a repeated message is still a change. */
const NO_BREAK_SPACE = String.fromCodePoint(NO_BREAK_SPACE_CODE_POINT)

/** An asset being dragged, as far as an announcement needs it. */
export interface AnnouncedAsset {
  readonly title: string
}

/** Where dragged rows were dropped inside the table. */
export type TableDropDestination =
  /** Anywhere but a directory row: the rows move into the directory being shown. */
  | { readonly type: 'current' }
  /** A directory row: the rows move into it. */
  | { readonly type: 'directory'; readonly title: string }

/**
 * The live region's text through one drag at a time. Call `started` on `dragstart`, `droppedInTable`
 * or `rejected` when the table handles the drop, `droppedElsewhere` on any `drop` in the document
 * (it is ignored when the table then handles it), and `ended` on `dragend`.
 */
export function useDragAnnouncements() {
  const { getText } = useText()
  /** The live region's text. */
  const message = shallowRef('')
  /** How the dragged assets are named, while a drag is in progress. */
  let subject: string | null = null
  let isHandled = false
  /** The accessible name of where a drop outside the table landed (`null`: it has none). */
  let elsewhere: { readonly name: string | null } | null = null
  let parity = false

  /**
   * Set the live region's text. A message identical to the previous one gets a trailing
   * no-break space alternately, so that it is still a change, and is announced again.
   */
  const announce = (text: string) => {
    parity = !parity
    message.value = parity ? text : `${text}${NO_BREAK_SPACE}`
  }

  /** One asset by its title, several by their count. */
  const describe = (assets: readonly AnnouncedAsset[]) => {
    const [first] = assets
    return assets.length === 1 && first != null ?
        getText('dragAnnouncementOneAsset', first.title)
      : getText('dragAnnouncementAssets', assets.length)
  }

  /** Forget the drag that has ended. */
  const finish = () => {
    subject = null
    isHandled = false
    elsewhere = null
  }

  return {
    message,
    /** Whether a drag of rows is in progress. */
    isDragging: () => subject != null,
    /** Rows have started being dragged. */
    started(assets: readonly AnnouncedAsset[]) {
      subject = describe(assets)
      isHandled = false
      elsewhere = null
      announce(getText('dragAnnouncementStarted', subject))
    },
    /** The table moved `moved` (the dragged assets not already there) to `destination`. */
    droppedInTable(moved: readonly AnnouncedAsset[], destination: TableDropDestination) {
      if (subject == null) return
      isHandled = true
      if (moved.length === 0) {
        announce(getText('dragAnnouncementCancelled', subject))
        return
      }
      const what = describe(moved)
      announce(
        destination.type === 'directory' ?
          getText('dragAnnouncementDroppedInto', what, destination.title)
        : getText('dragAnnouncementDroppedHere', what),
      )
    },
    /** The table refused the drop (the trash and the recent projects take no moves). */
    rejected() {
      if (subject == null) return
      isHandled = true
      announce(getText('dragAnnouncementCancelled', subject))
    },
    /** A drop anywhere in the document, recorded in case the table does not handle it. */
    droppedElsewhere(target: EventTarget | null) {
      if (subject == null) return
      const labelled = target instanceof Element ? target.closest('[aria-label]') : null
      elsewhere = { name: labelled?.getAttribute('aria-label') ?? null }
    },
    /** The drag ended; `dropEffect` is the `dragend` event's. */
    ended(dropEffect: DataTransfer['dropEffect'] | undefined) {
      if (subject == null) return
      if (!isHandled) {
        if (elsewhere?.name != null) {
          announce(getText('dragAnnouncementDroppedOn', subject, elsewhere.name))
        } else if (elsewhere != null || (dropEffect != null && dropEffect !== 'none')) {
          announce(getText('dragAnnouncementDropped', subject))
        } else {
          announce(getText('dragAnnouncementCancelled', subject))
        }
      }
      finish()
    },
  }
}
