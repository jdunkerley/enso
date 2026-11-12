/**
 * @file The open-time harness: launches the packaged IDE, opens two new projects in turn (the
 * first open is cold) and records when each phase of an open ends. See
 * `docs/superpowers/specs/2026-11-01-project-open-performance-design.md`, section 2, and
 * `app/electron-client/CLAUDE.md` ("Open-time harness").
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { electronExecutablePath, findEngineLauncher } from '../tests/packagedIde'
import { cpuAffinity } from './cpuAffinity'
import { hsperfDirectory, parseHsperfData, summariseJvmCounters } from './jvmCounters'
import {
  classifyTemplate,
  cpusLine,
  credentialFreeEnv,
  developMedians,
  isSpareEngine,
  joinJvmOptions,
  notMeasured,
  openTimes,
  parseEngines,
  parseLsLogLine,
  ratioTable,
  regressionWarnings,
  renderMarkdown,
  spareRun,
  spareState,
  spareTable,
  spareUse,
  usedAotCache,
  withoutUnsparedOpens,
  type Engine,
  type LsLogLine,
  type Mark,
  type OpenTag,
  type OpenTimeReport,
  type RssSample,
  type RunResult,
  type RunRss,
  type ShimAot,
  type Template,
} from './openTimeReport'
import { engineProcesses, listProcesses, processRssKb } from './processRss'
import {
  parseTemplateName,
  projectTemplate,
  type ProjectTemplate,
  type TemplateName,
} from './projectTemplates'

const OPEN_TIMEOUT_MS = 180_000
const POLL_MS = 20

interface Options {
  readonly out: string
  readonly runs: number
  readonly engines: readonly Engine[]
  readonly baseline: readonly string[]
  readonly summary: string | undefined
  readonly exe: string
  readonly profile: boolean
  readonly budgetMinutes: number
  readonly extrasMs: number
  readonly jvmDiagnostics: boolean
  readonly jvmOptions: string
  readonly template: TemplateName
  readonly engineLogLevel: string | undefined
}

function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: argv.filter((arg, i) => !(i === 0 && arg === '--')),
    options: {
      out: { type: 'string' },
      runs: { type: 'string', default: '5' },
      engines: { type: 'string', default: 'native' },
      baseline: { type: 'string', multiple: true },
      summary: { type: 'string' },
      exe: { type: 'string' },
      profile: { type: 'boolean', default: false },
      'budget-minutes': { type: 'string', default: '12' },
      'extras-seconds': { type: 'string', default: '15' },
      'jvm-diagnostics': { type: 'boolean', default: false },
      'jvm-options': { type: 'string', default: '' },
      template: { type: 'string', default: 'welcome' },
      'engine-log-level': { type: 'string' },
    },
  })
  // `parseArgs` types an option with a default as possibly undefined: apply the defaults here.
  if (!values.out) throw new Error('--out <dir> is required')
  const engines = parseEngines(values.engines ?? 'native')
  return {
    out: path.resolve(values.out),
    runs: Number(values.runs ?? '5'),
    engines,
    baseline: values.baseline ?? [],
    summary: values.summary,
    exe: values.exe ?? electronExecutablePath,
    profile: values.profile ?? false,
    budgetMinutes: Number(values['budget-minutes'] ?? '12'),
    extrasMs: Number(values['extras-seconds'] ?? '15') * 1000,
    jvmDiagnostics: values['jvm-diagnostics'] ?? false,
    jvmOptions: values['jvm-options'] ?? '',
    template: parseTemplateName(values.template ?? 'welcome'),
    engineLogLevel: values['engine-log-level'],
  }
}

/** The timestamped events of one launch. */
class Marks {
  readonly list: Mark[] = []
  add(k: string, extra: Record<string, unknown> = {}) {
    this.list.push({ k, t: Date.now(), ...extra })
  }
  has(k: string) {
    return this.list.some((m) => m.k === k)
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

/** Run the bundled launcher to the end, without credentials; resolves with its exit code. */
async function runLauncher(
  launcher: string,
  args: readonly string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
  timeoutMs = 600_000,
): Promise<number | null> {
  // The Windows launcher may be `enso.bat`, which Node spawns only through a shell.
  const useShell = launcher.endsWith('.bat')
  const quote = (s: string) => (useShell ? `"${s}"` : s)
  return await new Promise<number | null>((resolve, reject) => {
    const child = spawn(quote(launcher), args.map(quote), {
      cwd,
      // The repo types `ProcessEnv` as closed; a spawned process takes any variable.
      env: { ...credentialFreeEnv(process.env), ...extraEnv } as NodeJS.ProcessEnv,
      shell: useShell,
      stdio: 'ignore',
    })
    // Node's own `timeout` kills only the launcher (`cmd.exe` for an `enso.bat`), not the JVM it
    // started: on Windows the whole tree goes.
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid != null) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

/** Write `project` over the new project at `dir`. */
function writeTemplate(dir: string, project: ProjectTemplate) {
  fs.writeFileSync(path.join(dir, 'src', 'Main.enso'), project.main)
  for (const [file, data] of Object.entries(project.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), data)
  }
}

/** Run the bundled launcher's `--new`, as the dashboard's New Project button does. */
async function createProject(launcher: string, projectsDir: string, name: string) {
  fs.mkdirSync(projectsDir, { recursive: true })
  const target = path.join(projectsDir, name)
  const code = await runLauncher(
    launcher,
    ['--new', target, '--new-project-name', name],
    projectsDir,
  )
  if (code !== 0) throw new Error(`enso --new ${name} exited with ${code}`)
}

async function openProject(
  page: Page,
  name: string,
  tag: OpenTag,
  marks: Marks,
  dir: string,
  profile: boolean,
  extrasMs: number,
  snapshot: (phase: string) => void,
  project: ProjectTemplate | undefined,
  sampleRss: (phase: RssPhase) => Promise<void>,
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
  snapshot(`${tag}-firstNode`)
  const shown = await poll(
    async () =>
      (
        (await page.locator('.TableVisualization').first().textContent({ timeout: 100 })) ?? ''
      ).includes(project?.headline ?? 'Welcome To Enso!'),
    OPEN_TIMEOUT_MS,
  )
  if (!shown) throw new Error(`${tag}: no headline table within ${OPEN_TIMEOUT_MS} ms`)
  // The headline: the welcome table, or the table of a template's library result (`libraryShown`
  // marks the same moment, so the two are not mistaken for each other in `marks.json`).
  marks.add(`${tag}:welcomeShown`)
  if (project != null) marks.add(`${tag}:libraryShown`)
  snapshot(`${tag}-welcomeShown`)
  // Only the first open (Note [RSS Is Sampled On The First Open]).
  if (tag === 'first') await sampleRss('welcomeShown')
  if (cdp) {
    const { profile: cpuProfile } = await cdp.send('Profiler.stop')
    fs.writeFileSync(path.join(dir, `${tag}.cpuprofile`), JSON.stringify(cpuProfile))
    await cdp.detach()
  }
  if (project?.extras ?? true) {
    await measureExtras(page, tag, marks, dir, extrasMs)
    snapshot(`${tag}-extras`)
  }
  if (tag === 'first') {
    const welcome = marks.list.find((m) => m.k === 'first:welcomeShown')!.t
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, welcome + RSS_LATER_MS - Date.now())),
    )
    await sampleRss('welcomeShown+30s')
  }
}

