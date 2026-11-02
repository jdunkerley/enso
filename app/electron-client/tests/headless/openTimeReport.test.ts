/** @file The open-time harness's pure logic: log lines, phases, medians, warnings. */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  aotRejection,
  classifyTemplate,
  credentialFreeEnv,
  developMedians,
  LAUNCHER_JVM_OPTIONS,
  median,
  notMeasured,
  openTimes,
  parseLsLogLine,
  regressionWarnings,
  renderMarkdown,
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
  engine: 'native' | 'jvm' = 'native',
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

describe('LAUNCHER_JVM_OPTIONS', () => {
  test('are the options the launcher gives the JVM it starts (Main.launchJvm)', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../engine/runner/src/main/java/org/enso/runner/Main.java'),
      'utf8',
    )
    for (const option of LAUNCHER_JVM_OPTIONS) {
      expect(source).toContain(`commandAndArgs.add("${option}")`)
    }
  })
})

describe('aotRejection', () => {
  test('finds a cds or aot problem, a mismatch, or an unusable cache', () => {
    expect(aotRejection('[0.1s][warning][cds] shared class paths mismatch')).toContain('mismatch')
    expect(aotRejection('[0.1s][error][aot] An error has occurred')).toContain('[aot]')
    expect(aotRejection('Unable to use AOT cache.')).toContain('Unable to use')
    expect(
      aotRejection('[0.1s][warning][cds] The AOT cache was created by a different VM'),
    ).toBeDefined()
  })
  test('ignores other output', () => {
    expect(aotRejection('[LOG] started\n[0.1s][warning][gc] something')).toBeUndefined()
  })
})

describe('JVM cache state', () => {
  test('is in the table caption and warned about when uncached', () => {
    const base = { ...report([3000, 3000, 3000], 'jvm'), jvmAot: 'uncached' as const }
    expect(renderMarkdown(base, undefined)).toContain('uncached')
    expect(regressionWarnings(base, undefined)).toEqual(
      expect.arrayContaining([expect.stringContaining('uncached')]),
    )
  })
  test('says how the cache was trained', () => {
    const base = { ...report([3000, 3000, 3000], 'jvm'), jvmAot: 'launcher-trained' as const }
    expect(renderMarkdown(base, undefined)).toContain('launcher-trained')
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
