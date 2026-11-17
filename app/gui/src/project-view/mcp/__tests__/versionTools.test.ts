import type { SaveVersionOutcome } from '$/providers/localVersioning'
import type { McpToolResult } from 'enso-common/src/mcp'
import { Path } from 'enso-common/src/services/Backend'
import type { VersioningStatus } from 'enso-common/src/services/ProjectManager/types'
import { expect, test, vi } from 'vitest'
import { NOT_ON_SCREEN_ERROR } from '../editSession'
import {
  VERSIONS_NOT_KEPT_ERROR,
  VERSION_COMMENT_LENGTH_ERROR,
  VERSION_COMMENT_LINES_ERROR,
  VERSION_COMMENT_MAX_CHARS,
  VERSION_STATUS_UNKNOWN_ERROR,
  saveVersion,
  type VersionToolDeps,
} from '../versionTools'

const caller = { kind: 'external', name: 'claude-code' } as const

function status(extra: Partial<VersioningStatus> = {}): VersioningStatus {
  return {
    git: true,
    repoRoot: Path('/root'),
    changed: true,
    lastVersion: null,
    blocked: null,
    enabled: true,
    optedOut: false,
    ...extra,
  }
}

function makeDeps(overrides: Partial<VersionToolDeps> = {}) {
  const save = vi.fn<VersionToolDeps['save']>(async () => ({ kind: 'saved' }))
  const deps: VersionToolDeps = {
    caller,
    isActive: () => true,
    status: () => status(),
    save,
    ...overrides,
  }
  return { deps, save }
}

function valueOf(result: McpToolResult): unknown {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return JSON.parse(result.value)
}

function errorOf(result: McpToolResult): string {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

test('saves with the comment and answers saved', async () => {
  const { deps, save } = makeDeps()
  expect(valueOf(await saveVersion(deps, { comment: 'Joined the tables' }))).toEqual({
    saved: true,
  })
  expect(save).toHaveBeenCalledExactlyOnceWith('Joined the tables')
})

test('without a comment, or with a blank one, the version says who saved it', async () => {
  const { deps, save } = makeDeps()
  await saveVersion(deps, {})
  await saveVersion(deps, { comment: '   ' })
  await saveVersion({ ...deps, caller: { kind: 'chat' } }, {})
  expect(save.mock.calls.map((call) => call[0])).toEqual([
    'Saved by claude-code',
    'Saved by claude-code',
    'Saved by the chat',
  ])
})

test('nothing changed answers saved false with the reason', async () => {
  const { deps } = makeDeps({ save: async () => ({ kind: 'nothingToSave' }) })
  expect(valueOf(await saveVersion(deps, {}))).toEqual({
    saved: false,
    reason: 'nothing has changed since the last version',
  })
})

test('a failed save is an error with the reason', async () => {
  const { deps } = makeDeps({
    save: async (): Promise<SaveVersionOutcome> => ({
      kind: 'failed',
      reason: 'index.lock exists',
    }),
  })
  expect(errorOf(await saveVersion(deps, {}))).toBe('Could not save a version: index.lock exists.')
})

test('off screen is refused, and nothing is saved', async () => {
  const { deps, save } = makeDeps({ isActive: () => false })
  expect(errorOf(await saveVersion(deps, {}))).toBe(NOT_ON_SCREEN_ERROR)
  expect(save).not.toHaveBeenCalled()
})

test('a comment of two lines, or over the limit, is refused', async () => {
  const { deps, save } = makeDeps()
  expect(errorOf(await saveVersion(deps, { comment: 'a\nb' }))).toBe(VERSION_COMMENT_LINES_ERROR)
  expect(errorOf(await saveVersion(deps, { comment: 'a\r' }))).toBe(VERSION_COMMENT_LINES_ERROR)
  expect(
    errorOf(await saveVersion(deps, { comment: 'x'.repeat(VERSION_COMMENT_MAX_CHARS + 1) })),
  ).toBe(VERSION_COMMENT_LENGTH_ERROR)
  expect((await saveVersion(deps, { comment: 'x'.repeat(VERSION_COMMENT_MAX_CHARS) })).ok).toBe(
    true,
  )
  expect(save).toHaveBeenCalledOnce()
})

test('an unknown status is refused', async () => {
  const { deps, save } = makeDeps({ status: () => undefined })
  expect(errorOf(await saveVersion(deps, {}))).toBe(VERSION_STATUS_UNKNOWN_ERROR)
  expect(save).not.toHaveBeenCalled()
})

test.each([
  ['no git', status({ git: false, repoRoot: null, enabled: false })],
  ['versions not turned on', status({ enabled: false })],
  ['versions turned off by the user', status({ enabled: false, optedOut: true })],
  ['no repository yet', status({ repoRoot: null, enabled: false })],
])('%s: refused without calling save, so versioning is never turned on', async (_, current) => {
  const { deps, save } = makeDeps({ status: () => current })
  expect(errorOf(await saveVersion(deps, {}))).toBe(VERSIONS_NOT_KEPT_ERROR)
  expect(save).not.toHaveBeenCalled()
})

test('a blocked repository is refused with git’s message', async () => {
  const { deps, save } = makeDeps({ status: () => status({ blocked: 'A merge is in progress' }) })
  expect(errorOf(await saveVersion(deps, {}))).toBe(
    'Versions cannot be saved now: A merge is in progress.',
  )
  expect(save).not.toHaveBeenCalled()
})

test('a repository with nothing changed still saves, so the project is written first', async () => {
  const { deps, save } = makeDeps({ status: () => status({ changed: false }) })
  await saveVersion(deps, {})
  expect(save).toHaveBeenCalledOnce()
})
