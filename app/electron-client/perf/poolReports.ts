/**
 * @file Pools the open-time reports of several rounds (one harness run each, interleaving the
 * engines round by round) into one, and renders its tables (`app/electron-client/CLAUDE.md`,
 * "Open-time harness"). Launch numbers become `<round>0<n>` (101, 102, 201, …), all above 0.
 * The command line is `poolReportsCli.ts`.
 */
import {
  cpusLine,
  ratioTable,
  renderMarkdown,
  spareTable,
  type OpenTimeReport,
} from './openTimeReport'

/** One report holding every launch of `reports`, which must share platform, template and project. */
export function poolReports(reports: readonly OpenTimeReport[]): OpenTimeReport {
  const first = reports[0]
  if (first == null) throw new Error('no reports to pool')
  for (const report of reports) {
    if (
      report.platform !== first.platform ||
      report.template !== first.template ||
      report.project !== first.project
    ) {
      throw new Error('the reports are of different platforms or templates')
    }
  }
  return {
    ...first,
    runs: reports.flatMap((report, round) =>
      report.runs.map((run) => ({ ...run, run: (round + 1) * 100 + run.run })),
    ),
  }
}

/** The pooled report's tables, as Markdown. */
export function pooledMarkdown(pooled: OpenTimeReport): string {
  return [renderMarkdown(pooled, []), ratioTable(pooled), spareTable(pooled), cpusLine(pooled)]
    .filter((part) => part !== '')
    .join('\n\n')
}
