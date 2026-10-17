/** @file The map visualization needs the user's Mapbox token, and says where to set it. */
import { mapboxSettingsStore } from '$/providers/mapboxToken'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import GeoMapVisualization from '../GeoMapVisualization.vue'

vi.mock('@/util/visualizationBuiltins', () => ({
  useVisualizationConfig: () => ({
    size: { x: 200, y: 200 },
    setToolbarOverlay: vi.fn(),
  }),
}))

const { getText } = useText()
const MapMock = vi.fn(function (this: Record<string, unknown>) {
  Object.assign(this, {
    on: vi.fn(),
    remove: vi.fn(),
    resize: vi.fn(),
    setTerrain: vi.fn(),
  })
})
const mapboxgl = { Map: MapMock, Popup: vi.fn(() => ({})), accessToken: '' }
const DATA = { df_latitude: [1], df_longitude: [2] }

beforeEach(() => {
  vi.stubGlobal('mapboxgl', mapboxgl)
  mapboxSettingsStore.setState({ accessToken: null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  MapMock.mockClear()
})

describe('the map visualization', () => {
  test('without a token, says maps need one and builds no map', async () => {
    const { wrapper } = await mountWithProviders(GeoMapVisualization, {
      props: { data: DATA },
    })
    expect(wrapper.text()).toContain(getText('mapboxTokenMissing'))
    expect(MapMock).not.toHaveBeenCalled()
  })

  test('the empty state opens Settings on the Local tab', async () => {
    const { wrapper, router } = await mountWithProviders(GeoMapVisualization, {
      props: { data: DATA },
      routes: [
        {
          name: 'settings',
          path: '/settings',
          component: { render: () => null },
        },
      ],
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('settings')
    expect(router.currentRoute.value.query['cloud-ide_SettingsTab']).toBe('"local"')
  })

  test('with a token, builds the map with it, and rebuilds it when the token changes', async () => {
    mapboxSettingsStore.setState({ accessToken: 'pk.one' })
    await mountWithProviders(GeoMapVisualization, { props: { data: DATA } })
    expect(MapMock).toHaveBeenCalledTimes(1)
    expect(mapboxgl.accessToken).toBe('pk.one')
    mapboxSettingsStore.setState({ accessToken: 'pk.two' })
    await flushPromises()
    expect(MapMock).toHaveBeenCalledTimes(2)
    expect(mapboxgl.accessToken).toBe('pk.two')
  })
})
