/**
 * @file The series of a multi-series scatter plot and their colours. A series is named by its axis
 * key (`y`, `(y_multi 0)`, …), which is what each point carries; its label (the column name) is only
 * for display. Points and legend must both look a colour up by the key.
 */

/** One series of the plot: the axis key its points carry, and the label the legend shows. */
export interface SeriesEntry {
  key: string
  label: string
}

/**
 * The series of the plot, in axis order: every axis but `x`. A multi-series plot has more axes than
 * its type names (`(y_multi 0)`, …), so any object of labelled axes is accepted.
 */
export function seriesEntries(axis: object): SeriesEntry[] {
  return Object.entries(axis as Record<string, { label: string }>)
    .filter(([key]) => key !== 'x')
    .map(([key, config]) => ({ key, label: config.label }))
}

/**
 * A colour for each series key, taken from `palette` in series order (wrapping round). Anything that
 * is not one of the keys gets `fallback`. (A bare `d3.scaleOrdinal` would instead add an unknown
 * value to its domain and give it the next colour, which is how the legend, asking by label, used
 * to drift from the points, coloured by key.)
 */
export function seriesColors(
  entries: readonly SeriesEntry[],
  palette: readonly string[],
  fallback = '',
): (key: string) => string {
  const colors = new Map(entries.map((entry, i) => [entry.key, palette[i % palette.length]!]))
  return (key) => colors.get(key) ?? fallback
}
