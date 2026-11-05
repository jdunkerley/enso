import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { parse } from 'yaml'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const GUI = 'docs-site/generator/src/gui.ts'
/** The aliases of `vitest.config.ts` (the GUI's), and the workspace packages `gui.ts` reaches by name. */
const ALIASES: [string, string][] = [
  ['@/', 'app/gui/src/project-view/'],
  ['$/', 'app/gui/src/'],
  ['enso-common/src/', 'app/common/src/'],
  ['ydoc-shared/', 'app/ydoc-shared/src/'],
]
/** Files the generator reads at run time that no import names. */
const EXTRA = [
  'app/gui/scripts/generateIconMetadata.mjs',
  'app/gui/src/project-view/assets/icons.svg',
  'app/gui/src/project-view/assets/base.css',
  'app/lezer-markdown/src/index.ts',
  'app/vitest.node.base.ts',
  'pnpm-lock.yaml',
]
const SUFFIXES = ['.ts', '/index.ts', '.mjs', '']

/** The workspace packages under `app/`, by name: a bare import of one names its `package.json`. */
function workspacePackages(): Map<string, string> {
  const packages = new Map<string, string>()
  for (const dir of readdirSync(join(ROOT, 'app'))) {
    const manifest = join(ROOT, 'app', dir, 'package.json')
    if (existsSync(manifest))
      packages.set(JSON.parse(readFileSync(manifest, 'utf8')).name, `app/${dir}`)
  }
  return packages
}

function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '@@')
    .replace(/\*/g, '[^/]*')
    .replace(/@@/g, '.*')
  return new RegExp(`^${pattern}$`)
}

function resolveFile(base: string): string | undefined {
  const stripped = base.replace(/\.js$/, '')
  for (const candidate of [base, ...SUFFIXES.map((suffix) => stripped + suffix)]) {
    const path = join(ROOT, candidate)
    if (existsSync(path) && statSync(path).isFile()) return candidate
  }
}

/**
 * Every file outside `docs-site/` that `gui.ts` reaches through aliases and relative imports. A
 * file that does not exist (generated and git-ignored, such as `iconName.ts`) counts as the
 * `.ts` file it would be.
 */
function closure(): string[] {
  const packages = workspacePackages()
  const seen = new Set<string>()
  const queue = [GUI]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (!/\.(ts|mjs)$/.test(file) || !existsSync(join(ROOT, file))) continue
    const source = readFileSync(join(ROOT, file), 'utf8')
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      // `?raw` and the like name the file itself.
      const specifier = match[1]!.replace(/[?].*$/, '')
      const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix))
      let base: string
      if (alias) base = alias[1] + specifier.slice(alias[0].length)
      else if (specifier.startsWith('.')) base = posix.join(dirname(file), specifier)
      else {
        // A bare import of a workspace package (no alias for it): its manifest stands for it.
        const name = specifier
          .split('/')
          .slice(0, specifier.startsWith('@') ? 2 : 1)
          .join('/')
        const dir = packages.get(name)
        if (dir) seen.add(`${dir}/package.json`)
        continue
      }
      queue.push(resolveFile(base) ?? base.replace(/\.js$/, '') + '.ts')
    }
  }
  return [...seen].filter((file) => !file.startsWith('docs-site/'))
}

test("docs-site.yml's paths cover every file the generator loads", () => {
  const workflow = parse(readFileSync(`${ROOT}.github/workflows/docs-site.yml`, 'utf8'))
  const paths = (workflow.on.pull_request.paths as string[]).map(globToRegExp)
  const files = closure()
  expect(files.length).toBeGreaterThan(10)
  for (const file of [...files, ...EXTRA]) {
    expect(
      paths.some((path) => path.test(file)),
      file,
    ).toBe(true)
  }
})
