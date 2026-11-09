/**
 * @file A fake `enso` for the spare-engine tests. Without `--standby` it is an engine as in the
 * other tests: it records its arguments in `<project>.spawned.json`, answers the health check on
 * `--rpc-port` and exits on a stdin line. With `--standby` it appends `start` to `SPARE_LOG`
 * (exiting with 3 at once when `SPARE_DIES=1`), prints `STANDBY READY 42` after `READY_DELAY_MS`,
 * reads one line, records it in `<project>.line.json` and becomes such an engine; stdin closing
 * first appends `stdin-closed` and exits with 0, as the real one does.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Path } from '../types.js'

const FAKE_SPARE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const spawnArgs = process.argv.slice(2)
const log = process.env.SPARE_LOG
const event = (data) => log && fs.appendFileSync(log, JSON.stringify({ ...data, pid: process.pid }) + '\\n')
function serve(args) {
  const value = (flag) => args[args.indexOf(flag) + 1]
  http.createServer((_q, r) => r.end('OK')).listen(Number(value('--rpc-port')), '127.0.0.1')
  process.stdin.on('data', () => setTimeout(() => process.exit(0), Number(process.env.EXIT_DELAY_MS ?? '0')))
}
if (!spawnArgs.includes('--standby')) {
  const value = (flag) => spawnArgs[spawnArgs.indexOf(flag) + 1]
  fs.writeFileSync(value('--path') + '.spawned.json', JSON.stringify({ args: spawnArgs, pid: process.pid }))
  serve(spawnArgs)
} else {
  event({ event: 'start', args: spawnArgs, cwd: process.cwd(), jvmOptions: process.env.ENSO_JVM_OPTIONS ?? null })
  if (process.env.SPARE_DIES === '1') process.exit(3)
  setTimeout(() => process.stderr.write('STANDBY READY 42\\n'), Number(process.env.READY_DELAY_MS ?? '0'))
  let buffered = ''
  const onEnd = () => {
    event({ event: 'stdin-closed' })
    process.exit(0)
  }
  const onData = (chunk) => {
    buffered += chunk.toString()
    const newline = buffered.indexOf('\\n')
    if (newline < 0) return
    process.stdin.off('data', onData)
    process.stdin.off('end', onEnd)
    const line = JSON.parse(buffered.slice(0, newline))
    const value = (flag) => line.args[line.args.indexOf(flag) + 1]
    fs.writeFileSync(value('--path') + '.line.json', JSON.stringify({ ...line, pid: process.pid, spawnArgs }))
    event({ event: 'taken' })
    serve(line.args)
  }
  process.stdin.on('data', onData)
  process.stdin.on('end', onEnd)
}
`

/** One line of `SPARE_LOG`. */
export interface SpareEvent {
  readonly event: 'start' | 'taken' | 'stdin-closed'
  readonly pid: number
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly jvmOptions?: string | null
}

/** Write the fake executable: a `.bat` on Windows (as the runner expects), a script elsewhere. */
export async function fakeSpareEnso(directory: string): Promise<Path> {
  const script = path.join(directory, 'fake-enso.mjs')
  await fs.writeFile(script, FAKE_SPARE_ENSO)
  if (process.platform === 'win32') {
    const launcher = path.join(directory, 'enso.bat')
    await fs.writeFile(launcher, `@"${process.execPath}" "${script}" %*\r\n`)
    return Path(launcher)
  }
  const launcher = path.join(directory, 'enso')
  await fs.writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  await fs.chmod(launcher, 0o755)
  return Path(launcher)
}

/** The events of `SPARE_LOG`, oldest first; none when it does not exist yet. */
export async function spareEvents(log: string): Promise<SpareEvent[]> {
  try {
    const text = await fs.readFile(log, 'utf8')
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as SpareEvent)
  } catch {
    return []
  }
}

/** Whether a process with `pid` exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
