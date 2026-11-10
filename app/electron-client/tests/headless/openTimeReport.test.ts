/** @file The open-time harness's pure logic: log lines, phases, medians, warnings. */
import { describe, expect, test } from 'vitest'
import {
  classifyTemplate,
  cpusLine,
  credentialFreeEnv,
  developMedians,
  isSpareEngine,
  joinJvmOptions,
  median,
  notMeasured,
  openTimes,
  parseEngines,
  parseLsLogLine,
  parseSpareOutput,
  ratioTable,
  regressionWarnings,
  renderMarkdown,
  spareRun,
  spareState,
  spareTable,
  spareUse,
  summarise,
  usedAotCache,
  withoutUnsparedOpens,
  type Engine,
  type Mark,
  type OpenTimeReport,
  type RunResult,
} from '../../perf/openTimeReport'

describe('parseLsLogLine', () => {
  test('reads the time as local time, since the log has no offset', () => {
    const line =
      '[INFO] [2026-11-01T01:30:33.556] [org.enso.languageserver.boot.LanguageServerComponent] Started server at json:127.0.0.1:30616, <secure-json-not-configured>'
    expect(parseLsLogLine(line)).toEqual({
      time: new Date(2026, 10, 1, 1, 30, 33, 556).getTime(),
      logger: 'org.enso.languageserver.boot.LanguageServerComponent',
      message: 'Started server at json:127.0.0.1:30616, <secure-json-not-configured>',
    })
  })
  test('ignores lines that are not log records', () => {
    expect(parseLsLogLine('    at org.enso.Foo.bar(Foo.java:1)')).toBeNull()
  })
})

const t0 = new Date(2026, 10, 1, 1, 30, 18, 0).getTime()
const ls = (offset: number, message: string) => ({
  time: t0 + offset,
  logger: 'org.enso.languageserver.search.SuggestionsHandler',
  message,
})

describe('openTimes', () => {
  const marks: Mark[] = [
    { k: 'first:click', t: t0 },
    { k: 'engineStdout', t: t0 + 190 },
    { k: 'resp', t: t0 + 395, u: 'project/open' },
    { k: 'wsOpen', t: t0 + 420, u: 'ws://127.0.0.1:30617/project/other' },
    { k: 'wsOpen', t: t0 + 921, u: 'ws://127.0.0.1:30617/project/index?ls=x' },
    { k: 'wsUp', t: t0 + 923, u: 'ws://127.0.0.1:30617/project/index?ls=x' },
    { k: 'first:firstNode', t: t0 + 1449 },
    { k: 'first:welcomeShown', t: t0 + 6811 },
    { k: 'second:click', t: t0 + 20_000 },
    { k: 'resp', t: t0 + 20_400, u: 'project/open' },
  ]
  const lines = [
    ls(225, 'Starting Language Server...'),
    ls(260, 'Started server at json:127.0.0.1:30616'),
    ls(4574, 'The first execution finished.'),
  ]

  test('measures every phase from the click', () => {
    expect(openTimes(marks, 'first', lines)).toEqual({
      engineUp: 190,
      lsReady: 260,
      openAnswered: 395,
      guiConnected: 923,
      firstNode: 1449,
      firstExecution: 4574,
      welcomeShown: 6811,
    })
  })
  test('takes the second open’s marks after its own click', () => {
    expect(openTimes(marks, 'second', undefined).openAnswered).toBe(400)
  })
  test('is connected when the ydoc socket is open, not when a refused attempt was made', () => {
    // PR #504's Linux run: the port refused the first three sockets, and y-websocket retried after
    // 200, 400 and 800 ms. Only the fourth opened (and sent its first frame).
    const index = 'ws://127.0.0.1:30617/project/index?ls=x'
    const retried: Mark[] = [
      { k: 'first:click', t: t0 },
      { k: 'resp', t: t0 + 276, u: 'project/open' },
      { k: 'wsOpen', t: t0 + 327, u: index },
      { k: 'wsOpen', t: t0 + 531, u: index },
      { k: 'wsOpen', t: t0 + 940, u: index },
      { k: 'wsOpen', t: t0 + 1743, u: index },
      { k: 'wsUp', t: t0 + 1745, u: index },
    ]
    expect(openTimes(retried, 'first', undefined).guiConnected).toBe(1745)
  })
  test('falls back to the log’s first line when the launcher printed nothing', () => {
    const quiet = marks.filter((m) => m.k !== 'engineStdout')
    expect(openTimes(quiet, 'first', lines).engineUp).toBe(225)
  })
})

