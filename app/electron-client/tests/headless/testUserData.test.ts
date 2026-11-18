import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { useTestUserDataDirectory } from '../../src/testUserData'

function fakeApp() {
  const paths: Record<string, string> = {}
  return { paths, setPath: (name: string, value: string) => void (paths[name] = value) }
}

describe('useTestUserDataDirectory', () => {
  test('sets userData to the absolute directory named', () => {
    const app = fakeApp()
    const directory = path.resolve('some', 'dir')
    expect(useTestUserDataDirectory(app, { ENSO_TEST_USER_DATA_DIR: directory })).toBe(true)
    expect(app.paths).toEqual({ userData: directory })
  })
  test.each([undefined, ''])('does nothing when the variable is %j', (value) => {
    const app = fakeApp()
    expect(useTestUserDataDirectory(app, { ENSO_TEST_USER_DATA_DIR: value })).toBe(false)
    expect(app.paths).toEqual({})
  })
  test('refuses a relative path', () => {
    const app = fakeApp()
    expect(() => useTestUserDataDirectory(app, { ENSO_TEST_USER_DATA_DIR: 'rel/dir' })).toThrow(
      'absolute',
    )
    expect(app.paths).toEqual({})
  })
})
