/** @file The "Pre-start the engine" setting is on unless a valid saved value says otherwise. */
import { spareEngineSettingsStore } from '$/providers/spareEngineSettings'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const KEY = 'enso-spare-engine-settings'

beforeEach(() => {
  spareEngineSettingsStore.setState({ preStart: true })
  localStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

test('defaults to on with nothing saved', () => {
  spareEngineSettingsStore.rehydrate()
  expect(spareEngineSettingsStore.getState().preStart).toBe(true)
})

test('loads a saved off', () => {
  localStorage.setItem(KEY, JSON.stringify({ state: { preStart: false }, version: 1 }))
  spareEngineSettingsStore.rehydrate()
  expect(spareEngineSettingsStore.getState().preStart).toBe(false)
})

test('defaults to on under malformed JSON', () => {
  localStorage.setItem(KEY, '{not json')
  spareEngineSettingsStore.rehydrate()
  expect(spareEngineSettingsStore.getState().preStart).toBe(true)
})

test('defaults to on under a wrongly typed value', () => {
  localStorage.setItem(KEY, JSON.stringify({ state: { preStart: 'x' }, version: 1 }))
  spareEngineSettingsStore.rehydrate()
  expect(spareEngineSettingsStore.getState().preStart).toBe(true)
})

test('defaults to on when reading storage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  spareEngineSettingsStore.rehydrate()
  expect(spareEngineSettingsStore.getState().preStart).toBe(true)
})