/* Note [RSS Is Sampled On The First Open]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * RSS is reported, not gated (the plan's owner answer 3), for native against the JVM: the engine's
 * processes (the launcher, the native image or `java` under it, and their children; `processRss.ts`)
 * and the ydoc host's utility process (its pid is in the `ydoc host pid=` line of the output), at
 * the headline and 30 s later. Only the first open, and the 30 s are waited out before the project
 * closes, so the second open of such a launch starts later than the others': its numbers are not
 * comparable with a launch that did not wait, and the headline is the first open's anyway.
 *
 * Which processes were summed is written to `rss-<phase>.json` (pid, parent, KiB, command line), so
 * a surprising figure can be explained afterwards. (The first Windows numbers, ~1.2 GiB for native
 * against ~0.4 on Linux, were the whole IDE: Playwright's `process()` is a launcher there, its child
 * the real main process, which matched by name; the IDE binary is now excluded by path.) A process that is not found is no sample, never 0 KiB. The ydoc host's pid is the
 * last `ydoc host pid=` line, as the host is forked again if it dies.
 *
 * The first sample is taken right after the headline, before the extras. On Windows its query (a
 * PowerShell `Get-CimInstance`) competes with them: `welcomeShown` to `cbEntries` was ~1.3 s in the
 * sampled first open against ~0.75 s in the second (dispatch 42163352009), so the first open's
 * extras read ~0.5 s slow there; the sampling time is in the `rss` mark (`ms`). The extras are not
 * gated and the headline is taken before the sample.
 */
type RssPhase = 'welcomeShown' | 'welcomeShown+30s' | 'spareIdle' | 'spareIdle+15s'
const RSS_LATER_MS = 30_000

/* Note [Spare Engines In The Harness]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The `jvm-spare` engines are the JVM with the spare engine on (`project-manager-shim/CLAUDE.md`,
 * "Spare engine"; `ENSO_SPARE_ENGINE=1`, set here, as `credentialFreeEnv` drops every `ENSO_*`).
 * The shim starts a spare only once the GUI has sent the setting and no AOT training runs, so these
 * engines use a trained cache as `jvm` does: one is prepared first unless it is there.
 *
 * An open's spare is the latest the shim logs `Spare engine: start…` for after the previous open
 * began to close (`spareState`): the first, then the one started after the first close. `jvm-spare`
 * waits on the dashboard before each open until that spare has its `Spare engine: ready after …`
 * line, at most `SPARE_WAIT_MS`, which is what a user spends on the dashboard (spec,
 * "Measurement"); a spare not ready by then is warned about, and the open takes it still warming
 * up. Once the first spare is ready the engine processes' memory is sampled (`rss` mark, phase
 * `spareIdle`, with private bytes on Windows): the spare's idle cost. After the opens, the spare
 * started after the last close is sampled again `SPARE_IDLE_LATER_MS` after it was ready
 * (`spareIdle+15s`), when a JVM has settled, off the timed path. `jvm-spare-early` opens as soon as
 * its spare has started, during the warm-up, which the engine abandons when the open's line
 * arrives (its default, `Standby.java`). `jvm-spare-wait` does the same with
 * `enso.standby.abandonWarmUp=false`, so the open waits for the warm-up to finish (the shim gives
 * such an open 60 s more to start): the other answer to the spec's open question, kept measurable.
 *
 * After each open, `<open>:spareUsed` says whether the shim logged `Spare engine: used (…)`
 * (`used`) and whether that spare was ready (`ready`, with `readyAfterMs`; `spareUse`), so the
 * report shows which opens took a spare still warming up. An open that used none (the engine log
 * then says `Engine: no pre-started spare (…)`) fails the launch, and its times are dropped
 * (`withoutUnsparedOpens`): they are an ordinary JVM open's. `jvm` and `jvm-first` run with
 * `ENSO_SPARE_ENGINE=0`, so their numbers are what they were. With a spare alive, quitting the IDE
 * takes up to ~5 s longer (`src/spareQuit.ts`).
 */
