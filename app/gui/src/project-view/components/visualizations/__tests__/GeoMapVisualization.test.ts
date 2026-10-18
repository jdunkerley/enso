/** @file The map visualization needs the user's Mapbox token, and says where to set it. */
import { mapboxSettingsStore } from '$/providers/mapboxToken'
import { useText } from '$/providers/text'
import { replayPrivacyOptions } from '$/utils/redact'
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
// eslint-disable-next-line camelcase
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

  test('with a token, builds the map with it; rebuilds it when the token changes; removes it when cleared', async () => {
    mapboxSettingsStore.setState({ accessToken: 'pk.one' })
    const { wrapper } = await mountWithProviders(GeoMapVisualization, { props: { data: DATA } })
    expect(MapMock).toHaveBeenCalledTimes(1)
    expect(MapMock.mock.calls[0]?.[0]).toMatchObject({ accessToken: 'pk.one' })
    mapboxSettingsStore.setState({ accessToken: 'pk.two' })
    await flushPromises()
    expect(MapMock).toHaveBeenCalledTimes(2)
    expect(MapMock.mock.calls[1]?.[0]).toMatchObject({ accessToken: 'pk.two' })
    expect(MapMock.mock.instances[0].remove).toHaveBeenCalledTimes(1)
    expect(MapMock.mock.instances[1].remove).not.toHaveBeenCalled()
    mapboxSettingsStore.setState({ accessToken: null })
    await flushPromises()
    expect(wrapper.text()).toContain(getText('mapboxTokenMissing'))
    expect(MapMock.mock.instances[1].remove).toHaveBeenCalledTimes(1)
    expect(MapMock).toHaveBeenCalledTimes(2)
  })

  test('the map is not recorded by Sentry Replay', async () => {
    mapboxSettingsStore.setState({ accessToken: 'pk.one' })
    const { wrapper } = await mountWithProviders(GeoMapVisualization, { props: { data: DATA } })
    const map = wrapper.get('.GeoMapVisualization').element
    expect(map.hasAttribute('data-sentry-block')).toBe(true)
    expect(map.matches(replayPrivacyOptions.block.join(','))).toBe(true)
  })

  test('logs map errors with the token redacted', async () => {
    mapboxSettingsStore.setState({ accessToken: 'pk.secret' })
    await mountWithProviders(GeoMapVisualization, { props: { data: DATA } })
    const onError = (MapMock.mock.instances[0].on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([name]) => name === 'error',
    )?.[1]
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    onError({
      error: new Error(
        'AJAXError: Forbidden (403): https://api.mapbox.com/s?access_token=pk.secret',
      ),
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('pk.secret')
    log.mockRestore()
  })
})
