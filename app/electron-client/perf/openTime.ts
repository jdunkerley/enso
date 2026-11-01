/**
 * @file The open-time harness: launches the packaged IDE, opens two new projects in turn (the
 * first open is cold) and records when each phase of an open ends. See
 * `docs/superpowers/specs/2026-11-01-project-open-performance-design.md`, section 2, and
 * `app/electron-client/CLAUDE.md` ("Open-time harness").
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { electronExecutablePath, findEngineLauncher } from '../tests/packagedIde'
import { createJvmAotCache, measuredJvmToolOptions } from './jvmAotCache'
import {
  comparable,
  credentialFreeEnv,
  notMeasured,
  openTimes,
  parseLsLogLine,
  regressionWarnings,
  renderMarkdown,
  type Engine,
  type LsLogLine,
  type Mark,
  type OpenTag,
  type OpenTimeReport,
  type RunResult,
  type Template,
} from './openTimeReport'

const OPEN_TIMEOUT_MS = 180_000
const POLL_MS = 20

interface Options {
  readonly out: string
  readonly runs: number
  readonly engines: readonly Engine[]
  readonly baseline: string | undefined
  readonly summary: string | undefined
  readonly exe: string
  readonly profile: boolean
  readonly budgetMinutes: number
}

function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: argv.filter((arg, i) => !(i === 0 && arg === '--')),
    options: {
      out: { type: 'string' },
      runs: { type: 'string', default: '5' },
      engines: { type: 'string', default: 'native' },
      baseline: { type: 'string' },
      summary: { type: 'string' },
      exe: { type: 'string' },
      profile: { type: 'boolean', default: false },
      'budget-minutes': { type: 'string', default: '12' },
    },
  })
  // `parseArgs` types an option with a default as possibly undefined: apply the defaults here.
  if (!values.out) throw new Error('--out <dir> is required')
  const engines = (values.engines ?? 'native').split(',').map((e) => e.trim())
  for (const engine of engines) {
    if (engine !== 'native' && engine !== 'jvm') throw new Error(`Unknown engine: ${engine}`)
  }
  return {
    out: path.resolve(values.out),
    runs: Number(values.runs ?? '5'),
    engines: engines as Engine[],
    baseline: values.baseline,
    summary: values.summary,
    exe: values.exe ?? electronExecutablePath,
    profile: values.profile ?? false,
    budgetMinutes: Number(values['budget-minutes'] ?? '12'),
  }
}

/** The timestamped events of one launch. */
class Marks {
  readonly list: Mark[] = []
  add(k: string, extra: Record<string, unknown> = {}) {
    this.list.push({ k, t: Date.now(), ...extra })
  }
}

async function poll(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      if (await check()) return true
    } catch {
      // The element is not there yet.
    }
    if (Date.now() > end) return false
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** Run the bundled launcher's `--new`, as the dashboard's New Project button does. */
async function createProject(launcher: string, projectsDir: string, name: string) {
  fs.mkdirSync(projectsDir, { recursive: true })
  const target = path.join(projectsDir, name)
  // The Windows launcher may be `enso.bat`, which Node spawns only through a shell.
  const useShell = launcher.endsWith('.bat')
  const quote = (s: string) => (useShell ? `"${s}"` : s)
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(quote(launcher), ['--new', quote(target), '--new-project-name', name], {
      cwd: projectsDir,
      // The repo types `ProcessEnv` as closed; a spawned process takes any variable.
      env: credentialFreeEnv(process.env) as NodeJS.ProcessEnv,
      shell: useShell,
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('exit', resolve)
  })
  if (code !== 0) throw new Error(`enso --new ${name} exited with ${code}`)
}

