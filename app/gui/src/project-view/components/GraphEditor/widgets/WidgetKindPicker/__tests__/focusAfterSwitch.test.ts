import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import { FOCUS_AFTER_SWITCH_MS, focusAfterSwitch, takesFocusAfterSwitch } from '../focusAfterSwitch'

const integer = { label: 'Integer', config: { kind: 'Numeric_Input' } } as const
const text = { label: 'Text', config: { kind: 'Text_Input' } } as const
const nothing = { label: 'Nothing', config: null } as const
const kinds = [integer, text, nothing]
const node = 'node-1'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  // Leave nothing waiting for the next test.
  vi.advanceTimersByTime(FOCUS_AFTER_SWITCH_MS)
  vi.useRealTimers()
})

test('the new button of the switched chip takes the focus, once', () => {
  focusAfterSwitch({ node, kinds, kind: nothing }, undefined)
  expect(takesFocusAfterSwitch({ node, kinds, kind: nothing })).toBe(true)
  expect(takesFocusAfterSwitch({ node, kinds, kind: nothing })).toBe(false)
})

test('another chip of the same node does not take it', () => {
  focusAfterSwitch({ node, kinds, kind: nothing }, undefined)
  // Another argument's chip, of other kinds or showing another kind, mounting its button now.
  expect(takesFocusAfterSwitch({ node, kinds: [text, nothing], kind: nothing })).toBe(false)
  expect(takesFocusAfterSwitch({ node, kinds, kind: integer })).toBe(false)
  expect(takesFocusAfterSwitch({ node: 'node-2', kinds, kind: nothing })).toBe(false)
  // The switched chip, its union arriving as new objects after the edit.
  expect(takesFocusAfterSwitch({ node, kinds: [...kinds], kind: { ...nothing } })).toBe(true)
})

test('the wait ends after its window', () => {
  focusAfterSwitch({ node, kinds, kind: nothing }, undefined)
  vi.advanceTimersByTime(FOCUS_AFTER_SWITCH_MS)
  expect(takesFocusAfterSwitch({ node, kinds, kind: nothing })).toBe(false)
})

test('a button the edit kept leaves nothing waiting', async () => {
  const button = document.createElement('button')
  document.body.append(button)
  focusAfterSwitch({ node, kinds, kind: text }, button)
  await nextTick()
  // A chip of the same kinds elsewhere in the node, showing Text, mounts its button: no steal.
  expect(takesFocusAfterSwitch({ node, kinds, kind: text })).toBe(false)
  button.remove()
})

test('a button the edit removed leaves the wait for its successor', async () => {
  const button = document.createElement('button') // not in the document: replaced by the edit
  focusAfterSwitch({ node, kinds, kind: nothing }, button)
  await nextTick()
  expect(takesFocusAfterSwitch({ node, kinds, kind: nothing })).toBe(true)
})