describe('median', () => {
  test('of an odd count is the middle value', () => expect(median([5, 1, 3])).toBe(3))
  test('of an even count is the mean of the middle two', () =>
    expect(median([4, 1, 3, 2])).toBe(2.5))
  test('of nothing is undefined', () => expect(median([])).toBeUndefined())
})

function report(
  welcome: readonly (number | undefined)[],
  engine: Engine = 'native',
  template: 'core' | 'full' = 'core',
) {
  const runs: RunResult[] = welcome.map((welcomeShown, i) => ({
    engine,
    run: i + 1,
    first: welcomeShown == null ? {} : { welcomeShown },
    second: null,
    notMeasured: [],
    ...(welcomeShown == null ? { error: 'no welcome table' } : {}),
  }))
  return {
    version: 1,
    platform: 'linux',
    commit: null,
    template,
    runs,
  } satisfies OpenTimeReport
}

describe('regressionWarnings', () => {
  test('none within the limit and the tolerance', () => {
    expect(regressionWarnings(report([3000, 3100, 3200]), report([3000, 3000, 3000]))).toEqual([])
  })
  test('one over 4 s', () => {
    const warnings = regressionWarnings(report([4100, 4200, 4300]), undefined)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('4200 ms')
  })
  test('one more than 15% worse than develop', () => {
    const warnings = regressionWarnings(
      report([14500, 14500, 14500]),
      report([12000, 12000, 12000]),
    )
    expect(warnings).toHaveLength(2) // over 4 s as well
    expect(warnings[1]).toContain('21%')
  })
  test('none for a rise under the absolute delta, however large in percent', () => {
    // 1000 ms is 33%, but no more than the noise of a launch.
    expect(regressionWarnings(report([4000, 4000, 4000]), report([3000, 3000, 3000]))).toEqual([])
  })
  test('compares with the median of develop’s last runs, not the newest', () => {
    // The newest develop run was lucky (8 s); the others sit near 11 s.
    const develop = [8000, 11000, 12000, 10500, 11500].map((m) => report([m, m, m]))
    expect(regressionWarnings(report([12500, 12500, 12500]), develop)).toEqual([
      expect.stringContaining('over 4000 ms'),
    ])
    expect(regressionWarnings(report([12500, 12500, 12500]), develop[0])).toHaveLength(2)
  })
  test('says the spread of the launches and how many develop runs it compared with', () => {
    const develop = [8000, 8000, 8000].map((m) => report([m, m, m]))
    const warnings = regressionWarnings(report([12000, 14000, 16000]), develop)
    expect(warnings[1]).toContain('launches 12000 to 16000 ms')
    expect(warnings[1]).toContain("median of develop's last 3 runs")
  })
  test('uses only the newest five develop runs', () => {
    const old = [1000, 1000, 1000].map((m) => report([m, m, m]))
    const recent = [9000, 9000, 9000, 9000, 9000].map((m) => report([m, m, m]))
    expect(developMedians(report([9000, 9000, 9000]), [...recent, ...old])[0]?.reports).toBe(5)
  })
  test('ignores a develop run with too few successful opens', () => {
    const windows = report([9000, undefined]) // 2 launches: Windows CI before the extras were bounded
    expect(developMedians(report([9000, 9000, 9000]), windows)).toEqual([])
  })
  // The seven develop runs of the open-performance review (I1), Linux, native, core template:
  // their per-run medians span 8114 to 12608 ms with no relevant change between them.
  const REVIEW_LINUX = [
    [8509, 11550, 13830, 11239, 10795],
    [15904, 9960, 8867, 14765, 6568],
    [11787, 13667, 13105, 10297, 12358],
    [6778, 8114, 8801, 7730, 8743],
    [13506, 12509, 12363, 10244, 11761],
    [9636, 15184, 14664, 11218, 12608],
    [10522, 10895, 13272, 11771, 14856],
  ].map((launches) => report(launches))
  const worseThanDevelop = (warnings: string[]) => warnings.filter((w) => w.includes('worse'))
  test('replayed: the docs-only PR (#508) is not a regression', () => {
    // #508 measured 11963 ms; develop's newest run was 8114 ms, hence "47% worse". Develop's
    // runs before it, newest first:
    const before = [REVIEW_LINUX[3]!, REVIEW_LINUX[2]!, REVIEW_LINUX[1]!, REVIEW_LINUX[0]!]
    const pr = report([13146, 14693, 11316, 11963, 11651])
    expect(worseThanDevelop(regressionWarnings(pr, before))).toEqual([])
    // The old rule, against the newest run alone, did warn.
    expect(worseThanDevelop(regressionWarnings(pr, before[0]))).toHaveLength(1)
  })
  test('replayed: no later develop run is a regression against the runs before it', () => {
    for (let i = 4; i < REVIEW_LINUX.length; i++) {
      const before = REVIEW_LINUX.slice(0, i).reverse()
      expect(worseThanDevelop(regressionWarnings(REVIEW_LINUX[i]!, before))).toEqual([])
    }
  })
  test('replayed: a real slowdown of 3 s on top of the noise is still found', () => {
    const last = REVIEW_LINUX[6]!
    const slow = last.runs.map((r) => ({
      ...r,
      first: { welcomeShown: r.first.welcomeShown! + 3000 },
    }))
    const warnings = regressionWarnings({ ...last, runs: slow }, [...REVIEW_LINUX].reverse())
    expect(worseThanDevelop(warnings)).toHaveLength(1)
  })
  test('one when fewer than 3 first opens succeeded', () => {
    const warnings = regressionWarnings(report([3000, undefined, undefined]), undefined)
    expect(warnings).toEqual([expect.stringContaining('1 of 3')])
  })
  test('compares each engine with the same engine', () => {
    const both = {
      ...report([3000, 3000, 3000]),
      runs: [...report([3000, 3000, 3000]).runs, ...report([9000, 9000, 9000], 'jvm').runs],
    }
    expect(regressionWarnings(both, report([3000, 3000, 3000]))).toEqual([
      expect.stringContaining('jvm'),
    ])
  })
  test('compares only with a baseline of the same template', () => {
    // develop measured the full template (before #482); this run the core one.
    expect(
      regressionWarnings(report([3000, 3000, 3000]), report([2000, 2000, 2000], 'native', 'full')),
    ).toEqual([])
  })
  test('one when a launch did not measure an extra phase', () => {
    const missing = report([3000, 3000, 3000])
    const runs = missing.runs.map((r, i) =>
      i === 0 ? { ...r, notMeasured: ['dropdownItems' as const] } : r,
    )
    expect(regressionWarnings({ ...missing, runs }, undefined)).toEqual([
      expect.stringContaining('dropdownItems'),
    ])
  })
})