async function openProject(
  page: Page,
  name: string,
  tag: OpenTag,
  marks: Marks,
  dir: string,
  profile: boolean,
) {
  const row = page.getByTestId('drive-view').getByText(name, { exact: true })
  await row.waitFor({ state: 'visible', timeout: 60_000 })
  const cdp = profile ? await page.context().newCDPSession(page) : undefined
  if (cdp) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
    await cdp.send('Profiler.start')
  }
  marks.add(`${tag}:click`)
  await row.dblclick()
  await page.locator('.GraphNode').first().waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
  marks.add(`${tag}:firstNode`)
  const shown = await poll(
    async () =>
      (
        (await page.locator('.TableVisualization').first().textContent({ timeout: 100 })) ?? ''
      ).includes('Welcome To Enso!'),
    OPEN_TIMEOUT_MS,
  )
  if (!shown) throw new Error(`${tag}: no welcome table within ${OPEN_TIMEOUT_MS} ms`)
  marks.add(`${tag}:welcomeShown`)
  if (cdp) {
    const { profile: cpuProfile } = await cdp.send('Profiler.stop')
    fs.writeFileSync(path.join(dir, `${tag}.cpuprofile`), JSON.stringify(cpuProfile))
    await cdp.detach()
  }
  // After the headline: the component browser and the `format` dropdown, as the spike did.
  await page.waitForTimeout(300)
  const node = page.locator('.GraphNode').first()
  await node.click({ position: { x: 10, y: 10 } }).catch(() => {})
  await page.keyboard.press('Enter')
  await page
    .locator('.ComponentBrowser')
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => {})
  // The spike's three alternatives (`drive.cjs`), so a renamed class costs one, not the mark.
  const entries = page.locator(
    '.ComponentBrowser .ComponentList .component, .ComponentBrowser [class*="ComponentEntry"], .ComponentBrowser .list-variant .component',
  )
  if (await poll(async () => (await entries.count()) > 5, 60_000)) marks.add(`${tag}:cbEntries`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await node.click({ position: { x: 10, y: 10 } }).catch(() => {})
  const format = page.locator('.WidgetSelection', { hasText: /^format$/ })
  if (await poll(async () => (await format.count()) > 0, 30_000)) {
    marks.add(`${tag}:formatWidget`)
    await format
      .first()
      .click()
      .catch(() => {})
    const items = page.locator(
      '.DropdownWidget .item, .DropdownWidget li, .DropdownWidget [role="option"]',
    )
    if (await poll(async () => (await items.count()) > 3, 60_000)) marks.add(`${tag}:dropdownItems`)
    await page.keyboard.press('Escape')
  }
}

async function closeProject(page: Page, name: string) {
  await page.getByRole('tab', { name }).locator('.CloseButton').click()
  // "Keep versions of your projects with git?" may ask first (see `answerRepositoryPrompt`).
  const prompt = page.getByTestId('repository-prompt')
  await prompt
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => prompt.getByTestId('alert-dialog-cancel').click())
    .catch(() => {})
}

/** Every Language Server log the launch wrote, each as its records, earliest first. */
function readLsLogs(logDir: string): LsLogLine[][] {
  const files =
    fs.existsSync(logDir) ?
      fs
        .readdirSync(logDir, { recursive: true, encoding: 'utf8' })
        .filter((f) => /enso-language-server.*\.log$/.test(f))
    : []
  return files
    .map((f) =>
      fs
        .readFileSync(path.join(logDir, f), 'utf8')
        .split(/\r?\n/)
        .flatMap((line) => parseLsLogLine(line) ?? []),
    )
    .filter((lines) => lines.length > 0)
    .sort((a, b) => a[0]!.time - b[0]!.time)
}

/** An open's log: the earliest one that starts after its click. */
function logOf(logs: LsLogLine[][], marks: readonly Mark[], tag: OpenTag) {
  const click = marks.find((m) => m.k === `${tag}:click`)?.t
  return click == null ? undefined : logs.find((lines) => lines[0]!.time >= click)
}

