import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { runCommand } from '../../childProcess/runCommand.js'
import {
  findGit,
  findRepoRoot,
  GitUnavailableError,
  identityArgs,
  resetGitCache,
  runGit,
} from '../git.js'
import { withTempRepo, writeFiles } from './testRepo.js'

vi.mock('../../childProcess/runCommand.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../childProcess/runCommand.js')>()
  return { ...actual, runCommand: vi.fn(actual.runCommand) }
})

const FALLBACK_IDENTITY = ['-c', 'user.name=Enso', '-c', 'user.email=noreply@enso.org']

type Result = { stdout: string; stderr: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  resetGitCache()
})

afterEach(() => {
  vi.mocked(runCommand).mockReset()
})

describe('findGit', () => {
  test('finds git', async () => {
    expect(await findGit()).toEqual(expect.any(String))
  })

  test('is null when git cannot be run, and looks again next time', async () => {
    vi.mocked(runCommand).mockRejectedValueOnce(new Error('ENOENT'))
    expect(await findGit()).toBeNull()
    // Installing git while the IDE runs is picked up without a restart.
    expect(await findGit()).toEqual(expect.any(String))
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  test('a found git is cached', async () => {
    expect(await findGit()).toEqual(expect.any(String))
    expect(await findGit()).toEqual(expect.any(String))
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  test('runGit throws GitUnavailableError without git', async () => {
    vi.mocked(runCommand).mockRejectedValueOnce(new Error('ENOENT'))
    await expect(runGit('.', ['status'])).rejects.toBeInstanceOf(GitUnavailableError)
  })
})

describe('findRepoRoot', () => {
  test('is null outside a repository', async () => {
    await withTempRepo(async (dir) => {
      expect(await findRepoRoot(dir)).toBeNull()
    })
  })

  test('is the root inside a repository, also from a subdirectory', async () => {
    await withTempRepo(
      async (dir) => {
        await writeFiles(dir, { 'a/b/file.txt': 'x' })
        const root = await fs.realpath(dir)
        expect(await findRepoRoot(dir)).toBe(root)
        expect(await findRepoRoot(path.join(dir, 'a', 'b'))).toBe(root)
      },
      { init: true },
    )
  })

  test('rethrows GitUnavailableError', async () => {
    vi.mocked(runCommand).mockRejectedValueOnce(new Error('ENOENT'))
    await expect(findRepoRoot('.')).rejects.toBeInstanceOf(GitUnavailableError)
  })
})

describe('identityArgs', () => {
  test('is the fallback when no identity is configured', async () => {
    await withTempRepo(
      async (dir) => {
        // Stops git guessing an identity from the user and host names.
        await runGit(dir, ['config', 'user.useConfigOnly', 'true'])
        expect(await identityArgs(dir)).toEqual(FALLBACK_IDENTITY)
      },
      { init: true },
    )
  })

  test('is empty when the user has an identity', async () => {
    await withTempRepo(
      async (dir) => {
        await runGit(dir, ['config', 'user.name', 'A'])
        await runGit(dir, ['config', 'user.email', 'a@b.c'])
        expect(await identityArgs(dir)).toEqual([])
      },
      { init: true },
    )
  })
})

describe('runGit', () => {
  test('returns stdout', async () => {
    await withTempRepo(async (dir) => {
      expect(await runGit(dir, ['--version'])).toMatch(/^git version/)
    })
  })

  test('passes GIT_TERMINAL_PROMPT=0, quotepath and the extra environment to git', async () => {
    await findGit()
    vi.mocked(runCommand).mockClear()
    vi.mocked(runCommand).mockResolvedValueOnce({ stdout: '', stderr: '' })
    await runGit('somewhere', ['status'], { env: { GIT_INDEX_FILE: 'idx' }, input: 'in' })
    const [command, args, options] = vi.mocked(runCommand).mock.calls[0]!
    expect(command).toEqual(expect.any(String))
    expect(args).toEqual(['-c', 'core.quotepath=false', 'status'])
    expect(options?.cwd).toBe('somewhere')
    expect(options?.input).toBe('in')
    expect(options?.env?.GIT_TERMINAL_PROMPT).toBe('0')
    expect(options?.env?.GIT_INDEX_FILE).toBe('idx')
    expect(options?.env?.GIT_OPTIONAL_LOCKS).toBe('0')
  })

  test("drops inherited variables that point git elsewhere, but keeps the caller's", async () => {
    const names = [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_COMMON_DIR',
      'GIT_NAMESPACE',
      'GIT_PREFIX',
    ]
    const saved = names.map((name) => [name, process.env[name]] as const)
    await findGit()
    vi.mocked(runCommand).mockClear()
    vi.mocked(runCommand).mockResolvedValue({ stdout: '', stderr: '' })
    try {
      for (const name of names) process.env[name] = 'inherited'
      await runGit('somewhere', ['status'])
      await runGit('somewhere', ['status'], { env: { GIT_INDEX_FILE: 'mine' } })
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
    const [first, second] = vi.mocked(runCommand).mock.calls.map(([, , options]) => options?.env)
    for (const name of names) expect(first).not.toHaveProperty(name)
    expect(second?.GIT_INDEX_FILE).toBe('mine')
    expect(second).not.toHaveProperty('GIT_DIR')
    expect(first?.GIT_CONFIG_NOSYSTEM ?? null).toBe(process.env.GIT_CONFIG_NOSYSTEM ?? null)
  })

  test('calls on the same queue key run one after another', async () => {
    await findGit()
    vi.mocked(runCommand).mockClear()
    const first = deferred<Result>()
    vi.mocked(runCommand)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ stdout: 'second', stderr: '' })
    const a = runGit('.', ['one'], { queueKey: 'k' })
    const b = runGit('.', ['two'], { queueKey: 'k' })
    await flush()
    expect(runCommand).toHaveBeenCalledTimes(1)
    first.resolve({ stdout: 'first', stderr: '' })
    expect(await a).toBe('first')
    expect(await b).toBe('second')
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  test('a failed call does not block the queue', async () => {
    await findGit()
    vi.mocked(runCommand).mockClear()
    vi.mocked(runCommand)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ stdout: 'ok', stderr: '' })
    const a = runGit('.', ['one'], { queueKey: 'k' })
    const b = runGit('.', ['two'], { queueKey: 'k' })
    await expect(a).rejects.toThrow('boom')
    expect(await b).toBe('ok')
  })

  test('calls on different queue keys start together', async () => {
    await findGit()
    vi.mocked(runCommand).mockClear()
    const first = deferred<Result>()
    const second = deferred<Result>()
    vi.mocked(runCommand).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = runGit('.', ['one'], { queueKey: 'x' })
    const b = runGit('.', ['two'], { queueKey: 'y' })
    await flush()
    expect(runCommand).toHaveBeenCalledTimes(2)
    first.resolve({ stdout: '', stderr: '' })
    second.resolve({ stdout: '', stderr: '' })
    await Promise.all([a, b])
  })
})