describe('notMeasured', () => {
  test('names the phases and extras an open lacks', () => {
    expect(notMeasured({ welcomeShown: 1, cbEntries: 2 })).toEqual(
      expect.arrayContaining(['engineUp', 'formatWidget', 'dropdownItems']),
    )
    expect(notMeasured({ welcomeShown: 1, cbEntries: 2 })).not.toContain('cbEntries')
  })
})

describe('renderMarkdown', () => {
  test('names the number of develop runs and the spread of the launches', () => {
    const text = renderMarkdown(report([3000, 3100, 3200]), [
      report([2900, 2900, 2900]),
      report([3100, 3100, 3100]),
    ])
    expect(text).toContain('first, develop (median of 2 runs)')
    expect(text).toContain('welcome table from 3000 to 3200 ms')
  })
  test('has a row per phase and the develop column when there is a baseline', () => {
    const text = renderMarkdown(report([3000, 3100, 3200]), report([2900, 2900, 2900]))
    expect(text).toContain('| **Welcome table visualisation shown** |')
    expect(text).toContain('3100')
    expect(text).toContain('2900')
  })
})

describe('credentialFreeEnv', () => {
  test('drops credentials and keeps the rest', () => {
    expect(
      credentialFreeEnv({
        ENSO_CLOUD_TOKEN: 'x',
        AWS_SECRET_ACCESS_KEY: 'x',
        SNOWFLAKE_PASSWORD: 'x',
        GITHUB_TOKEN: 'x',
        PATH: '/bin',
        LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
      }),
    ).toEqual({ PATH: '/bin', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })
  })
  test('drops by name and by suffix', () => {
    const dropped = {
      ANTHROPIC_API_KEY: 'x',
      OPENAI_API_KEY: 'x',
      PGPASSWORD: 'x',
      PGHOST: 'x',
      PGUSER: 'x',
      ACTIONS_RUNTIME_TOKEN: 'x',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'x',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'x',
      GH_TOKEN: 'x',
      MY_SERVICE_SECRET: 'x',
      DB_PASSWORD: 'x',
      STRIPE_KEY: 'x',
      SOME_CREDENTIALS: 'x',
      NPM_TOKEN: 'x',
    }
    const kept = {
      PATH: '/bin',
      HOME: '/home/u',
      USERPROFILE: 'C:\\Users\\u',
      DISPLAY: ':0',
      TEMP: '/tmp',
      LANG: 'C.UTF-8',
      XAUTHORITY: '/x',
      KEYBOARD: 'us',
    }
    expect(credentialFreeEnv({ ...dropped, ...kept })).toEqual(kept)
  })
  test('drops the JVM option variables, which a measured launch sets for itself', () => {
    expect(
      credentialFreeEnv({
        JAVA_TOOL_OPTIONS: '-Xmx1g',
        _JAVA_OPTIONS: '-Xmx1g',
        JDK_JAVA_OPTIONS: '-Xmx1g',
        PATH: '/bin',
      }),
    ).toEqual({ PATH: '/bin' })
  })
})

