/* eslint-disable camelcase -- tool argument and result names are snake_case on the wire */
import type { McpToolResult } from 'enso-common/src/mcp'
import { describe, expect, test, vi } from 'vitest'
import {
  appToolHandlers,
  isAllowedPath,
  MAX_ENTRIES,
  NAME_CHARS,
  NO_PROJECT_AT_PATH_ERROR,
  NO_PROJECT_ON_SCREEN_ERROR,
  STILL_OPENING_ERROR,
  type AppToolDeps,
  type DirectoryEntry,
} from '../appTools'

describe('isAllowedPath on Windows', () => {
  const roots = ['C:/Users/me/Drive']
  test.each([
    ['the root itself', 'C:/Users/me/Drive', true],
    ['the root with backslashes', 'C:\\Users\\me\\Drive', true],
    ['the root with a trailing separator', 'C:/Users/me/Drive/', true],
    ['the root with a trailing backslash', 'C:\\Users\\me\\Drive\\', true],
    ['a child', 'C:/Users/me/Drive/Project_1', true],
    ['a grandchild with mixed slashes', 'C:\\Users/me\\Drive/a\\b', true],
    ['a child in other case', 'c:\\users\\ME\\drive\\Project_1', true],
    ['a `.` segment', 'C:/Users/me/Drive/./a', true],
    ['a `..` that stays inside', 'C:/Users/me/Drive/a/../b', true],
    ['a doubled separator', 'C:/Users/me/Drive//a', true],
    ['`<root>/../other`', 'C:/Users/me/Drive/../other', false],
    ['`<root>\\..\\other`', 'C:\\Users\\me\\Drive\\..\\other', false],
    ['`..` back into the root', 'C:/Users/me/Drive/../Drive/a', true],
    ['`..` above the drive', 'C:/../../Users/me/Drive', false],
    ['a sibling starting with the root name', 'C:/Users/me/Drive2', false],
    ['a child of that sibling', 'C:\\Users\\me\\Drive2\\a', false],
    ['the parent', 'C:/Users/me', false],
    ['another drive', 'D:/Users/me/Drive', false],
    ['a UNC path', '\\\\server\\share\\Users\\me\\Drive', false],
    ['a forward-slash UNC path', '//server/share/Users/me/Drive', false],
    ['a device path', '\\\\?\\C:\\Users\\me\\Drive', false],
    ['an empty string', '', false],
    ['a relative path', 'Drive/a', false],
    ['a dot-relative path', './a', false],
    ['a drive-relative path', 'C:Users/me/Drive', false],
    ['a path from the current drive root', '/Users/me/Drive', false],
    ['a segment ending in a dot', 'C:/Users/me/Drive/a./b', false],
    ['a segment of three dots', 'C:/Users/me/Drive/.../x', false],
    ['a segment ending in a space', 'C:/Users/me/Drive/.. /x', false],
    ['a NUL character', 'C:/Users/me/Drive/a\0b', false],
  ])('%s', (_name, path, allowed) => {
    expect(isAllowedPath(path, roots)).toBe(allowed)
  })

  test('a root with a trailing separator', () => {
    expect(isAllowedPath('C:/Drive/a', ['C:/Drive/'])).toBe(true)
    expect(isAllowedPath('C:/Drive2', ['C:\\Drive\\'])).toBe(false)
  })

  test('a drive root', () => {
    expect(isAllowedPath('C:/anything', ['C:/'])).toBe(true)
    expect(isAllowedPath('D:/anything', ['C:\\'])).toBe(false)
  })

  test('a UNC root', () => {
    const uncRoots = ['\\\\server\\share\\Drive']
    expect(isAllowedPath('//server/share/Drive/a', uncRoots)).toBe(true)
    expect(isAllowedPath('\\\\SERVER\\Share\\drive', uncRoots)).toBe(true)
    expect(isAllowedPath('\\\\server\\share\\Drive2', uncRoots)).toBe(false)
    expect(isAllowedPath('\\\\server\\other\\Drive', uncRoots)).toBe(false)
    expect(isAllowedPath('\\\\server\\share\\Drive\\..\\..\\x', uncRoots)).toBe(false)
    expect(isAllowedPath('C:/Drive', uncRoots)).toBe(false)
  })

  test('only ASCII letters compare case-insensitively', () => {
    // The Kelvin sign lower-cases to `k`, but NTFS does not take it for `K`.
    expect(isAllowedPath('C:/\u212Adrive/x', ['C:/Kdrive'])).toBe(false)
    expect(isAllowedPath('C:/kdrive/x', ['C:/Kdrive'])).toBe(true)
  })

  test('a saved folder is a root too', () => {
    expect(isAllowedPath('E:/Data/x.csv', ['C:/Drive', 'E:/Data'])).toBe(true)
    expect(isAllowedPath('E:/Other', ['C:/Drive', 'E:/Data'])).toBe(false)
  })
})

