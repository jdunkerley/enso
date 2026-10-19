import { parseArgs, withoutDeepLink, withoutInstallerFlags } from '@/configParser'
import { defaultOptions, PASS_TO_WEB } from 'enso-common/src/options'
import { expect, test } from 'vitest'

test('there are no authentication options', () => {
  expect(() => parseArgs(['--authentication.enabled'])).toThrow()
  expect([...PASS_TO_WEB].filter((key) => key.startsWith('authentication.'))).toEqual([])
  expect(parseArgs([])).not.toHaveProperty('authentication')
})

test('a stale `enso://` link launches the IDE with the default options', () => {
  // How an older install's OS registration launches the IDE: the URL as the only argument.
  const args = withoutDeepLink(['enso://auth?code=123'])
  expect(args).toEqual([])
  expect(parseArgs(args)).toEqual(defaultOptions())
  expect(withoutDeepLink(['ENSO://projects/x'])).toEqual([])
})

test('only a sole `enso:` argument is dropped', () => {
  // The headless refusal of a cloud project still sees the value.
  const projectArgs = ['--headless', '--startup.project', 'enso://cloud/project']
  expect(withoutDeepLink(projectArgs)).toEqual(projectArgs)
  expect(parseArgs(withoutDeepLink(projectArgs)).startup.project).toBe('enso://cloud/project')
  expect(withoutDeepLink(['/home/user/project.enso-project'])).toEqual([
    '/home/user/project.enso-project',
  ])
})

test('the relaunch after an update starts the IDE with the default options', () => {
  // The NSIS installer relaunches the IDE with `--updated` after an update installs.
  const args = withoutInstallerFlags(['--updated'])
  expect(args).toEqual([])
  expect(parseArgs(args)).toEqual(defaultOptions())
  expect(withoutInstallerFlags(['--updated', '--no-engine'])).toEqual(['--no-engine'])
})