describe('classifyTemplate', () => {
  const core = [
    'from Standard.Base import all',
    'from Standard.Table import all',
    'from Standard.Database import all',
    'import Standard.Examples',
    'import Standard.Visualization',
  ].join('\n')
  const main = (imports: string) => `${imports}\n\nmain = 42\n`
  test('core is the core libraries only', () => expect(classifyTemplate(main(core))).toBe('core'))
  test('full imports AWS', () =>
    expect(classifyTemplate(main(`${core}\nfrom Standard.AWS import all`))).toBe('full'))
  test('anything else is other, so it is compared with nothing', () => {
    expect(classifyTemplate(main(`${core}\nimport Standard.Image`))).toBe('other')
    expect(classifyTemplate(main(`${core}\nimport Standard.Snowflake`))).toBe('other')
  })
})

describe("the shim's AOT cache", () => {
  const shimAot = { trainingMs: 95_400, cacheBytes: 123_456_789, rejectedIn: [] as number[] }
  test('is printed under the caption: training time, size, rejections', () => {
    const base = { ...report([3000, 3000, 3000], 'jvm'), shimAot }
    const markdown = renderMarkdown(base, undefined)
    expect(markdown).toContain('Shim AOT cache: trained in 95.4 s, 117.7 MiB, never rejected')
    const rejected = { ...base, shimAot: { ...shimAot, rejectedIn: [2, 4] } }
    expect(renderMarkdown(rejected, undefined)).toContain('rejected in launches 2, 4')
  })
  test('a rejected cache is a warning', () => {
    const base = { ...report([3000, 3000, 3000], 'jvm'), shimAot: { ...shimAot, rejectedIn: [2] } }
    expect(regressionWarnings(base, undefined)).toEqual(
      expect.arrayContaining([expect.stringContaining('AOT cache was rejected')]),
    )
    expect(regressionWarnings({ ...base, shimAot }, undefined)).toEqual([])
  })
  test('a report without one prints no such line', () => {
    expect(renderMarkdown(report([3000, 3000, 3000], 'jvm'), undefined)).not.toContain('Shim AOT')
  })
})

