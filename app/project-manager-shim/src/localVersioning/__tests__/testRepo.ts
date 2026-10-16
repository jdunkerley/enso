import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { runCommand } from '../../childProcess/runCommand.js'

const ISOLATED_VARIABLES = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'] as const

/**
 * A fresh temporary directory, removed after `body`. `git init` it when `init` is true.
 *
 * The user's git configuration is hidden while `body` runs (`GIT_CONFIG_GLOBAL` points to an
 * empty file and `GIT_CONFIG_NOSYSTEM` is set), so results do not depend on the developer's setup.
 */
export async function withTempRepo<T>(
  body: (dir: string) => Promise<T>,
  options?: { init?: boolean },
): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enso-git-test-'))
  const dir = path.join(root, 'repo')
  const configFile = path.join(root, 'gitconfig')
  const saved = ISOLATED_VARIABLES.map((name) => [name, process.env[name]] as const)
  try {
    await fs.mkdir(dir)
    await fs.writeFile(configFile, '')
    process.env.GIT_CONFIG_GLOBAL = configFile
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    if (options?.init) await runCommand('git', ['init', '-b', 'main'], { cwd: dir })
    return await body(dir)
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

/** Write `files` (relative path → content) under `dir`, creating directories. */
export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }
}
