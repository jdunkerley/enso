import FilePathInput from '$/datalinks/FilePathInput.vue'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, test, vi } from 'vitest'

const openFileBrowser = vi.fn(async () => ['/data/input.csv'])
afterEach(() => {
  delete (window as { api?: unknown }).api
  openFileBrowser.mockClear()
})

test('Browse… sets the path from the system file dialog', async () => {
  Object.defineProperty(window, 'api', {
    value: { fileBrowser: { openFileBrowser } },
    configurable: true,
  })
  const { wrapper } = await mountWithProviders(FilePathInput, {
    props: { value: '/old.csv' },
  })
  await wrapper.get('button[data-testid="file-path-browse"]').trigger('click')
  await flushPromises()
  expect(openFileBrowser).toHaveBeenCalledWith('file', '/old.csv')
  expect(wrapper.emitted('change')).toEqual([['/data/input.csv']])
})

test('without the desktop app, there is no Browse… button', async () => {
  const { wrapper } = await mountWithProviders(FilePathInput, {
    props: { value: '' },
  })
  expect(wrapper.find('button[data-testid="file-path-browse"]').exists()).toBe(false)
})

test('read-only, there is no Browse… button, even in the desktop app', async () => {
  Object.defineProperty(window, 'api', {
    value: { fileBrowser: { openFileBrowser } },
    configurable: true,
  })
  const { wrapper } = await mountWithProviders(FilePathInput, {
    props: { value: '/old.csv', readOnly: true },
  })
  expect(wrapper.find('button[data-testid="file-path-browse"]').exists()).toBe(false)
  expect(wrapper.get('input').attributes('readonly')).toBeDefined()
})