describe('a launch whose second open failed', () => {
  test('is warned about', () => {
    const ok = report([3000, 3000, 3000])
    const runs = ok.runs.map((r, i) => (i === 1 ? { ...r, error: 'second: no welcome table' } : r))
    expect(regressionWarnings({ ...ok, runs }, undefined)).toEqual([
      expect.stringContaining('second: no welcome table'),
    ])
  })
})

describe('parseEngines', () => {
  test('reads a comma-separated list, the first-run JVM included', () => {
    expect(parseEngines('native')).toEqual(['native'])
    expect(parseEngines('native, jvm,jvm-first')).toEqual(['native', 'jvm', 'jvm-first'])
  })
  test('refuses an unknown engine', () => {
    expect(() => parseEngines('native,graal')).toThrow('Unknown engine: graal')
  })
  test('refuses the old jvm-nocache, naming jvm-first', () => {
    expect(() => parseEngines('native,jvm-nocache')).toThrow(/jvm-nocache.*jvm-first/)
  })
})

describe('joinJvmOptions', () => {
  test('joins the parts it is given, leaving out missing and blank ones', () => {
    expect(joinJvmOptions('-XX:AOTMode=on', undefined, ' ', '-Dx=1 ')).toBe('-XX:AOTMode=on -Dx=1')
    expect(joinJvmOptions(undefined, '')).toBe('')
  })
})

describe('jvm-first', () => {
  test('has columns of its own beside the warm JVM', () => {
    const first = report([27000, 28000, 27500], 'jvm-first')
    const warm = report([19000, 19500, 18800], 'jvm')
    const both = { ...first, runs: [...first.runs, ...warm.runs] }
    const markdown = renderMarkdown(both, undefined)
    expect(markdown).toContain('jvm-first first')
    expect(markdown).toContain('jvm first')
    expect(markdown).toContain('27500')
    expect(markdown).toContain('19000')
  })
})

describe('RSS', () => {
  const withRss = (
    engine: Engine,
    values: readonly (readonly [number, number, number, number] | undefined)[],
  ): OpenTimeReport => {
    const base = report(
      values.map(() => 3000),
      engine,
    )
    return {
      ...base,
      runs: base.runs.map((r, i) => {
        const v = values[i]
        return v == null ? r : (
            {
              ...r,
              rss: {
                atWelcome: { engineKb: v[0], ydocKb: v[1] },
                after30s: { engineKb: v[2], ydocKb: v[3] },
              },
            }
          )
      }),
    }
  }
  test('summarise takes the median of each sample, over the launches that have one', () => {
    const r = withRss('jvm', [
      [1000, 100, 1200, 110],
      [3000, 300, 3200, 310],
      [2000, 200, 2200, 210],
      undefined,
    ])
    expect(summarise(r)[0]!.rss).toEqual({
      atWelcome: { engineKb: 2000, ydocKb: 200 },
      after30s: { engineKb: 2200, ydocKb: 210 },
    })
  })
  test('a report without samples has none', () => {
    expect(summarise(report([3000, 3000, 3000]))[0]!.rss).toBeUndefined()
  })
  test('open-time.md has an RSS table in MiB, a row per engine', () => {
    const native = withRss('native', [[102_400, 51_200, 204_800, 61_440]])
    const both = {
      ...native,
      runs: [...native.runs, ...withRss('jvm', [[1_048_576, 51_200, 1_048_576, 51_200]]).runs],
    }
    const markdown = renderMarkdown(both, undefined)
    expect(markdown).toContain('| Engine | Engine at welcome table | Engine 30 s later |')
    expect(markdown).toContain('| native | 100 | 200 | 50 | 60 |')
    expect(markdown).toContain('| jvm | 1024 | 1024 | 50 | 50 |')
  })
  test('no samples, no table', () => {
    expect(renderMarkdown(report([3000, 3000, 3000]), undefined)).not.toContain('Resident memory')
  })
})