/** One launch: two projects, the first open cold. */
async function measureLaunch(
  options: Options,
  engine: Engine,
  run: number,
  extraEnv: Record<string, string>,
  opens: readonly OpenTag[] = ['first', 'second'],
): Promise<RunResult & { readonly stdout: string }> {
  const dir = path.join(options.out, `${engine}-${run}`)
  fs.rmSync(dir, { recursive: true, force: true })
  const projectsDir = path.join(dir, 'projects')
  const logDir = path.join(dir, 'logs')
  const launcher = findEngineLauncher(options.exe)
  if (!launcher) throw new Error(`No engine launcher next to ${options.exe}`)
  const stamp = Date.now().toString(36)
  const names = {
    first: `OpenTime${stamp}a`,
    second: `OpenTime${stamp}b`,
  } as const
  for (const tag of opens) await createProject(launcher, projectsDir, names[tag])
  const marks = new Marks()
  const stdoutLines: string[] = []
  const out = fs.createWriteStream(path.join(dir, 'electron-out.log'))
  const env = {
    ...credentialFreeEnv(process.env),
    ENSO_TEST: 'true',
    ENSO_TEST_PROJECTS_DIR: projectsDir.replace(/\\/g, '/'),
    ENSO_AI_DISABLED: '1',
    ENSO_LOG_DIRECTORY: logDir,
    ...extraEnv,
  }
  let app: ElectronApplication | undefined
  let error: string | undefined
  try {
    marks.add('launch')
    app = await _electron.launch({
      executablePath: options.exe,
      env,
      timeout: 120_000,
    })
    const onOutput = (source: string) => (data: Buffer) => {
      for (const line of String(data).split(/\r?\n/)) {
        if (!line) continue
        out.write(`${Date.now()} ${source} ${line}\n`)
        stdoutLines.push(line)
        if (line.includes('org.enso.runner.Utils')) marks.add('engineStdout')
      }
    }
    app.process().stdout?.on('data', onOutput('o'))
    app.process().stderr?.on('data', onOutput('e'))
    const page = await app.firstWindow()
    page.on('response', (r) => {
      const url = r.url()
      if (url.includes('/api/project-service/')) {
        marks.add('resp', {
          u: url.replace(/^.*\/api\/project-service\//, ''),
          s: r.status(),
        })
      }
    })
    page.on('websocket', (ws) => marks.add('wsOpen', { u: ws.url() }))
    page.on('console', (m) =>
      out.write(`${Date.now()} console.${m.type()} ${m.text().slice(0, 400)}\n`),
    )
    await page.getByTestId('drive-view').waitFor({ state: 'visible', timeout: 120_000 })
    for (const tag of opens) {
      await openProject(page, names[tag], tag, marks, dir, options.profile)
      await closeProject(page, names[tag])
      await page.waitForTimeout(2000)
    }
  } catch (e) {
    error = String(e).slice(0, 500)
  } finally {
    await Promise.race([app?.close(), new Promise((resolve) => setTimeout(resolve, 20_000))]).catch(
      () => {},
    )
    try {
      app?.process().kill()
    } catch {
      // Already gone.
    }
    out.end()
    fs.writeFileSync(path.join(dir, 'marks.json'), JSON.stringify(marks.list, null, 1))
    for (const name of Object.values(names)) {
      fs.rmSync(path.join(engineIrCacheRoot(), name), {
        recursive: true,
        force: true,
      })
    }
  }
  const logs = readLsLogs(logDir)
  const first = openTimes(marks.list, 'first', logOf(logs, marks.list, 'first'))
  const second =
    opens.includes('second') ?
      openTimes(marks.list, 'second', logOf(logs, marks.list, 'second'))
    : null
  return {
    engine,
    run,
    first,
    second,
    // Recorded, never silent: the report warns about every phase or extra a launch missed.
    notMeasured: [...new Set([...notMeasured(first), ...(second ? notMeasured(second) : [])])],
    ...(error ? { error } : {}),
    stdout: stdoutLines.join('\n'),
  }
}

/** `<data dir>/cache/ir/local`, where the engine keeps a project's IR cache. */
function engineIrCacheRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const data =
    process.platform === 'win32' ?
      path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'enso')
    : path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'enso')
  return path.join(data, 'cache', 'ir', 'local')
}