const SPARE_WAIT_MS = 15_000
const SPARE_IDLE_LATER_MS = 15_000

/* Note [JVM Counters At Each Phase]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * A JVM publishes its performance counters (`-XX:+UsePerfData`, on by default) in a file named by
 * its pid under `hsperfdata_<user>` in the temporary directory (`/tmp` on Linux, whatever the
 * environment names on Windows), and keeps it current while it runs. They include the time spent
 * loading, linking, verifying and initialising classes, how many classes came from the AOT cache
 * (`java.cls.sharedLoadedClasses`), the HotSpot compilers' time and the GC's. A JVM launch copies
 * every such file when the first node shows, when the welcome table shows and after the extras
 * (`<launch>/hsperf/<open>-<phase>-<pid>`), which costs a read of a few tens of kilobytes: the
 * phases of an open can then be split without a profiler (the bundled runtime has no `jdk.jfr`).
 * The engine of the open is the file whose `sun.rt.createVmBeginTime` is after the click. Truffle's
 * own compilations run on its compiler threads through libgraal and are not in these counters;
 * `--jvm-diagnostics` adds one launch per JVM engine that traces them (Note [Truffle
 * Diagnostics]).
 */
function snapshotJvmCounters(dir: string, phase: string, marks: Marks) {
  const src = hsperfDirectory(process.platform, os.tmpdir(), os.userInfo().username)
  let names: string[]
  try {
    names = fs.readdirSync(src)
  } catch {
    return
  }
  const out = path.join(dir, 'hsperf')
  fs.mkdirSync(out, { recursive: true })
  for (const name of names) {
    try {
      // Read, not copied: on Windows the JVM holds the file open for writing, which `CopyFile`'s
      // share mode refuses.
      const data = fs.readFileSync(path.join(src, name))
      fs.writeFileSync(path.join(out, `${phase}-${name}`), data)
      // The summary in `marks.json` too (`jvm` marks), so a run is read without a parser.
      marks.add('jvm', { phase, pid: name, ...summariseJvmCounters(parseHsperfData(data)) })
    } catch {
      // The JVM exited meanwhile.
    }
  }
}

/* Note [Truffle Diagnostics]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~
 * With `--jvm-diagnostics`, each JVM engine gets one more launch after its measured ones, which is
 * not in the medians (`<engine>-diag/`): Truffle traces every compilation (`TraceCompilation`,
 * with the call target and its time) and prints its statistics when the engine closes
 * (`CompilationStatistics`). The records go to the engine's log handler, so they are in the
 * Language Server log or the launch's `electron-out.log`. On a JVM where Truffle has no optimizing
 * runtime these options do not exist and the engine fails to start, which says so too.
 */
const TRUFFLE_DIAGNOSTICS =
  '-Dpolyglot.engine.TraceCompilation=true -Dpolyglot.engine.CompilationStatistics=true'

/* Note [Extras Are Bounded]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~
 * The extras (component browser, `format` widget, dropdown) come after the headline and are driven
 * by selectors. On the Windows runner none of them was ever reached, and each waited out its own
 * timeout (60, 60, 30 and 60 s): ~212 s per open, so only 2 launches fitted the budget and the
 * run had no median. All the extras of one open now share one budget (`--extras-seconds`, 15 s by
 * default; a working extra needs ~5 s), after which the rest are skipped and recorded as not
 * measured. A screenshot of the page is saved when one is missed (`<tag>-extras.png`), so the next
 * run shows why the selector does not match.
 */