describe('RSS caption', () => {
  test('says working set on Windows, resident memory elsewhere', () => {
    const win = {
      ...report([3000, 3000, 3000], 'jvm'),
      platform: 'win32',
      runs: report([3000], 'jvm').runs.map((r) => ({
        ...r,
        rss: { atWelcome: { engineKb: 1, ydocKb: 1 }, after30s: { engineKb: 1, ydocKb: 1 } },
      })),
    }
    expect(renderMarkdown(win, undefined)).toContain('Working set, MiB')
    expect(renderMarkdown({ ...win, platform: 'linux' }, undefined)).toContain(
      'Resident memory, MiB',
    )
  })
})

describe('the jvm baseline', () => {
  const shimAot = { trainingMs: 1000, cacheBytes: 1, rejectedIn: [] as number[] }
  const current = { ...report([9000, 9000, 9000], 'jvm'), shimAot }
  test('pools only reports made through the shim cache', () => {
    const old = report([20_000, 20_000, 20_000], 'jvm')
    const fresh = { ...report([8000, 8000, 8000], 'jvm'), shimAot }
    const medians = developMedians(current, [old, fresh])
    expect(medians).toHaveLength(1)
    expect(medians[0]!.reports).toBe(1)
    expect(medians[0]!.first.welcomeShown).toBe(8000)
  })
  test('an old report alone is no baseline', () => {
    expect(developMedians(current, [report([20_000, 20_000, 20_000], 'jvm')])).toEqual([])
  })
  test('native is still compared with every report', () => {
    const native = { ...report([4000, 4000, 4000], 'native'), shimAot }
    expect(developMedians(native, [report([4000, 4000, 4000], 'native')])).toHaveLength(1)
  })
})

describe('usedAotCache', () => {
  const jvmMark = (sharedClasses: number, vmStart: number): Mark => ({
    k: 'jvm',
    t: vmStart + 10,
    sharedClasses,
    vmStart,
  })
  const frame: Mark[] = [
    { k: 'launch', t: 1000 },
    { k: 'first:click', t: 2000 },
    { k: 'second:click', t: 5000 },
  ]
  test('is true when the open JVM loaded many classes from the cache', () => {
    expect(usedAotCache([...frame, jvmMark(18_000, 2100)])).toBe(true)
  })
  test('is false when it did not', () => {
    expect(usedAotCache([...frame, jvmMark(1500, 2100), jvmMark(1400, 2150)])).toBe(false)
  })
  test('a cached second open does not hide an uncached first open', () => {
    expect(usedAotCache([...frame, jvmMark(1500, 2100), jvmMark(18_000, 5100)])).toBe(false)
  })
  test('a cached first open with an uncached second open is uncached', () => {
    expect(usedAotCache([...frame, jvmMark(18_000, 2100), jvmMark(1500, 5100)])).toBe(false)
  })
  test('a surviving JVM of an earlier launch is ignored', () => {
    expect(usedAotCache([...frame, jvmMark(18_000, 500), jvmMark(1500, 2100)])).toBe(false)
    expect(usedAotCache([...frame, jvmMark(1500, 500), jvmMark(18_000, 2100)])).toBe(true)
  })
  test('an open without a JVM of its own is not judged', () => {
    expect(usedAotCache([...frame, jvmMark(18_000, 2100)])).toBe(true)
  })
  test('is undefined without counters, or with only a stale JVM', () => {
    expect(usedAotCache([...frame])).toBeUndefined()
    expect(usedAotCache([...frame, jvmMark(18_000, 500)])).toBeUndefined()
  })
  test('uncheckedIn is printed and warned about', () => {
    const base = {
      ...report([3000, 3000, 3000], 'jvm'),
      shimAot: { trainingMs: 1000, cacheBytes: 1048576, rejectedIn: [], uncheckedIn: [2] },
    }
    expect(renderMarkdown(base, undefined)).toContain('cache use not checked')
    expect(regressionWarnings(base, undefined).join(' ')).toContain('launches 2 have no hsperf')
  })
  test('uncachedIn is printed and warned about', () => {
    const base = {
      ...report([3000, 3000, 3000], 'jvm'),
      shimAot: { trainingMs: 1000, cacheBytes: 1048576, rejectedIn: [], uncachedIn: [2] },
    }
    expect(renderMarkdown(base, undefined)).toContain('no classes from the cache in launches 2')
    expect(regressionWarnings(base, undefined)).toEqual([
      expect.stringContaining('loaded almost no classes'),
    ])
  })
})