describe('isAllowedPath on POSIX', () => {
  const roots = ['/home/me/enso']
  test.each([
    ['the root itself', '/home/me/enso', true],
    ['the root with a trailing separator', '/home/me/enso/', true],
    ['a child', '/home/me/enso/Project_1', true],
    ['`<root>/../other`', '/home/me/enso/../other', false],
    ['a sibling starting with the root name', '/home/me/enso2', false],
    ['a different case', '/home/me/Enso', false],
    ['an empty string', '', false],
    ['a relative path', 'enso/a', false],
    ['a Windows path', 'C:/home/me/enso', false],
    ['a backslash is part of a name', '/home/me/enso\\..\\x', false],
    ['a backslash inside the root is a name', '/home/me/enso/a\\..\\..\\x', true],
    ['`..` above /', '/../home/me/enso', false],
    ['a doubled separator', '//home/me/enso', true],
  ])('%s', (_name, path, allowed) => {
    expect(isAllowedPath(path, roots)).toBe(allowed)
  })

  test('the filesystem root as a root', () => {
    expect(isAllowedPath('/anything', ['/'])).toBe(true)
  })

  test('no roots allow nothing', () => {
    expect(isAllowedPath('/home/me/enso', [])).toBe(false)
  })
})

// === The tools ===

const ROOT = '/home/me/enso'
const OUTSIDE = `That folder is outside the Drive. Use a path under ${ROOT} (or a saved local folder).`

function project(name: string, open = false): DirectoryEntry {
  return { name, path: `${ROOT}/${name}`, kind: 'project', open }
}

function makeDeps(overrides: Partial<AppToolDeps> = {}): AppToolDeps {
  const listings: Record<string, DirectoryEntry[]> = {
    [ROOT]: [
      project('Alpha', true),
      { name: 'data', path: `${ROOT}/data`, kind: 'folder' },
      { name: 'cars.csv', path: `${ROOT}/cars.csv`, kind: 'file', bytes: 1234 },
      project('Beta'),
    ],
    '/mnt/saved': [project('Saved_One')],
  }
  return {
    rootDirectory: () => ROOT,
    savedDirectories: () => ['/mnt/saved'],
    listDirectory: vi.fn(async (path: string) => {
      const listing = listings[path]
      if (listing == null) throw new Error(`Could not find folder at '${path}'`)
      return listing
    }),
    createProject: vi.fn(async (name: string, directory: string) => ({
      name,
      path: `${directory}/${name}`,
    })),
    openProject: vi.fn(async () => true),
    closeCurrentProject: vi.fn(async () => true),
    state: () => ({
      page: 'project',
      project: { name: 'Alpha', path: `${ROOT}/Alpha` },
      openProjects: [{ name: 'Alpha', path: `${ROOT}/Alpha` }],
    }),
    ...overrides,
  }
}

async function run(deps: AppToolDeps, tool: string, args: Record<string, unknown> = {}) {
  const handler = appToolHandlers(() => deps)[tool]
  if (handler == null) throw new Error(`no handler ${tool}`)
  return handler(args, { kind: 'external', name: 'claude-code' })
}

function value(result: McpToolResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return JSON.parse(result.value)
}

test('The handlers are the six app tools', () => {
  expect(Object.keys(appToolHandlers(() => makeDeps())).sort()).toEqual([
    'close_project',
    'create_project',
    'get_app_state',
    'list_files',
    'list_projects',
    'open_project',
  ])
})

describe('get_app_state', () => {
  test('reports the page, the project on screen, the open projects and the Drive root', async () => {
    expect(value(await run(makeDeps(), 'get_app_state'))).toEqual({
      page: 'project',
      project: { name: 'Alpha', path: `${ROOT}/Alpha` },
      open_projects: [{ name: 'Alpha', path: `${ROOT}/Alpha` }],
      drive_root: ROOT,
    })
  })

  test('on the dashboard there is no project', async () => {
    const deps = makeDeps({ state: () => ({ page: 'dashboard', project: null, openProjects: [] }) })
    expect(value(await run(deps, 'get_app_state'))).toEqual({
      page: 'dashboard',
      project: null,
      open_projects: [],
      drive_root: ROOT,
    })
  })

  test('cuts long project names', async () => {
    const long = 'x'.repeat(NAME_CHARS + 50)
    const deps = makeDeps({
      state: () => ({
        page: 'project',
        project: { name: long, path: '/p' },
        openProjects: [{ name: long, path: '/p' }],
      }),
    })
    const state = value(await run(deps, 'get_app_state'))
    expect(state.project.name).toBe('x'.repeat(NAME_CHARS) + '…')
    expect(state.open_projects[0].name).toBe('x'.repeat(NAME_CHARS) + '…')
  })
})

