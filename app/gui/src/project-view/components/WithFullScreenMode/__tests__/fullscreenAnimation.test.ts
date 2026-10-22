import { expect, test } from 'vitest'
import { fullscreenBox } from '../fullscreenAnimation'

test('by default, fullscreen content fills the whole fullscreen root', () => {
  expect(fullscreenBox(undefined)).toEqual({
    top: '0px',
    left: '0px',
    height: '100%',
    width: '100%',
  })
})

test('with an inset, fullscreen content fills the fullscreen root below it', () => {
  expect(fullscreenBox('var(--top-bar-height)')).toEqual({
    top: 'var(--top-bar-height)',
    left: '0px',
    height: 'calc(100% - var(--top-bar-height))',
    width: '100%',
  })
})