describe('spare engines', () => {
  const stderr = [
    'Spare engine: started (pid 1)',
    'standby: warm-up done in 6100 ms, preloading skipped: the AOT cache holds the classes, process CPU 21400 ms',
    'STANDBY READY 7900',
    'Spare engine: used (pid 1, ready after 8000 ms)',
    'standby: warm-up done in 5900 ms, preloaded 7000 of 7100 classes, process CPU 20100 ms',
    'STANDBY READY 7600',
  ].join('\n')

  test('parseEngines takes them and isSpareEngine knows them', () => {
    expect(parseEngines('jvm-spare,jvm-spare-early,jvm-spare-wait')).toEqual([
      'jvm-spare',
      'jvm-spare-early',
      'jvm-spare-wait',
    ])
    expect(isSpareEngine('jvm-spare-early')).toBe(true)
    expect(isSpareEngine('jvm')).toBe(false)
  })

  test("reads each spare's ready time, warm-up and CPU", () => {
    expect(parseSpareOutput(stderr)).toEqual({
      readyMs: [7900, 7600],
      warmUpMs: [6100, 5900],
      cpuMs: [21400, 20100],
    })
  })

  test('a ready time of -1 is read as is', () => {
    expect(parseSpareOutput('STANDBY READY -1').readyMs).toEqual([-1])
  })

  test('a launch records its idle memory and which opens used a spare, and which a warming one', () => {
    const run = spareRun(stderr, [
      {
        k: 'rss',
        t: 1,
        phase: 'spareIdle',
        engineKb: 700_000,
        ydocKb: 90_000,
        enginePrivateKb: 500_000,
      },
      { k: 'first:spareUsed', t: 2, used: true, ready: false },
      { k: 'second:spareUsed', t: 3, used: false },
      { k: 'rss', t: 4, phase: 'spareIdle+15s', engineKb: 650_000, ydocKb: -1 },
    ])
    expect(run.idleEngineKb).toBe(700_000)
    expect(run.idlePrivateKb).toBe(500_000)
    expect(run.idleLaterEngineKb).toBe(650_000)
    expect(run.idleLaterPrivateKb).toBeUndefined()
    expect(run.marked).toEqual(['first', 'second'])
    expect(run.used).toEqual(['first'])
    expect(run.warming).toEqual(['first'])
    // A second open that never ran has no mark at all.
    expect(
      spareRun(stderr, [{ k: 'first:spareUsed', t: 2, used: true, ready: true }]).marked,
    ).toEqual(['first'])
  })

  test('the spare table counts only the opens that have a spareUsed mark', () => {
    const run = (
      marked: readonly ('first' | 'second')[],
      used: readonly ('first' | 'second')[],
    ) => ({
      engine: 'jvm-spare-early' as const,
      run: 1,
      first: { welcomeShown: 4000 },
      // A launch that failed after its first open still has a (partial) second.
      second: {},
      notMeasured: [],
      spare: { readyMs: [], warmUpMs: [], cpuMs: [], marked, used, warming: used },
    })
    const report = {
      version: 1 as const,
      platform: 'win32',
      commit: null,
      template: 'core' as const,
      runs: [run(['first'], ['first']), run(['first', 'second'], ['first'])],
    }
    expect(spareTable(report)).toContain('| 2/3 | 2/2 |')
  })

  test("an open's spare is the latest started after the given line, ready once it says so", () => {
    const lines = [
      'Spare engine: started (pid 1)',
      'Spare engine: ready after 1800 ms (1900 ms from its own start)',
      'Spare engine: used (pid 1, ready after 1800 ms)',
    ]
    expect(spareState(lines, 0)).toBe('ready')
    // After the first close: the first spare's lines no longer count.
    expect(spareState(lines, 3)).toBe('none')
    expect(spareState([...lines, 'Spare engine: started (pid 2)'], 3)).toBe('started')
    // A spare stopped and started again: only the latest one's ready line counts.
    expect(
      spareState(
        [
          'Spare engine: started (pid 1)',
          'Spare engine: ready after 1800 ms (1900 ms from its own start)',
          'Spare engine: stopped: the open needs other settings',
          'Spare engine: starting',
        ],
        0,
      ),
    ).toBe('started')
  })

  test('the used line says whether the spare was ready', () => {
    const lines = [
      'Spare engine: used (pid 1, ready after 1800 ms)',
      'Spare engine: used (pid 2, still warming up)',
      'Spare engine: used (still warming up)',
    ]
    expect(spareUse(lines, 0)).toEqual({ ready: true, readyAfterMs: 1800 })
    expect(spareUse(lines, 1)).toEqual({ ready: false })
    expect(spareUse(lines, 2)).toEqual({ ready: false })
    expect(spareUse(lines, 3)).toBeUndefined()
  })

  test('the times of an open that used no spare are dropped', () => {
    const times = { first: { welcomeShown: 2000 }, second: { welcomeShown: 1900 } }
    const used = (tag: string, value: boolean) => ({ k: `${tag}:spareUsed`, t: 1, used: value })
    expect(withoutUnsparedOpens(times, [used('first', true), used('second', true)])).toEqual(times)
    expect(withoutUnsparedOpens(times, [used('first', true), used('second', false)])).toEqual({
      first: { welcomeShown: 2000 },
      second: null,
    })
    expect(withoutUnsparedOpens(times, [used('first', false)])).toEqual({
      first: {},
      second: { welcomeShown: 1900 },
    })
    // Not a spare launch: no marks, nothing dropped.
    expect(withoutUnsparedOpens(times, [])).toEqual(times)
  })

  test('the tables give medians, ratios over native and the CPUs', () => {
    const launch = (engine: 'native' | 'jvm-spare', headline: number, cpus = 8) => ({
      engine,
      run: 1,
      first: { welcomeShown: headline },
      second: { welcomeShown: headline - 500 },
      notMeasured: [],
      cpus,
      ...(engine === 'jvm-spare' ?
        {
          spare: {
            readyMs: [7900],
            warmUpMs: [6100],
            cpuMs: [21400],
            idleEngineKb: 700 * 1024,
            idlePrivateKb: 500 * 1024,
            used: ['first', 'second'] as const,
            warming: ['second'] as const,
          },
        }
      : {}),
    })
    const report = {
      version: 1 as const,
      platform: 'win32',
      commit: null,
      template: 'core' as const,
      runs: [launch('native', 2650), launch('jvm-spare', 3450)],
    }
    expect(ratioTable(report)).toContain('| jvm-spare | 1.30 |')
    expect(spareTable(report)).toContain(
      '| jvm-spare | 1 | 7900 | 6100 | 21400 | 700 / 500 | – / – | 2/2 | 1/2 |',
    )
    expect(cpusLine(report)).toBe('CPUs (the IDE’s affinity): 8.')
    expect(
      cpusLine({ ...report, runs: [launch('native', 1, 8), launch('jvm-spare', 1, 32)] }),
    ).toBe('CPUs (the IDE’s affinity) differ between launches: 8, 32.')
  })
})