describe('list_projects', () => {
  test('lists the projects of the Drive root by default', async () => {
    expect(value(await run(makeDeps(), 'list_projects'))).toEqual({
      directory: ROOT,
      projects: [
        { name: 'Alpha', path: `${ROOT}/Alpha`, open: true },
        { name: 'Beta', path: `${ROOT}/Beta`, open: false },
      ],
    })
  })

  test('lists a saved local folder', async () => {
    expect(value(await run(makeDeps(), 'list_projects', { directory: '/mnt/saved/' }))).toEqual({
      directory: '/mnt/saved',
      projects: [{ name: 'Saved_One', path: `${ROOT}/Saved_One`, open: false }],
    })
  })

  test('refuses a folder outside the Drive, without listing it', async () => {
    const deps = makeDeps()
    expect(await run(deps, 'list_projects', { directory: `${ROOT}/../secrets` })).toEqual({
      ok: false,
      error: OUTSIDE,
    })
    expect(deps.listDirectory).not.toHaveBeenCalled()
  })

  test('a folder that cannot be listed is an error', async () => {
    const result = await run(makeDeps(), 'list_projects', { directory: `${ROOT}/missing` })
    expect(result).toEqual({
      ok: false,
      error: `Could not list that folder: Could not find folder at '${ROOT}/missing'`,
    })
  })

  test('refuses a directory that is not a string', async () => {
    expect(await run(makeDeps(), 'list_projects', { directory: 3 })).toEqual({
      ok: false,
      error: 'The argument `directory` must be a string.',
    })
  })
})

describe('list_files', () => {
  test('lists every entry, with the size of files', async () => {
    expect(value(await run(makeDeps(), 'list_files'))).toEqual({
      directory: ROOT,
      entries: [
        { name: 'Alpha', path: `${ROOT}/Alpha`, kind: 'project' },
        { name: 'data', path: `${ROOT}/data`, kind: 'folder' },
        { name: 'cars.csv', path: `${ROOT}/cars.csv`, kind: 'file', bytes: 1234 },
        { name: 'Beta', path: `${ROOT}/Beta`, kind: 'project' },
      ],
    })
  })

  test(`gives at most ${MAX_ENTRIES} entries, then says it cut the list`, async () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({
      name: `f${i}`,
      path: `${ROOT}/f${i}`,
      kind: 'file' as const,
    }))
    const result = value(await run(makeDeps({ listDirectory: async () => many }), 'list_files'))
    expect(result.entries).toHaveLength(MAX_ENTRIES)
    expect(result.truncated).toBe(true)
    const exactly = many.slice(0, MAX_ENTRIES)
    const full = value(await run(makeDeps({ listDirectory: async () => exactly }), 'list_files'))
    expect(full.entries).toHaveLength(MAX_ENTRIES)
    expect(full.truncated).toBeUndefined()
  })

  test('cuts long names', async () => {
    const name = 'n'.repeat(NAME_CHARS + 1)
    const deps = makeDeps({
      listDirectory: async () => [{ name, path: `${ROOT}/${name}`, kind: 'file' }],
    })
    expect(value(await run(deps, 'list_files')).entries[0].name).toBe('n'.repeat(NAME_CHARS) + '…')
  })

  test('refuses a folder outside the Drive', async () => {
    expect(await run(makeDeps(), 'list_files', { directory: '/etc' })).toEqual({
      ok: false,
      error: OUTSIDE,
    })
  })
})

describe('open_project', () => {
  test('opens the project at the path and answers once it is ready', async () => {
    const deps = makeDeps()
    expect(value(await run(deps, 'open_project', { path: `${ROOT}/Beta/` }))).toEqual({
      name: 'Beta',
      path: `${ROOT}/Beta`,
    })
    expect(deps.listDirectory).toHaveBeenCalledWith(ROOT)
    expect(deps.openProject).toHaveBeenCalledWith(`${ROOT}/Beta`, 'Beta')
  })

  test('refuses a path outside the Drive, without opening anything', async () => {
    const deps = makeDeps()
    expect(await run(deps, 'open_project', { path: '/elsewhere/Beta' })).toEqual({
      ok: false,
      error: OUTSIDE,
    })
    expect(deps.openProject).not.toHaveBeenCalled()
  })

  test('refuses a path that is not a project', async () => {
    const deps = makeDeps()
    for (const path of [`${ROOT}/data`, `${ROOT}/cars.csv`, `${ROOT}/Gamma`, `${ROOT}/x/y`]) {
      expect(await run(deps, 'open_project', { path })).toEqual({
        ok: false,
        error: NO_PROJECT_AT_PATH_ERROR,
      })
    }
    expect(deps.openProject).not.toHaveBeenCalled()
  })

  test('a project still opening at the timeout says to look again', async () => {
    const deps = makeDeps({ openProject: async () => false })
    expect(await run(deps, 'open_project', { path: `${ROOT}/Beta` })).toEqual({
      ok: false,
      error: STILL_OPENING_ERROR,
    })
  })

  test('a project that fails to open answers its error', async () => {
    const deps = makeDeps({
      openProject: async () => {
        throw new Error('The engine did not start.')
      },
    })
    expect(await run(deps, 'open_project', { path: `${ROOT}/Beta` })).toEqual({
      ok: false,
      error: 'The engine did not start.',
    })
  })

  test('refuses a missing path', async () => {
    expect(await run(makeDeps(), 'open_project', {})).toEqual({
      ok: false,
      error: 'The argument `path` must be a string.',
    })
  })
})

