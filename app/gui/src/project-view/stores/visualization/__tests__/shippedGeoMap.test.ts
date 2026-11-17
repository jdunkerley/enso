/** @file The Geo Map that Standard.Visualization ships needs the user's Mapbox token, and says where to set it. */
import { mapboxSettingsStore } from '$/providers/mapboxToken'
import { useText } from '$/providers/text'
import { replayPrivacyOptions } from '$/utils/redact'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { pinnedDir } from '@/components/visualizations/__tests__/pinnedGoldens'
import { flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import GeoMapVisualization, {
  boundingBox,
  dataType,
  defaultPreprocessor,
  name,
  toGeoJSONs,
} from '../../../../../../../distribution/lib/Standard/Visualization/0.0.0-dev/visualizations/Geo_Map.vue'

vi.mock('@/util/visualizationBuiltins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/util/visualizationBuiltins')>()),
  useVisualizationConfig: () => ({
    size: { x: 200, y: 200 },
    setToolbarOverlay: vi.fn(),
  }),
}))

const appRouter = vi.hoisted(() => ({
  push: vi.fn(() => Promise.resolve()),
  currentRoute: { value: { query: { other: '1' } } },
}))
vi.mock('$/router', () => ({ default: appRouter }))

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

  // A visualization renders in a custom element, a Vue app without the router plugin, so the
  // button must reach the app's router instance rather than inject one.
  test('the empty state opens Settings on the Local tab, with no router injected', async () => {
    const { wrapper } = await mountWithProviders(GeoMapVisualization, { props: { data: DATA } })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(appRouter.push).toHaveBeenCalledWith({
      name: 'settings',
      query: { other: '1', 'cloud-ide_SettingsTab': '"local"' },
    })
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

  test.each([{}, [1, 2], 5, null])(
    'data that is not a map (%j) shows the empty map',
    async (data) => {
      mapboxSettingsStore.setState({ accessToken: 'pk.one' })
      await mountWithProviders(GeoMapVisualization, { props: { data: data as never } })
      expect(MapMock).toHaveBeenCalledTimes(1)
    },
  )

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

test('it is the Geo Map view of anything that converts to Viz_Table', () => {
  expect(name).toBe('Geo Map')
  expect(dataType).toBe('Standard.Visualization.Viz_Table.Viz_Table')
  expect(defaultPreprocessor).toEqual(['Standard.Visualization.Geo_Map', 'process_to_json_text'])
})

describe('the bounding box (in place of @turf/bbox)', () => {
  const golden = (file: string) => JSON.parse(readFileSync(path.join(pinnedDir, file), 'utf8'))

  test('of a table of places is the box around them', () => {
    expect(toGeoJSONs(golden('geo_mem_table.json')).map(boundingBox)).toEqual([
      [-0.1, 48.8, 2.3, 51.5],
    ])
  })

  test('of values that are not a map is nothing', () => {
    expect(toGeoJSONs(golden('geo_vector.json'))).toEqual([])
    expect(toGeoJSONs(golden('geo_mem_table_nothing_known.json'))).toEqual([])
    expect(toGeoJSONs(golden('geo_connection.json'))).toEqual([])
  })

  test('covers points, lines, polygons and collections, ignoring heights', () => {
    expect(
      boundingBox({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [1, 2, 99] },
          {
            type: 'LineString',
            coordinates: [
              [-3, 4],
              [5, -6],
            ],
          },
          {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 7],
                [0, 0],
              ],
            ],
          },
        ],
      }),
    ).toEqual([-3, -6, 10, 7])
    expect(
      boundingBox({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [4, 5] } }],
      }),
    ).toEqual([4, 5, 4, 5])
  })

  test('of an empty layer is undefined, so the map is not fitted to it', () => {
    expect(boundingBox({ type: 'FeatureCollection', features: [] })).toBeUndefined()
    expect(boundingBox({ type: 'Feature', geometry: null })).toBeUndefined()
  })
})