async function measureExtras(
  page: Page,
  tag: OpenTag,
  marks: Marks,
  dir: string,
  extrasMs: number,
) {
  const end = Date.now() + extrasMs
  const left = () => Math.max(1, end - Date.now())
  // After the headline: the component browser and the `format` dropdown, as the spike did.
  await page.waitForTimeout(300)
  const node = page.locator('.GraphNode').first()
  await node.click({ position: { x: 10, y: 10 }, timeout: 5000 }).catch(() => {})
  await page.keyboard.press('Enter')
  await page
    .locator('.ComponentBrowser')
    .waitFor({ state: 'visible', timeout: left() })
    .catch(() => {})
  // The spike's three alternatives (`drive.cjs`), so a renamed class costs one, not the mark.
  const entries = page.locator(
    '.ComponentBrowser .ComponentList .component, .ComponentBrowser [class*="ComponentEntry"], .ComponentBrowser .list-variant .component',
  )
  if (await poll(async () => (await entries.count()) > 5, left())) marks.add(`${tag}:cbEntries`)
  await page.keyboard.press('Escape')
  if (Date.now() < end) {
    await page.waitForTimeout(500)
    await node.click({ position: { x: 10, y: 10 }, timeout: 5000 }).catch(() => {})
    const format = page.locator('.WidgetSelection', { hasText: /^format$/ })
    if (await poll(async () => (await format.count()) > 0, left())) {
      marks.add(`${tag}:formatWidget`)
      await format
        .first()
        .click()
        .catch(() => {})
      const items = page.locator(
        '.DropdownWidget .item, .DropdownWidget li, .DropdownWidget [role="option"]',
      )
      if (await poll(async () => (await items.count()) > 3, Math.max(left(), 3000))) {
        marks.add(`${tag}:dropdownItems`)
      }
      await page.keyboard.press('Escape')
    }
  }
  if (!['cbEntries', 'formatWidget', 'dropdownItems'].every((k) => marks.has(`${tag}:${k}`))) {
    await page
      .screenshot({ path: path.join(dir, `${tag}-extras.png`), timeout: 5000 })
      .catch(() => {})
  }
}

/* Note [The Window Must Be Big Enough]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * On the Windows runner the window is ~1008 x 681 (the screenshot of a missed extra shows it): the
 * layout then leaves the graph editor no room (the drive and the documentation panels fill the
 * page), the node cannot be clicked, and the component browser never opens, so every extra timed
 * out. A window under 1200 x 800 is made 1600 x 1000 before the first open; its size is recorded
 * (`window` mark).
 */
async function ensureWindowSize(app: ElectronApplication, page: Page, marks: Marks) {
  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  marks.add('window', size)
  if (size.w >= 1200 && size.h >= 800) return
  await app
    .evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 1000)
    })
    .catch(() => {})
  await page.waitForTimeout(500)
  marks.add('window', await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })))
}

/**
 * Closes the project's tab. The IDE may first ask whether to keep versions with git (the
 * repository prompt; `answerRepositoryPrompt` in `tests/electronTest.ts`): it appears up to a
 * second or so after the click, and the `project/close` request is sent only once it is answered,
 * so the prompt is raced against that request, not against a fixed wait. It is answered "Not now"
 * (never "Use" or "Don't ask again", which the user's profile would keep), with a warning and a
 * `<open>:repositoryPrompt` mark. The projects live outside any git working tree (Note [Harness
 * Projects Are Outside Any Repository]), so with git installed the first close of a launch is asked
 * whether to create one, never whether to use an enclosing one.
 */
async function closeProject(page: Page, name: string, tag: OpenTag, label: string, marks: Marks) {
  const prompt = page.getByTestId('repository-prompt')
  const closeRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/project-service/project/close'),
    { timeout: 60_000 },
  )
  // If the click throws, nothing awaits the request, so it must not leave an unhandled rejection.
  closeRequest.catch(() => {})
  // The close button is a sibling of the `role="tab"` button, inside the same `.SelectableTab`.
  await page
    .locator('.SelectableTab', { has: page.getByRole('tab', { name }) })
    .locator('.CloseButton')
    .click()
  await Promise.race([
    prompt.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {}),
    closeRequest.catch(() => {}),
  ])
  if (await prompt.isVisible()) {
    marks.add(`${tag}:repositoryPrompt`)
    console.warn(
      `Open time: ${label} ${tag}: the repository prompt asked on close; answered Not now.`,
    )
    await prompt.getByTestId('alert-dialog-cancel').click()
  }
  await closeRequest
}

