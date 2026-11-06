import { Path } from 'enso-common/src/services/Backend'
import { newProjectId } from 'enso-common/src/services/LocalBackend'
import { afterEach, describe, expect, test } from 'vitest'
import { saveShortcutInScope } from '../saveShortcutScope'

const PROJECT = newProjectId(Path('/root/P'))
const OTHER = newProjectId(Path('/root/Q'))

function mount(html: string) {
  document.body.innerHTML = html
  return document.getElementById('target')!
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('saveShortcutInScope', () => {
  test('acts anywhere in the project view: the graph, the code editor, nothing focused', () => {
    const graph = mount('<div class="GraphEditor"><div id="target"></div></div>')
    expect(saveShortcutInScope(graph, PROJECT, undefined)).toBe(true)
    const editor = mount('<div contenteditable id="target"></div>')
    expect(saveShortcutInScope(editor, PROJECT, undefined)).toBe(true)
    expect(saveShortcutInScope(document.body, PROJECT, undefined)).toBe(true)
    expect(saveShortcutInScope(null, PROJECT, undefined)).toBe(true)
  })

  test('acts in the right panel while it is about this project', () => {
    const target = mount(
      '<div data-panel-side="right"><div id="target" contenteditable></div></div>',
    )
    expect(saveShortcutInScope(target, PROJECT, PROJECT)).toBe(true)
  })

  test('does not act in a right panel about something else, or without a project', () => {
    const target = mount(
      '<div data-panel-side="right"><div id="target" contenteditable></div></div>',
    )
    expect(saveShortcutInScope(target, PROJECT, OTHER)).toBe(false)
    expect(saveShortcutInScope(target, PROJECT, undefined)).toBe(false)
  })

  test('does not act in the command palette, the component browser or the tab bar', () => {
    for (const part of ['CommandPalette', 'ComponentBrowser', 'TabBar']) {
      const target = mount(`<div class="${part}" data-no-save-shortcut><input id="target" /></div>`)
      expect(saveShortcutInScope(target, PROJECT, PROJECT)).toBe(false)
    }
  })

  test('does not act in the left panel (the drive), the left bar included', () => {
    const bar = mount('<div data-panel-side="left"><button id="target"></button></div>')
    expect(saveShortcutInScope(bar, PROJECT, PROJECT)).toBe(false)
  })

  test('does not act in the left panel (the drive)', () => {
    const target = mount('<div data-panel-side="left"><div id="target"></div></div>')
    expect(saveShortcutInScope(target, PROJECT, PROJECT)).toBe(false)
  })
})
