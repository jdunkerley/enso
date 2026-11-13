/** @file The resize handles report the end of a drag, also when they go mid-drag. */
import type { BoundsSet } from '@/util/data/rect'
import { mount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import ResizeHandles from '../ResizeHandles.vue'

/** Mounts the handles with a listener, as a parent would, so that what reaches it is recorded. */
function mountHandles() {
  const reported: BoundsSet[] = []
  const wrapper = mount(ResizeHandles, {
    props: {
      left: true,
      right: true,
      bottom: true,
      'onUpdate:resizing': (resizing: BoundsSet) => reported.push(resizing),
    },
    attachTo: document.body,
  })
  return { wrapper, reported }
}

describe('ResizeHandles', () => {
  test('reports the end of a drag when unmounted while a handle is held', async () => {
    const { wrapper, reported } = mountHandles()
    await wrapper.get('.ResizeHandle.left').trigger('pointerdown', { buttons: 1, pointerId: 1 })
    expect(reported).toEqual([{ left: true, right: false, top: false, bottom: false }])
    wrapper.unmount()
    expect(reported).toEqual([{ left: true, right: false, top: false, bottom: false }, {}])
  })

  test('reports nothing more when unmounted with no drag, or after a finished one', async () => {
    const idle = mountHandles()
    idle.wrapper.unmount()
    expect(idle.reported).toEqual([])

    const finished = mountHandles()
    const handle = finished.wrapper.get('.ResizeHandle.bottom')
    // jsdom has no pointer capture.
    handle.element.releasePointerCapture = () => {}
    await handle.trigger('pointerdown', { buttons: 1, pointerId: 1 })
    await handle.trigger('pointerup', { pointerId: 1 })
    finished.wrapper.unmount()
    expect(finished.reported).toEqual([{ left: false, right: false, top: false, bottom: true }, {}])
  })
})
