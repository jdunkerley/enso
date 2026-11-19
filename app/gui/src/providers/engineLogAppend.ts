/**
 * @file Lines the IDE adds to an open project's engine log, shown in the Logs panel
 * (`POST /api/engine-logs/append`, served by the project-manager shim). Live only: the session's
 * log file does not get them. A failure to send is only a console warning.
 */
import { engineLogSettingsStore } from '$/providers/engineLogSettings'
import {
  ENGINE_LOG_APPEND_PATH,
  GUI_PERFORMANCE_LOGGER,
  GUI_WIDGETS_LOGGER,
  type EngineLogAppendBody,
} from 'enso-common/src/services/engineLogs'

/** Send one entry. */
export function appendToEngineLog(body: EngineLogAppendBody): void {
  void fetch(ENGINE_LOG_APPEND_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then((response) => {
      if (!response.ok) console.warn('The engine log refused a line.', response.status)
    })
    .catch((error) => console.warn('Could not add a line to the engine log.', error))
}

const reportedMismatches = new Set<string>()

/**
 * The engine answered a widget query the IDE cannot read (a schema mismatch between
 * `Widget_Query.resolve_call` and `widgetQueryAnswerSchema`): console and Logs panel, once per
 * project, method and issues.
 */
export function reportWidgetSchemaMismatch(
  project: string,
  method: string,
  issues: readonly {
    readonly path: readonly (string | number)[]
    readonly message: string
  }[],
): void {
  const described = issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
  const key = [project, method, ...described].join('|')
  if (reportedMismatches.has(key)) return
  reportedMismatches.add(key)
  console.error('Unable to parse widget configuration.', method, issues)
  appendToEngineLog({
    project,
    level: 'WARN',
    logger: GUI_WIDGETS_LOGGER,
    message: [
      `The IDE could not read the widget configuration of ${method}:`,
      ...described.map((d) => `    ${d}`),
    ].join('\n'),
  })
}

/** How long the IDE took to read and draw a widget answer, while performance timings are on. */
export function reportWidgetTiming(
  project: string,
  method: string,
  parseMs: number,
  parseAndRenderMs: number,
): void {
  if (!engineLogSettingsStore.getState().performanceTimings) return
  appendToEngineLog({
    project,
    level: 'DEBUG',
    logger: GUI_PERFORMANCE_LOGGER,
    message: `Widget_Query.${method} parse~${parseMs.toFixed(1)}ms parse+render~${parseAndRenderMs.toFixed(1)}ms`,
  })
}
