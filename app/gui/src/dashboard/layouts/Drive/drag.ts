/**
 * @file The drag payload of rows dragged from the drive's table, on native drag events: the Vue
 * port of React's `#/utilities/drag`. The rows travel in two forms: this in-page payload (looked up
 * by an id carried in a MIME type of the drag), which the table's rows and drop zone read, and the
 * serialisable `ASSETS_MIME_TYPE` one (`$/utils/assetsDataTransfer`), which the category buttons
 * read.
 */
import type { Category } from '$/providers/category'
import type { AnyAsset, AssetId } from 'enso-common/src/services/Backend'
import { uniqueString } from 'enso-common/src/utilities/uniqueString'

/** A transparent one-pixel GIF. */
const BLANK_IMAGE_SRC =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/** Set the drag image to blank, so that the drag preview (`DragModal.vue`) is all that shows. */
export function setDragImageToBlank(event: DragEvent) {
  const image = new Image()
  image.src = BLANK_IMAGE_SRC
  event.dataTransfer?.setDragImage(image, 0, 0)
}

/** Associates drag events with payload data. */
class DragPayloadManager<Payload> {
  readonly regex: RegExp
  readonly map = new Map<string, Payload>()
  readonly reverseMap = new Map<Payload, string>()
  /** Create a {@link DragPayloadManager}. */
  constructor(public mimetype: string) {
    this.regex = new RegExp('^' + mimetype + '; id=(.+)$')
  }

  /** The payload associated with a drag event, if any. */
  lookup(event: DragEvent) {
    const item = Array.from(event.dataTransfer?.items ?? []).find((dataTransferItem) =>
      dataTransferItem.type.startsWith(this.mimetype),
    )
    const id = item?.type.match(this.regex)?.[1] ?? null
    return id != null ? (this.map.get(id) ?? null) : null
  }

  /** Associate data with a drag event. */
  bind(event: DragEvent, payload: Payload) {
    const id = uniqueString()
    event.dataTransfer?.setData(`${this.mimetype}; id=${id}`, JSON.stringify(payload))
    this.map.set(id, payload)
    this.reverseMap.set(payload, id)
  }

  /** Dissociate data from its drag event. */
  unbind(payload: Payload) {
    const id = this.reverseMap.get(payload)
    this.reverseMap.delete(payload)
    if (id != null) {
      this.map.delete(id)
    }
  }
}

/** One dragged row. */
interface AssetRowsDragPayloadItem {
  readonly key: AssetId
  readonly asset: AnyAsset
}

/** The rows dragged from the drive's table. */
export interface AssetRowsDragPayload {
  readonly category: Category
  readonly items: readonly AssetRowsDragPayloadItem[]
}

export const ASSET_ROWS = new DragPayloadManager<AssetRowsDragPayload>(
  'application/x-enso-asset-list',
)
