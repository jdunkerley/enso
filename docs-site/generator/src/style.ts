/**
 * @file The documentation style check: the functions of the opted-in modules must follow the house
 * style (design: `docs/superpowers/specs/2026-11-15-function-documentation-style-design.md`, section
 * 1; the checks are its section 4). It runs over the built catalogues, on the same Lezer tree the
 * help panel reads, and reports each breach as a `{ page, rule }` pair for `main.ts` to print.
 */
import {
  argumentDescriptions,
  ensoMarkdownParser,
  exampleToNodes,
  RESULT_LINE,
  splitSections,
} from './gui'
import { isFunctionPage, type SiteModel } from './model'

/** Modules whose functions must follow the house style. */
export const STYLE_CHECKED_MODULES: readonly string[] = [
  'Standard.Base.Data.Time.Date',
  'Standard.Base.Data.Time.Period',
]

export interface StyleViolation {
  /** The page's title (`Date.new`). */
  page: string
  rule: string
}

/** The fully qualified `Any`, which the catalogue gives for an argument with no ascription too. */
const ANY = 'Standard.Base.Any.Any'

/** The code of each fenced block of a section's text. */
function fencedCode(text: string): string[] {
  const blocks: string[] = []
  ensoMarkdownParser.parse(text).iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode') return
      const code = node.node.getChild('CodeText')
      blocks.push(code ? text.slice(code.from, code.to) : '')
      return false
    },
  })
  return blocks
}

/** The text of the `###` headings of a section. */
function subsectionTitles(text: string): string[] {
  const titles: string[] = []
  ensoMarkdownParser.parse(text).iterate({
    enter: (node) => {
      if (node.name === 'ATXHeading3')
        titles.push(text.slice(node.from, node.to).replace(/^###\s*/, ''))
    },
  })
  return titles
}

/** Whether `title` names `argument` as a word (in a code span or plain). */
const names = (title: string, argument: string) =>
  new RegExp(`(^|[^\\w])${argument}([^\\w]|$)`).test(title)

function exampleRules(code: string, n: number): string[] {
  const label = `example ${n}`
  const lines = code.split('\n').filter((line) => line.trim() !== '')
  const rules: string[] = []
  const imports = lines.some((line) => /^\s*(import|from)\s/.test(line))
  if (imports) rules.push(`${label} imports`)
  const lastResult = lines.findLastIndex((line) => RESULT_LINE.test(line))
  if (lastResult >= 0 && lines.slice(lastResult + 1).some((line) => !RESULT_LINE.test(line)))
    rules.push(`${label}: the result line is not last`)
  // An import is a statement the panel cannot paste, so it would be reported twice.
  if (!imports) {
    const nodes = exampleToNodes(code)
    if (!nodes) rules.push(`${label} does not parse`)
    else if (nodes.some((node) => node.binding?.startsWith('example_')))
      rules.push(`${label} binds example_*`)
  }
  return rules
}

/**
 * The style violations of the functions of `modules` (default {@link STYLE_CHECKED_MODULES}).
 *
 * The catalogue cannot tell an argument typed `Any` from one with no ascription, so `Any` counts as
 * untyped; it is allowed only when the doc's `## Remarks` has a `###` subsection naming the
 * argument, which says why it takes anything.
 */
export function styleViolations(
  model: SiteModel,
  modules: readonly string[] = STYLE_CHECKED_MODULES,
): StyleViolation[] {
  const violations: StyleViolation[] = []
  for (const page of model.pages) {
    if (!isFunctionPage(page) || !modules.includes(page.module)) continue
    const report = (rule: string) => violations.push({ page: page.title, rule })
    const entry = page.entry
    const args = ('arguments' in entry ? entry.arguments : []).filter((a) => a.name !== 'self')
    const { sections } = splitSections(page.doc.documentation)
    const section = (heading: string) => sections.find((s) => s.heading === heading)?.text ?? ''
    const remarkTitles = subsectionTitles(section('Remarks'))

    for (const a of args) {
      if (a.reprType === ANY && !remarkTitles.some((title) => names(title, a.name)))
        report(`argument ${a.name} has no type`)
    }
    const { byName, unmatched } = argumentDescriptions(
      section('Arguments'),
      args.map((a) => a.name),
    )
    for (const a of args) if (!byName.has(a.name)) report(`argument ${a.name} is not documented`)
    for (const text of unmatched) {
      const named = /^[-*]\s*`+\s*([^`]+?)\s*`+/.exec(text)?.[1]
      if (named) report(`## Arguments names ${named}, which is not an argument`)
    }

    const blocks = fencedCode(section('Examples'))
    if (!blocks.length) report('no example')
    blocks.forEach((code, i) => {
      for (const rule of exampleRules(code, i + 1)) report(rule)
    })
  }
  return violations
}
