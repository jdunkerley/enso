import { unknownIcons } from './componentNode'
import { isFunctionPage, type SiteModel } from './model'

/** The run's report: counts by kind and library, gaps, and anything to look at. */
export function formatReport(model: SiteModel): string {
  const lines: string[] = []
  for (const library of model.libraries) {
    const pages = model.pages.filter((page) => page.library === library)
    const counts = new Map<string, number>()
    for (const page of pages) counts.set(page.kind, (counts.get(page.kind) ?? 0) + 1)
    lines.push(`${library}: ${[...counts].map(([kind, count]) => `${count} ${kind}`).join(', ')}`)
  }
  const conversions = [...model.conversions.values()].flat().length
  lines.push(
    `Function pages: ${model.pages.filter(isFunctionPage).length}; conversions: ${conversions}`,
  )
  if (model.skipped.length) lines.push(`No catalogue (skipped): ${model.skipped.join(', ')}`)
  const undocumented = model.pages.filter(
    (page) => isFunctionPage(page) && !page.doc.documentation.trim(),
  )
  if (undocumented.length)
    lines.push(
      `Without documentation (${undocumented.length}): ${undocumented.map((page) => page.path).join(', ')}`,
    )
  if (unknownIcons.size) lines.push(`Unknown icons: ${[...unknownIcons].sort().join(', ')}`)
  // A module function's self type is its module, which has a page of its own.
  const modules = new Set(model.pages.map((page) => page.module))
  const unresolved = new Set<string>()
  for (const page of model.pages) {
    const types =
      page.entry && 'arguments' in page.entry ? page.entry.arguments.map((arg) => arg.reprType) : []
    if (page.entry && 'returnType' in page.entry) types.push(page.entry.returnType)
    for (const type of types)
      for (const name of type.match(/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+\b/g) ?? [])
        if (!model.types.has(name) && !modules.has(name)) unresolved.add(name)
  }
  if (unresolved.size)
    lines.push(`Type names with no page (${unresolved.size}): ${[...unresolved].sort().join(', ')}`)
  if (model.caseCollisions.length)
    lines.push(
      `Paths differing only in case: ${model.caseCollisions.map((pair) => pair.join(' ~ ')).join('; ')}`,
    )
  return lines.join('\n')
}
