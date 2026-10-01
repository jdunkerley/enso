/* eslint-disable vue/one-component-per-file */
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { useQuery } from '@tanstack/vue-query'
import { BackendType, type Backend } from 'enso-common/src/services/Backend'
import { expect, test, vi } from 'vitest'
import { defineComponent, h, inject } from 'vue'
import { useRoute } from 'vue-router'
import { createTestQueryClient, mountWithProviders } from '../mountWithProviders'

// The pattern the helper documents for global stores.
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('../mountWithProviders')
  return {
    useBackends: () =>
      mockBackends({ remoteBackend: { listDirectory: vi.fn<Backend['listDirectory']>() } }),
  }
})

const Probe = defineComponent({
  setup() {
    const { getText } = useText()
    const route = useRoute()
    const backends = useBackends()
    const store = inject<{ value: string }>(Symbol.for('contextStore-probe'))
    const query = useQuery({ queryKey: ['probe'], queryFn: () => Promise.resolve('loaded') })
    return () =>
      h('div', [
        h('p', { id: 'text' }, getText('cloudCategory')),
        h('p', { id: 'route' }, route.path),
        h('p', { id: 'store' }, store?.value),
        h('p', { id: 'backend' }, backends.backendForType(BackendType.remote).type),
        h('p', { id: 'query' }, query.data.value),
      ])
  },
})

test('provides text, router, context stores, mocked backends and a query client', async () => {
  const queryClient = createTestQueryClient()
  const { wrapper, router } = await mountWithProviders(Probe, {
    route: '/drive',
    stores: { probe: { value: 'provided' } },
    queryClient,
  })
  expect(wrapper.find('#text').text()).toBe('Cloud')
  expect(wrapper.find('#route').text()).toBe('/drive')
  expect(router.currentRoute.value.path).toBe('/drive')
  expect(wrapper.find('#store').text()).toBe('provided')
  expect(wrapper.find('#backend').text()).toBe(BackendType.remote)
  expect(wrapper.find('#query').text()).toBe('loaded')
  expect(queryClient.getQueryData(['probe'])).toBe('loaded')
})

test('a backend method the test did not supply does not exist', async () => {
  const { mockBackends } = await import('../mountWithProviders')
  const backends = mockBackends()
  expect(() => backends.backendForType(BackendType.local)).toThrow(/no local backend/)
  expect('listDirectory' in backends.remoteBackend).toBe(false)
})

test('forwards props, attributes and slots, and updates props', async () => {
  const Greeting = defineComponent({
    props: { name: { type: String, required: true } },
    setup(props, { slots }) {
      return () => h('p', [`Hello ${props.name}`, slots.default?.()])
    },
  })
  const { wrapper, setProps } = await mountWithProviders(Greeting, {
    props: { name: 'Ada' },
    attrs: { title: 'greeting' },
    slots: { default: () => '!' },
  })
  expect(wrapper.text()).toBe('Hello Ada!')
  expect(wrapper.attributes('title')).toBe('greeting')
  await setProps({ name: 'Grace' })
  expect(wrapper.text()).toBe('Hello Grace!')
})