/**
 * The template the packaged engine creates projects from: `core` once #482 has dropped the
 * `Standard.AWS` import, `full` before. Read from a project the launcher has just created.
 */
async function packagedTemplate(options: Options): Promise<Template> {
  const launcher = findEngineLauncher(options.exe)
  if (!launcher) throw new Error(`No engine launcher next to ${options.exe}`)
  const dir = path.join(options.out, 'template')
  fs.rmSync(dir, { recursive: true, force: true })
  await createProject(launcher, dir, 'OpenTimeTemplate')
  const main = fs.readFileSync(path.join(dir, 'OpenTimeTemplate', 'src', 'Main.enso'), 'utf8')
  return /^from Standard\.AWS import/m.test(main) ? 'full' : 'core'
}

function readReport(file: string | undefined): OpenTimeReport | undefined {
  if (!file || !fs.existsSync(file)) return undefined
  return JSON.parse(fs.readFileSync(file, 'utf8')) as OpenTimeReport
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  fs.mkdirSync(options.out, { recursive: true })
  const template = await packagedTemplate(options)
  const runs: RunResult[] = []
  for (const engine of options.engines) {
    // Each engine has its own budget, which a JVM run's AOT preparation counts against.
    const deadline = Date.now() + options.budgetMinutes * 60_000
    let extraEnv: Record<string, string> = {}
    if (engine === 'jvm') {
      let cache: string
      try {
        cache = await createJvmAotCache(options.out, options.exe, (env, opens) =>
          measureLaunch(options, 'jvm', 0, env, opens),
        )
      } catch (e) {
        console.warn(`Open time: no JVM runs, the AOT cache could not be made: ${String(e)}`)
        runs.push({
          engine,
          run: 0,
          first: {},
          second: null,
          notMeasured: [],
          error: String(e),
        })
        continue
      }
      extraEnv = {
        ENSO_ENGINE_ARGS: '--jvm',
        JAVA_TOOL_OPTIONS: measuredJvmToolOptions(cache),
      }
    }
    for (let run = 1; run <= options.runs; run++) {
      if (Date.now() > deadline) {
        console.warn(
          `Open time: the ${options.budgetMinutes}-minute budget is spent; ${run - 1} ${engine} launches.`,
        )
        break
      }
      const { stdout, ...result } = await measureLaunch(options, engine, run, extraEnv)
      void stdout // Read only by the AOT cache check.
      console.log(`${engine} ${run}: ${JSON.stringify(result)}`)
      runs.push(result)
    }
  }
  const report: OpenTimeReport = {
    version: 1,
    platform: process.platform,
    commit: process.env.GITHUB_SHA ?? null,
    template,
    runs,
  }
  const baseline = readReport(options.baseline)
  const markdown = renderMarkdown(report, baseline)
  const warnings = regressionWarnings(report, baseline)
  fs.writeFileSync(path.join(options.out, 'open-time.json'), JSON.stringify(report, null, 1))
  fs.writeFileSync(path.join(options.out, 'open-time.md'), markdown)
  console.log(markdown)
  for (const warning of warnings) {
    console.log(
      process.env.GITHUB_ACTIONS ? `::warning title=Open time::${warning}` : `WARNING: ${warning}`,
    )
  }
  if (options.summary) {
    const lines = [
      '## Open time',
      '',
      markdown,
      ...(comparable(report, baseline) ?
        []
      : [`No develop baseline of the ${template} template to compare with.`, '']),
      ...warnings.map((w) => `- ⚠️ ${w}`),
      '',
    ]
    fs.appendFileSync(options.summary, lines.join('\n'))
  }
}

await main()