/* Note [Harness Projects Are Outside Any Repository]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * A launch's projects go in a new temporary directory (`os.tmpdir()`), deleted after the launch,
 * and `--out` holds only the reports. Under `--out` they were inside whatever repository `--out`
 * is in (a checkout's scratch folder), and the IDE asked on close whether to keep their versions in
 * that repository: an answer the harness did not wait for blocked the close, and the launch lost its
 * second open. A "Use" or "Don't ask again" would also have stayed in the user's profile.
 */

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
  label = `${engine}-${run}`,
  beforeClose: () => Promise<void> = async () => {},
): Promise<RunResult & { readonly stdout: string; readonly cacheUsed?: boolean }> {
  const dir = path.join(options.out, label)
  fs.rmSync(dir, { recursive: true, force: true })
  // A launch with no opens (the AOT preparation) creates no project, so nothing else makes it.
  fs.mkdirSync(dir, { recursive: true })
  // Note [Harness Projects Are Outside Any Repository].
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-open-time-'))
  const logDir = path.join(dir, 'logs')
  const launcher = findEngineLauncher(options.exe)
  if (!launcher) throw new Error(`No engine launcher next to ${options.exe}`)
  const stamp = Date.now().toString(36)
  const names = {
    first: `OpenTime${stamp}a`,
    second: `OpenTime${stamp}b`,
  } as const
  const project = projectTemplate(options.template)
  for (const tag of opens) {
    await createProject(launcher, projectsDir, names[tag])
    if (project != null) writeTemplate(path.join(projectsDir, names[tag]), project)
  }
  const marks = new Marks()
  const stdoutLines: string[] = []
  const out = fs.createWriteStream(path.join(dir, 'electron-out.log'))
  const env = {
    ...credentialFreeEnv(process.env),
    ENSO_TEST: 'true',
    ENSO_TEST_PROJECTS_DIR: projectsDir.replace(/\\/g, '/'),
    ENSO_AI_DISABLED: '1',
    ENSO_LOG_DIRECTORY: logDir,
    // The shim's own JDK AOT cache (`project-manager-shim/jvmAot`) is a directory of the run's,
    // never the user's `<userData>/jvm-aot`. A `jvm` engine points it at `<out>/jvm-aot`
    // (`engineEnv`), which the preparation launch fills; native never trains, so it keeps this.
    ENSO_JVM_AOT_DIR: path.join(options.out, 'shim-jvm-aot'),
    // `--engine-log-level debug`: the engine's own log at that level, to split an open (e.g.
    // `AttachVisualizationCmd`, `Starting ExecuteJob`, module loading); slower, so not for medians.
    ...(options.engineLogLevel ?
      { ENSO_LOGSERVER_LOG_TO_FILE_LOG_LEVEL: options.engineLogLevel }
    : {}),
    ...extraEnv,
  }
  let app: ElectronApplication | undefined
  let page: Page | undefined
  let error: string | undefined
  let cpus: number | undefined
  const sampleRss = async (phase: RssPhase) => {
    try {
      const electronPid = app?.process().pid
      const ydocPids = [...stdoutLines.join('\n').matchAll(/ydoc host pid=(\d+)/g)]
      const ydocPid = Number(ydocPids.at(-1)?.[1])
      if (electronPid == null) return
      const began = Date.now()
      const processes = await listProcesses()
      const engine = engineProcesses(processes, electronPid, options.exe)
      const ydoc = Number.isFinite(ydocPid) ? processes.find((p) => p.pid === ydocPid) : undefined
      fs.writeFileSync(
        path.join(dir, `rss-${phase.replace('+', '-')}.json`),
        JSON.stringify({ electronPid, ydocPid, engine, ydoc: ydoc ?? null }, null, 1),
      )
      const engineKb = engine.length === 0 ? undefined : engine.reduce((n, p) => n + p.rssKb, 0)
      // Private bytes only when every process has them (Windows).
      const enginePrivateKb =
        engine.length === 0 || engine.some((p) => p.privateKb == null) ?
          undefined
        : engine.reduce((n, p) => n + (p.privateKb ?? 0), 0)
      const ydocKb = ydocPid ? processRssKb(processes, ydocPid) : undefined
      // -1: no sample (`runRss`).
      marks.add('rss', {
        phase,
        engineKb: engineKb ?? -1,
        ydocKb: ydocKb ?? -1,
        ...(enginePrivateKb != null ? { enginePrivateKb } : {}),
        ms: Date.now() - began,
      })
      if (engineKb == null || ydocKb == null) {
        console.warn(
          `Open time: no RSS at ${phase}: ${engineKb == null ? 'no engine process' : 'no ydoc host'} found (see rss-*.json).`,
        )
      }
    } catch (e) {
      // Not worth a failed launch: the report just has no RSS for it.
      console.warn(`Open time: no RSS sample at ${phase}: ${String(e)}`)
    }
  }
  // A native engine has no JVM, so its launches have no counters to copy (Note [A Project That
  // Uses A Library With Java Code] in `projectTemplates.ts`).
  const snapshot =
    engine === 'native' ? () => {} : (phase: string) => snapshotJvmCounters(dir, phase, marks)
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
    page = await app.firstWindow()
    page.on('response', (r) => {
      const url = r.url()
      if (url.includes('/api/project-service/')) {
        marks.add('resp', {
          u: url.replace(/^.*\/api\/project-service\//, ''),
          s: r.status(),
        })
      }
    })
    page.on('websocket', (ws) => {
      marks.add('wsOpen', { u: ws.url() })
      // The first frame sent: the socket is open (Note [The GUI Is Connected When Its Socket Is
      // Open] in `openTimeReport.ts`).
      ws.once('framesent', () => marks.add('wsUp', { u: ws.url() }))
    })
    page.on('console', (m) =>
      out.write(`${Date.now()} console.${m.type()} ${m.text().slice(0, 400)}\n`),
    )
    await page.getByTestId('drive-view').waitFor({ state: 'visible', timeout: 120_000 })
    await ensureWindowSize(app, page, marks)
    // Note [Spare Engines In The Harness]: the output from this line on holds the next open's spare.
    let spareFrom = 0
    for (const tag of opens) {
      if (engine === 'jvm-spare') {
        const ready = await poll(
          async () => spareState(stdoutLines, spareFrom) === 'ready',
          SPARE_WAIT_MS,
        )
        if (!ready) {
          console.warn(
            `Open time: ${label} ${tag}: the spare was not ready within ${SPARE_WAIT_MS / 1000} s; the open takes it warming up.`,
          )
        } else if (tag === 'first') {
          await sampleRss('spareIdle')
        }
      } else if (isSpareEngine(engine)) {
        const started = await poll(
          async () => spareState(stdoutLines, spareFrom) !== 'none',
          SPARE_WAIT_MS,
        )
        if (!started) throw new Error(`${tag}: no spare engine started within ${SPARE_WAIT_MS} ms`)
      }
      const usedFrom = stdoutLines.length
      await openProject(
        page,
        names[tag],
        tag,
        marks,
        dir,
        options.profile,
        options.extrasMs,
        snapshot,
        project,
        sampleRss,
      )
      if (isSpareEngine(engine)) {
        const use = spareUse(stdoutLines, usedFrom)
        marks.add(`${tag}:spareUsed`, use == null ? { used: false } : { used: true, ...use })
        if (use == null) {
          throw new Error(`${tag}: no pre-started spare was used (see electron-out.log)`)
        }
      }
      spareFrom = stdoutLines.length
      await closeProject(page, names[tag], tag, label, marks)
      // The deliberate dwell on the dashboard between opens, as a user returns to it.
      await page.waitForTimeout(2000)
    }
    if (engine === 'jvm-spare') {
      // Off the timed path: the idle spare once it has settled (Note [Spare Engines In The Harness]).
      if (await poll(async () => spareState(stdoutLines, spareFrom) === 'ready', SPARE_WAIT_MS)) {
        await new Promise((resolve) => setTimeout(resolve, SPARE_IDLE_LATER_MS))
        await sampleRss('spareIdle+15s')
      } else {
        console.warn(`Open time: ${label}: no spare ready after the opens; no later idle sample.`)
      }
    }
    // Once per launch, after the opens: on Windows the query is a PowerShell process.
    cpus = await cpuAffinity(app.process().pid ?? -1)
    await beforeClose()
  } catch (e) {
    error = String(e).slice(0, 2000)
    // What the page showed when the launch gave up (uploaded by CI with the extras' screenshots).
    await page?.screenshot({ path: path.join(dir, 'failed.png'), timeout: 5000 }).catch(() => {})
    // And the nodes' text, which holds an error message too small to read in the screenshot.
    const nodes = await page
      ?.locator('.GraphNode')
      .allTextContents()
      .catch(() => [])
    if (nodes != null && nodes.length > 0) {
      out.write(`${Date.now()} nodes ${JSON.stringify(nodes).slice(0, 4000)}\n`)
    }
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
    // On Windows an engine that is still exiting can hold a project file for a moment.
    try {
      fs.rmSync(projectsDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
    } catch (e) {
      console.warn(
        `Open time: ${label}: the projects in ${projectsDir} were not deleted: ${String(e)}`,
      )
    }
  }
  const logs = readLsLogs(logDir)
  // A spare open that used no spare is an ordinary JVM open: not in the medians.
  const { first, second } = withoutUnsparedOpens(
    {
      first: openTimes(marks.list, 'first', logOf(logs, marks.list, 'first')),
      second:
        opens.includes('second') ?
          openTimes(marks.list, 'second', logOf(logs, marks.list, 'second'))
        : null,
    },
    marks.list,
  )
  const rss = runRss(marks.list)
  const cacheUsed = usedAotCache(marks.list)
  const spare = isSpareEngine(engine) ? spareRun(stdoutLines.join('\n'), marks.list) : undefined
  return {
    engine,
    run,
    first,
    second,
    ...(rss ? { rss } : {}),
    ...(spare ? { spare } : {}),
    ...(cpus != null ? { cpus } : {}),
    // Recorded, never silent: the report warns about every phase or extra a launch missed.
    notMeasured: [...new Set([...notMeasured(first), ...(second ? notMeasured(second) : [])])],
    ...(error ? { error } : {}),
    stdout: stdoutLines.join('\n'),
    ...(cacheUsed === undefined ? {} : { cacheUsed }),
  }
}

/** The launch's two RSS samples, or `undefined` when either is missing or the ydoc pid was not seen. */
function runRss(marks: readonly Mark[]): RunRss | undefined {
  const sample = (phase: RssPhase): RssSample | undefined => {
    const mark = marks.find((m) => m.k === 'rss' && m.phase === phase)
    if (mark == null || typeof mark.engineKb !== 'number' || typeof mark.ydocKb !== 'number') {
      return undefined
    }
    return mark.ydocKb < 0 || mark.engineKb < 0 ?
        undefined
      : { engineKb: mark.engineKb, ydocKb: mark.ydocKb }
  }
  const atWelcome = sample('welcomeShown')
  const after30s = sample('welcomeShown+30s')
  return atWelcome && after30s ? { atWelcome, after30s } : undefined
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
  return classifyTemplate(main)
}

/** The `open-time.json` files at `target`: itself, or those in a directory, newest run id first. */
function reportFiles(target: string): string[] {
  if (!fs.existsSync(target)) return []
  if (!fs.statSync(target).isDirectory()) return [target]
  // One sub-directory per develop run, named by its (increasing) run id; or the report itself.
  const direct = path.join(target, 'open-time.json')
  if (fs.existsSync(direct)) return [direct]
  return fs
    .readdirSync(target)
    .sort((a, b) => (Number(b) || 0) - (Number(a) || 0))
    .map((d) => path.join(target, d, 'open-time.json'))
    .filter((f) => fs.existsSync(f))
}

/**
 * The baseline reports (Note [Noisy Medians] in `openTimeReport.ts`); an unreadable or foreign one
 * is no baseline, and is said to be ignored.
 */
function readReports(targets: readonly string[]): OpenTimeReport[] {
  return targets.flatMap(reportFiles).flatMap((file) => {
    try {
      const report = JSON.parse(fs.readFileSync(file, 'utf8')) as OpenTimeReport
      if (report.version !== 1 || !Array.isArray(report.runs))
        throw new Error('not an open-time report')
      return [report]
    } catch (e) {
      console.warn(`Open time: the baseline ${file} is unusable and is ignored: ${String(e)}`)
      return []
    }
  })
}

/* Note [The Shim's AOT Cache Is Prepared Before The Launches]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The harness no longer makes a JDK AOT cache of its own (it used to record, create and check one
 * by hand, which no user ever had). A `jvm` engine launches the IDE as a user does: the engine
 * mode is `ENSO_ENGINE_MODE=jvm`, so the shim passes `--jvm`, trains its per-user cache in the
 * background (`project-manager-shim/jvmAot`) and starts every engine with it. The cache lives in
 * `ENSO_JVM_AOT_DIR=<out>/jvm-aot`, never the user's. A preparation launch idles on the dashboard
 * until `<out>/jvm-aot/<key>/enso.aot` exists, which the trainer renames into place when it is
 * complete, and records how long that took (`trainingMs`) and how big it is. The measured launches
 * then use the cache; after each, the harness looks that it is still there, as the shim deletes a
 * cache the JVM rejected. `jvm-first` deletes the directory before every launch instead: a
 * user's very first launch. Nothing trains during its open: the shim stops a running training when
 * an open starts (`openStarted`) and restarts it 60 s after the last open was answered, so the
 * background training and the RSS samples stay clear of the measured open as long as
 * `welcomeShown` is under 30 s after `openAnswered` (~12 s on Windows).
 */
const AOT_WAIT_MS = 10 * 60_000

function shimAotDirectory(options: Options): string {
  return path.join(options.out, 'jvm-aot')
}

/** The environment of an engine's launches, on top of the harness's own. */
function engineEnv(engine: Engine, options: Options): Record<string, string> {
  const jvmOptions =
    options.jvmOptions.trim() === '' ? {} : { ENSO_JVM_OPTIONS: options.jvmOptions }
  if (engine === 'native') return { ENSO_ENGINE_MODE: 'native' }
  const jvm = {
    ENSO_ENGINE_MODE: 'jvm',
    // The measured opens start an engine of their own: a spare would take them over.
    ENSO_SPARE_ENGINE: '0',
    ENSO_JVM_AOT_DIR: shimAotDirectory(options),
    ...jvmOptions,
  }
  // The measured opens of `jvm` and `jvm-first` start an engine of their own: a spare would take
  // them over (Note [Spare Engines In The Harness]).
  if (!isSpareEngine(engine)) return { ...jvm, ENSO_SPARE_ENGINE: '0' }
  return engine === 'jvm-spare-wait' ?
      {
        ...jvm,
        ENSO_SPARE_ENGINE: '1',
        ENSO_ENGINE_ARGS: '--vm.D enso.standby.abandonWarmUp=false',
      }
    : { ...jvm, ENSO_SPARE_ENGINE: '1' }
}

/** `<root>/<key>/enso.aot`, the shim's cache (`aotKey` names a 16-digit hexadecimal directory). */
function findShimCache(root: string): string | undefined {
  try {
    for (const entry of fs.readdirSync(root)) {
      const file = path.join(root, entry, 'enso.aot')
      if (/^[0-9a-f]{16}$/.test(entry) && fs.existsSync(file)) return file
    }
  } catch {
    // No directory yet.
  }
  return undefined
}

/**
 * One launch that idles on the dashboard until the shim's training has written its cache, and how
 * long that took.
 */
async function prepareShimAot(
  options: Options,
  env: Record<string, string>,
): Promise<{ trainingMs: number; cacheBytes: number }> {
  fs.rmSync(shimAotDirectory(options), { recursive: true, force: true })
  const started = Date.now()
  let found: { trainingMs: number; cacheBytes: number } | undefined
  const result = await measureLaunch(options, 'jvm', 0, env, [], 'jvm-aot-prepare', async () => {
    while (Date.now() - started < AOT_WAIT_MS) {
      const file = findShimCache(shimAotDirectory(options))
      if (file != null) {
        found = { trainingMs: Date.now() - started, cacheBytes: fs.statSync(file).size }
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  })
  if (found == null) {
    throw new Error(`no AOT cache within ${AOT_WAIT_MS / 1000} s (${result.error ?? 'no error'})`)
  }
  return found
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  fs.mkdirSync(options.out, { recursive: true })
  // A project of the harness's own is compared with nothing (`other`).
  const template = options.template === 'welcome' ? await packagedTemplate(options) : 'other'
  const runs: RunResult[] = []
  let shimAot: ShimAot | undefined
  for (const engine of options.engines) {
    // Each engine has its own budget, which a `jvm` run's cache preparation counts against.
    const deadline = Date.now() + options.budgetMinutes * 60_000
    const extraEnv = engineEnv(engine, options)
    let prepared: { trainingMs: number; cacheBytes: number } | undefined
    // `jvm` always trains afresh; a spare engine needs a cache too, and reuses one that is there
    // (Note [Spare Engines In The Harness]). The preparation launch never has a spare.
    const needsCache =
      engine === 'jvm' ||
      (isSpareEngine(engine) && findShimCache(shimAotDirectory(options)) == null)
    if (needsCache) {
      // Nor the engine arguments of `jvm-spare-wait`: the preparation only trains the cache.
      const { ENSO_ENGINE_ARGS: _engineArgs, ...prepareEnv } = extraEnv
      try {
        prepared = await prepareShimAot(options, { ...prepareEnv, ENSO_SPARE_ENGINE: '0' })
      } catch (e) {
        console.warn(
          `Open time: no ${engine} runs, the shim's AOT cache was not made: ${String(e)}`,
        )
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
    }
    if (engine !== 'native' && options.jvmOptions.trim() !== '') {
      // An experiment (`--jvm-options`, e.g. `-XX:TieredStopAtLevel=1`): engine options, so they
      // go in `ENSO_JVM_OPTIONS`, which the launcher adds to the JVM it starts. The shim's training
      // got them too, through the inherited environment. Said in the log, as the report does not
      // record it.
      console.warn(`Open time: ${engine} launches with ${options.jvmOptions}`)
    }
    const rejectedIn: number[] = []
    const uncachedIn: number[] = []
    const uncheckedIn: number[] = []
    for (let run = 1; run <= options.runs; run++) {
      if (Date.now() > deadline) {
        console.warn(
          `Open time: the ${options.budgetMinutes}-minute budget is spent; ${run - 1} ${engine} launches.`,
        )
        break
      }
      // A user's first launch has no cache yet. On Windows the previous launch's JVM can still hold
      // `enso.aot` mapped, so the delete is retried; if it still fails the launch is recorded as
      // failed, not the whole report lost.
      if (engine === 'jvm-first') {
        try {
          fs.rmSync(shimAotDirectory(options), {
            recursive: true,
            force: true,
            maxRetries: 8,
            retryDelay: 500,
          })
        } catch (e) {
          console.warn(
            `Open time: jvm-first launch ${run} skipped, the cache is locked: ${String(e)}`,
          )
          runs.push({
            engine,
            run,
            first: {},
            second: null,
            notMeasured: [],
            error: `could not delete the AOT cache: ${String(e)}`,
          })
          continue
        }
      }
      const { stdout, cacheUsed, ...result } = await measureLaunch(options, engine, run, extraEnv)
      void stdout
      console.log(`${engine} ${run}: ${JSON.stringify(result)}`)
      runs.push(result)
      // The shim deletes a cache the JVM rejected: a missing one is a warning (Note [The Shim's
      // AOT Cache Is Prepared Before The Launches]).
      if (
        (engine === 'jvm' || isSpareEngine(engine)) &&
        findShimCache(shimAotDirectory(options)) == null
      ) {
        rejectedIn.push(run)
        console.warn(`Open time: the shim's AOT cache is gone after ${engine} launch ${run}.`)
      }
      // Evidence from the JVM itself: a cache that was skipped without a warning shows as almost
      // no shared classes (`usedAotCache`).
      if (engine === 'jvm' && cacheUsed === false) {
        uncachedIn.push(run)
        console.warn(`Open time: jvm launch ${run} loaded almost no classes from the AOT cache.`)
      }
      // No counters of the launch's own JVMs: said, not skipped.
      if (engine === 'jvm' && cacheUsed === undefined && result.error == null) {
        uncheckedIn.push(run)
        console.warn(
          `Open time: jvm launch ${run} has no hsperf counters; AOT cache use unchecked.`,
        )
      }
    }
    if (prepared != null && engine === 'jvm') {
      shimAot = { ...prepared, rejectedIn, uncachedIn, uncheckedIn }
    }
    if (options.jvmDiagnostics && engine !== 'native') {
      const {
        stdout,
        cacheUsed: _cacheUsed,
        ...result
      } = await measureLaunch(
        options,
        engine,
        0,
        {
          ...extraEnv,
          JAVA_TOOL_OPTIONS: joinJvmOptions(extraEnv.JAVA_TOOL_OPTIONS, TRUFFLE_DIAGNOSTICS),
        },
        ['first', 'second'],
        `${engine}-diag`,
      )
      void stdout
      // Not in the medians: Note [Truffle Diagnostics].
      console.log(`${engine} diagnostics: ${JSON.stringify(result)}`)
    }
  }
  const report: OpenTimeReport = {
    version: 1,
    platform: process.platform,
    commit: process.env.GITHUB_SHA ?? null,
    template,
    ...(options.template !== 'welcome' ? { project: options.template } : {}),
    ...(shimAot ? { shimAot } : {}),
    runs,
  }
  // First: whatever the baseline holds, the measurement is kept (and becomes the next baseline).
  fs.writeFileSync(path.join(options.out, 'open-time.json'), JSON.stringify(report, null, 1))
  const baseline = readReports(options.baseline)
  const markdown = [
    renderMarkdown(report, baseline),
    ratioTable(report),
    spareTable(report),
    cpusLine(report),
  ]
    .filter((part) => part !== '')
    .join('\n\n')
  const warnings = regressionWarnings(report, baseline)
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
      ...(developMedians(report, baseline).length > 0 ?
        []
      : [`No develop baseline of the ${template} template to compare with.`, '']),
      ...warnings.map((w) => `- ⚠️ ${w}`),
      '',
    ]
    fs.appendFileSync(options.summary, lines.join('\n'))
  }
}

await main()