describe('create_project', () => {
  test('creates the project in the Drive root, opens it and answers once it is ready', async () => {
    const deps = makeDeps()
    expect(value(await run(deps, 'create_project', { name: 'Sales' }))).toEqual({
      name: 'Sales',
      path: `${ROOT}/Sales`,
    })
    expect(deps.createProject).toHaveBeenCalledWith('Sales', ROOT)
    expect(deps.openProject).toHaveBeenCalledWith(`${ROOT}/Sales`, 'Sales')
  })

  test('creates in a given folder', async () => {
    const deps = makeDeps()
    deps.listDirectory = async () => []
    await run(deps, 'create_project', { name: 'Sales', directory: `${ROOT}/data/` })
    expect(deps.createProject).toHaveBeenCalledWith('Sales', `${ROOT}/data`)
  })

  test('refuses a folder outside the Drive, without creating anything', async () => {
    const deps = makeDeps()
    expect(await run(deps, 'create_project', { name: 'Sales', directory: `${ROOT}/../x` })).toEqual(
      { ok: false, error: OUTSIDE },
    )
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  test.each(['a/b', 'a\\b', '.', '..', '  '])('refuses the name %j', async (name) => {
    const deps = makeDeps()
    const result = await run(deps, 'create_project', { name })
    expect(result.ok).toBe(false)
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  test('refuses a name a project in the folder has', async () => {
    const deps = makeDeps()
    expect(await run(deps, 'create_project', { name: 'Beta' })).toEqual({
      ok: false,
      error: 'A project called Beta is already in that folder.',
    })
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  test('a folder that cannot be listed is an error', async () => {
    const deps = makeDeps()
    const result = await run(deps, 'create_project', { name: 'Sales', directory: `${ROOT}/nope` })
    expect(result).toEqual({
      ok: false,
      error: `Could not list that folder: Could not find folder at '${ROOT}/nope'`,
    })
    expect(deps.createProject).not.toHaveBeenCalled()
  })

  test('a failed creation answers its error', async () => {
    const deps = makeDeps({
      createProject: async () => {
        throw new Error('Disk full')
      },
    })
    expect(await run(deps, 'create_project', { name: 'Sales' })).toEqual({
      ok: false,
      error: 'Could not create the project: Disk full',
    })
    expect(deps.openProject).not.toHaveBeenCalled()
  })

  test('a project still opening at the timeout says to look again', async () => {
    const deps = makeDeps({ openProject: async () => false })
    expect(await run(deps, 'create_project', { name: 'Sales' })).toEqual({
      ok: false,
      error: STILL_OPENING_ERROR,
    })
  })
})

describe('close_project', () => {
  test('closes the project on screen and says what is on screen now', async () => {
    let closed = false
    const deps = makeDeps({
      closeCurrentProject: vi.fn(async () => {
        closed = true
        return true
      }),
      state: () =>
        closed ?
          { page: 'dashboard', project: null, openProjects: [] }
        : {
            page: 'project',
            project: { name: 'Alpha', path: `${ROOT}/Alpha` },
            openProjects: [{ name: 'Alpha', path: `${ROOT}/Alpha` }],
          },
    })
    expect(value(await run(deps, 'close_project'))).toEqual({
      closed: { name: 'Alpha', path: `${ROOT}/Alpha` },
      page: 'dashboard',
      project: null,
    })
  })

  test('with no project on screen it is an error', async () => {
    const deps = makeDeps({ state: () => ({ page: 'dashboard', project: null, openProjects: [] }) })
    expect(await run(deps, 'close_project')).toEqual({
      ok: false,
      error: NO_PROJECT_ON_SCREEN_ERROR,
    })
    expect(deps.closeCurrentProject).not.toHaveBeenCalled()
  })

  test('a close that finds no project tab is an error', async () => {
    const deps = makeDeps({ closeCurrentProject: async () => false })
    expect(await run(deps, 'close_project')).toEqual({
      ok: false,
      error: NO_PROJECT_ON_SCREEN_ERROR,
    })
  })
})
