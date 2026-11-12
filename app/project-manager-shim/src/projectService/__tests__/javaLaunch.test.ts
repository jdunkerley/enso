/** @file The command line of every engine the shim starts (`javaLaunch.ts`). */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  aotCreateArguments,
  javaCommand,
  javaEngineCommand,
  resolveJavaEngine,
  type JavaEngine,
} from '../javaLaunch.js'

const JAVA = process.platform === 'win32' ? 'java.exe' : 'java'
const FIXED = [
  '--sun-misc-unsafe-memory-access=allow',
  '--enable-native-access=org.graalvm.truffle',
  '--add-opens=java.base/java.nio=ALL-UNNAMED',
]
const MAIN = ['-m', 'org.enso.runner/org.enso.runner.Main']
const CACHE = '-XX:AOTCache=C:\\Users\\John Smith\\enso.aot'

let root: string
let launcher: string
let engineRoot: string
let runtimeRoot: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'java-launch-')))
  engineRoot = path.join(root, 'enso', 'dist', '1.0')
  runtimeRoot = path.join(root, 'enso', 'runtime', 'graalvm-x')
  launcher = path.join(engineRoot, 'bin', 'enso')
  await fs.mkdir(path.join(engineRoot, 'bin'), { recursive: true })
  await fs.mkdir(path.join(runtimeRoot, 'bin'), { recursive: true })
  await fs.writeFile(
    path.join(engineRoot, 'jvm.options'),
    `# fixed\n${FIXED.join('\n')}\n\n-Dfrom.file=a b\n`,
  )
  vi.stubEnv('ENSO_JVM_OPTIONS', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('the engine is the bundle: its one runtime, and its package', () => {
  expect(resolveJavaEngine(launcher)).toEqual({
    javaExecutable: path.join(runtimeRoot, 'bin', JAVA),
    engineRoot,
  })
})

test('without a bundled runtime the java on the PATH is used, as bin/enso does', async () => {
  await fs.rm(path.join(root, 'enso', 'runtime'), { recursive: true })
  expect(resolveJavaEngine(launcher)).toEqual({ javaExecutable: 'java', engineRoot })
})

test.each([
  ['open', ['--server', '--root-id', 'r', '--path', '/p', '--rpc-port', '1']],
  ['run', ['--run', '/p']],
  ['standby', ['--standby', '--log-level', 'info']],
  ['new', ['--new', '/p', '--new-project-name', 'P']],
  ['version', ['--version']],
])('the %s command: java, the options file, the module path, the arguments', (_name, args) => {
  const [command, commandArgs] = javaEngineCommand(launcher)(args)
  expect(command).toBe(path.join(runtimeRoot, 'bin', JAVA))
  expect(commandArgs).toEqual([
    ...FIXED,
    '-Dfrom.file=a b',
    '--module-path',
    path.join(engineRoot, 'component'),
    ...MAIN,
    ...args,
  ])
  expect(commandArgs).not.toContain('--jvm')
})

test('ENSO_JVM_OPTIONS comes after the file, the launch options after both', () => {
  vi.stubEnv('ENSO_JVM_OPTIONS', '-Denv=1\n-Dspace=a b\n')
  const [, args] = javaEngineCommand(launcher)(['--version'], [CACHE])
  const file = args.indexOf('-Dfrom.file=a b')
  const env = args.indexOf('-Denv=1')
  expect(file).toBeGreaterThan(-1)
  expect(env).toBeGreaterThan(file)
  expect(args.slice(env, env + 3)).toEqual(['-Denv=1', '-Dspace=a b', CACHE])
  expect(args.indexOf('--module-path')).toBe(env + 3)
})

test('the options file is read at each launch', async () => {
  const command = javaEngineCommand(launcher)
  expect(command(['--version'])[1]).toContain('-Dfrom.file=a b')
  await fs.writeFile(path.join(engineRoot, 'jvm.options'), '-Dnew=1\n')
  const args = command(['--version'])[1]
  expect(args).toContain('-Dnew=1')
  expect(args).not.toContain('-Dfrom.file=a b')
})

test('the AOT cache is created with the options of an engine, and no engine arguments', () => {
  const engine: JavaEngine = { javaExecutable: 'java', engineRoot }
  expect(aotCreateArguments(engine, { config: 'c.conf', cache: 'c.aot' })).toEqual([
    ...FIXED,
    '-Dfrom.file=a b',
    '-XX:AOTMode=create',
    '-XX:AOTConfiguration=c.conf',
    '-XX:AOTCache=c.aot',
    '--module-path',
    path.join(engineRoot, 'component'),
    ...MAIN,
  ])
  expect(javaCommand(engine, [], { jvmOptionsText: '', environment: '' })[1]).toEqual([
    '--module-path',
    path.join(engineRoot, 'component'),
    ...MAIN,
  ])
})
