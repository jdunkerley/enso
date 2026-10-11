/**
 * @file Placeholders of date and time segments. The date inputs use the Swedish locale (`sv`)
 * because it writes ISO dates (`2026-09-30`), but show the English placeholders.
 */

/** A date or time segment's part, as Reka names it (Reka has no era segment). */
export type SegmentPart =
  'day' | 'dayPeriod' | 'hour' | 'literal' | 'minute' | 'month' | 'second' | 'timeZoneName' | 'year'

const PLACEHOLDERS: Partial<Record<SegmentPart, string>> = {
  year: 'yyyy',
  month: 'mm',
  day: 'dd',
  hour: 'HH',
  minute: 'MM',
  second: 'SS',
  timeZoneName: 'UTC+XX',
}

/**
 * The text to show for a segment: its value written as the `sv` locale writes it (the month and
 * day with two digits, the hour without a leading zero: `2026-09-05 9:05`), or the English
 * placeholder while it is empty. An empty segment is one whose text has no digits (the locale's own
 * placeholder, such as `åååå`).
 */
export function segmentText(part: SegmentPart, value: string): string {
  const placeholder = PLACEHOLDERS[part]
  if (!/\d/.test(value)) return placeholder ?? value
  if (!/^\d+$/.test(value)) return value
  switch (part) {
    case 'month':
    case 'day':
      return value.padStart(2, '0')
    case 'hour':
      return String(Number(value))
    default:
      return value
  }
}

/** A segment as Reka's date fields list them. */
export interface Segment {
  readonly part: SegmentPart
  readonly value: string
}

const TIME_PARTS: readonly SegmentPart[] = ['hour', 'minute', 'second']

/**
 * The segments in ISO order (`2026-09-30 14:05:00`), whatever the locale's order. The `sv` locale
 * alone would give this order, but in Reka the locale also names the calendar's days and months,
 * which must stay in the user's language. Reka moves between segments in DOM order, so the
 * keyboard follows the ISO order too.
 */
export function isoSegments(segments: readonly Segment[]): Segment[] {
  const byPart = new Map(segments.filter((s) => s.part !== 'literal').map((s) => [s.part, s]))
  const pick = (parts: readonly SegmentPart[]) =>
    parts.flatMap((part) => {
      const segment = byPart.get(part)
      return segment != null ? [segment] : []
    })
  const join = (items: Segment[], separator: string): Segment[] =>
    items.flatMap((item, i) =>
      i === 0 ? [item] : [{ part: 'literal' as const, value: separator }, item],
    )
  const groups = [
    join(pick(['year', 'month', 'day']), '-'),
    join(pick(TIME_PARTS), ':'),
    pick(['dayPeriod']),
    pick(['timeZoneName']),
  ].filter((group) => group.length > 0)
  return groups.flatMap((group, i) =>
    i === 0 ? group : [{ part: 'literal' as const, value: ' ' }, ...group],
  )
}
