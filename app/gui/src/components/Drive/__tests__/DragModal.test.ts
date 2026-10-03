/**
 * @file The preview following a drag of assets (#92): what it shows, that it follows the pointer,
 * and that it ends with the drag.
 */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { AssetType, type AnyAsset } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import DragModal from '../DragModal.vue'

const asset = (n: number, type = AssetType.file) =>
  ({ id: `${type}-${n}`, title: `Asset ${n}`, type }) as unknown as AnyAsset

let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
})
afterEach(() => {
  portalRoot.remove()
})

async function mountPreview(assets: readonly AnyAsset[], extra: Record<string, unknown> = {}) {
  const onDragEnd = vi.fn()
  const onClose = vi.fn()
  await mountWithProviders(DragModal, {
    props: { assets, pageX: 100, pageY: 200, onDragEnd, onClose, ...extra },
  })
  const container = portalRoot.querySelector<HTMLElement>('.pointer-events-none > div')
  if (container == null) throw new Error('No preview')
  return { onDragEnd, onClose, container }
}

/** The titles shown, top of the stack last, as they are drawn. */
const titles = () =>
  [...portalRoot.querySelectorAll('.h-\\[34px\\]')].map((row) => row.textContent?.trim())

/** A drag event with a page position (jsdom's `DragEvent` takes none, so it is a mouse event). */
function dragEvent(type: string, pageX: number, pageY: number) {
  const event = new MouseEvent(type, { bubbles: true })
  Object.defineProperties(event, { pageX: { value: pageX }, pageY: { value: pageY } })
  return event
}

describe('DragModal', () => {
  test('shows up to three assets, the first on top, and counts them all', async () => {
    await mountPreview([asset(1), asset(2), asset(3), asset(4)])
    expect(titles()).toEqual(['Asset 3', 'Asset 2', 'Asset 1'])
    expect(portalRoot.textContent).toContain('4')
  })

  test('the badge can be hidden', async () => {
    await mountPreview([asset(1)], { hideBadge: true })
    expect(portalRoot.querySelectorAll('.rounded-full')).toHaveLength(0)
  })

  test('starts up and to the left of the pointer, and follows it', async () => {
    const { container } = await mountPreview([asset(1)])
    expect([container.style.left, container.style.top]).toEqual(['84px', '184px'])
    document.dispatchEvent(dragEvent('drag', 300, 400))
    await vi.waitFor(() => expect(container.style.left).toBe('284px'))
    expect(container.style.top).toBe('384px')
    // Chromium's last `drag` event reports 0, 0; it is ignored.
    document.dispatchEvent(dragEvent('drag', 0, 0))
    expect([container.style.left, container.style.top]).toEqual(['284px', '384px'])
    // Firefox reports the position on `dragover`.
    document.dispatchEvent(dragEvent('dragover', 50, 60))
    await vi.waitFor(() => expect(container.style.left).toBe('34px'))
  })

  test('the end of the drag calls `onDragEnd`, and closes it', async () => {
    const { onDragEnd, onClose } = await mountPreview([asset(1)])
    document.dispatchEvent(dragEvent('dragend', 0, 0))
    expect(onDragEnd).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
