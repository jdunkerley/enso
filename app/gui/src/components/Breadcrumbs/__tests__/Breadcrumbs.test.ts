/** @file The Vue `Breadcrumbs`: the current item, pressing items, dropping onto them. */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import { h } from 'vue'
import BreadcrumbItem from '../BreadcrumbItem.vue'
import Breadcrumbs from '../Breadcrumbs.vue'

usePrimitiveTestEnvironment()

function mountTrail() {
  const onAction = vi.fn()
  const onDrop = vi.fn()
  mountWithProviders(() =>
    h(Breadcrumbs, { testId: 'trail', onAction, onDrop }, () =>
      ['Home', 'Projects', 'Report'].map((name) =>
        h(BreadcrumbItem, { id: name, key: name, testId: name, icon: 'folder' }, () => name),
      ),
    ),
  )
  return { onAction, onDrop }
}

test('the last item is the current page, the others are buttons', () => {
  mountTrail()
  expect(byTestId('trail')!.tagName).toBe('OL')
  const current = byTestId('Report')!.querySelector('[aria-current="page"]')!
  expect(current.textContent).toContain('Report')
  expect(byTestId('Report')!.querySelector('button')).toBeNull()
  expect(byTestId('Home')!.querySelector('button')!.textContent).toContain('Home')
  expect(byTestId('Home')!.querySelector('[aria-current]')).toBeNull()
  // A chevron between each item; `last:hidden` hides the final one.
  expect(byTestId('trail')!.querySelectorAll(':scope > svg')).toHaveLength(3)
})

test('pressing an item reports its id', async () => {
  const { onAction } = mountTrail()
  await userEvent.setup().click(byTestId('Projects')!.querySelector('button')!)
  expect(onAction).toHaveBeenCalledExactlyOnceWith('Projects')
})

test('dropping onto an item reports its id and the event', async () => {
  const { onDrop } = mountTrail()
  const item = byTestId('Home')!
  const dragOver = new Event('dragover', { cancelable: true, bubbles: true })
  item.dispatchEvent(dragOver)
  await flushPromises()
  expect(dragOver.defaultPrevented).toBe(true)
  expect(item.getAttribute('data-drop-target')).toBe('true')
  item.dispatchEvent(new Event('drop', { cancelable: true, bubbles: true }))
  await flushPromises()
  expect(onDrop).toHaveBeenCalledOnce()
  expect(onDrop.mock.calls[0]![0]).toBe('Home')
  expect(item.getAttribute('data-drop-target')).toBe('false')
})

test("Enter on an item's focusable container presses it, calling its own onPress too", async () => {
  const onAction = vi.fn()
  const onPress = vi.fn()
  mountWithProviders(() =>
    h(Breadcrumbs, { testId: 'trail', onAction }, () => [
      h(BreadcrumbItem, { id: 'Home', key: 'Home', testId: 'Home', onPress }, () => 'Home'),
      h(BreadcrumbItem, { id: 'Report', key: 'Report', testId: 'Report' }, () => 'Report'),
    ]),
  )
  const container = byTestId('Home')!.querySelector<HTMLElement>('[role="link"]')!
  expect(container.tabIndex).toBe(0)
  container.focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(onAction).toHaveBeenCalledExactlyOnceWith('Home')
  expect(onPress).toHaveBeenCalledOnce()
})

test('isLoading shows the spinner in place of the icon', async () => {
  mountWithProviders(() =>
    h(Breadcrumbs, { testId: 'trail' }, () => [
      h(
        BreadcrumbItem,
        { id: 'Home', key: 'Home', testId: 'Home', icon: 'folder', isLoading: true },
        () => 'Home',
      ),
      h(BreadcrumbItem, { id: 'Report', key: 'Report', testId: 'Report' }, () => 'Report'),
    ]),
  )
  await flushPromises()
  expect(byTestId('Home')!.querySelector('button')!.getAttribute('aria-busy')).toBe('true')
})
