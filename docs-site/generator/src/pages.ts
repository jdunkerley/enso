/** @file The MDX of each page (spec, "Page design"). */
import { posix } from 'node:path'
import type { CatalogueEntry } from './catalogue'
import { nodeJsx, nodeProps } from './componentNode'
import { escapeMdxText, escapeTableCell, linkedType, markdownToMdx } from './mdx'
import { isFunctionPage, isMethodFromOtherModule, type Page, type SiteModel } from './model'
import { argumentDescriptions, KNOWN_SECTIONS, splitSections } from './sections'
import { simpleName } from './typeText'

/** Front matter limiting the table of contents to `##` headings (Docusaurus's snake_case key). */
// eslint-disable-next-line camelcase
const TOC_TO_LEVEL_2 = { toc_max_heading_level: 2 }

const fileOf = (page: Page) => `${page.dir}/index.mdx`

/** A relative link from one page's file to another's, which Docusaurus checks at build time. */
export function relativeLink(from: Page, to: Page): string {
  return posix.relative(posix.dirname(fileOf(from)), fileOf(to))
}

/**
 * Links from a page: a qualified type name to its page; a code span that is exactly a type's simple
 * name, or `Type.member`, when that resolves to one page in the page's own library or in
 * `Standard.Base`. Anything ambiguous stays plain.
 */
export function linkerFor(page: Page, model: SiteModel) {
  const scope = [page.library, 'Standard.Base']
  const byCode = new Map<string, Page[]>()
  for (const candidate of model.pages) {
    if (!scope.includes(candidate.library)) continue
    const keys =
      candidate.kind === 'type' ? [candidate.title]
      : isFunctionPage(candidate) && candidate.kind !== 'moduleFunction' ? [candidate.title]
      : []
    for (const key of keys) byCode.set(key, [...(byCode.get(key) ?? []), candidate])
  }
  return {
    type: (qualifiedName: string) => {
      const target = model.types.get(qualifiedName)
      return target ? relativeLink(page, target) : undefined
    },
    code: (code: string) => {
      const targets = byCode.get(code)
      return targets?.length === 1 && targets[0] !== page ?
          relativeLink(page, targets[0]!)
        : undefined
    },
  }
}

function frontMatter(page: Page, extra: Record<string, unknown> = {}): string {
  const fields: Record<string, unknown> = {
    slug: `/api/${page.path}/`,
    title: page.title,
    // Docusaurus's front matter keys are snake_case.
    // eslint-disable-next-line camelcase
    sidebar_label: isFunctionPage(page) ? page.nodeName : simpleName(page.title),
    ...(page.doc.documentationSummary ? { description: page.doc.documentationSummary } : {}),
    ...(page.doc.aliasesAndMacros.length ? { keywords: page.doc.aliasesAndMacros } : {}),
    ...extra,
  }
  // JSON values are valid YAML, and quoting every value keeps colons and quotes safe.
  return [
    '---',
    ...Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    '---',
  ].join('\n')
}

function badges(page: Page): string[] {
  const meta = page.metadata
  if (!meta) return []
  const lines: string[] = []
  if (meta.deprecated) lines.push(':::caution Deprecated\n\nThis component is deprecated.\n\n:::')
  const inline = [
    meta.unstable ? '**Unstable**' : undefined,
    meta.advanced ? '**Advanced**' : undefined,
    meta.added ? `Added in ${escapeMdxText(meta.added)}` : undefined,
    meta.modified ? `Modified in ${escapeMdxText(meta.modified)}` : undefined,
    meta.removed ? `Removed in ${escapeMdxText(meta.removed)}` : undefined,
  ].filter((badge) => badge != null)
  if (inline.length) lines.push(inline.join(' · '))
  return lines
}

function groupLine(page: Page, model: SiteModel): string | undefined {
  const group = page.doc.groupIndex != null ? model.groups[page.doc.groupIndex] : undefined
  const aliases = page.doc.aliasesAndMacros
  const parts = [
    group ? `**Group**: ${escapeMdxText(group.name)}` : undefined,
    aliases.length ?
      `**Aliases**: ${aliases.map((alias) => `\`${alias}\``).join(', ')}`
    : undefined,
  ].filter((part) => part != null)
  return parts.length ? parts.join(' / ') : undefined
}

function argumentsSection(
  entry: CatalogueEntry,
  text: string | undefined,
  link: ReturnType<typeof linkerFor>,
): string | undefined {
  const args = 'arguments' in entry ? entry.arguments.filter((arg) => arg.name !== 'self') : []
  if (!args.length && !text) return undefined
  const { byName, unmatched } = argumentDescriptions(
    text ?? '',
    args.map((arg) => arg.name),
  )
  const rows = args.map((arg) =>
    [
      `\`${arg.name}\``,
      escapeTableCell((arg.isSuspended ? '~' : '') + linkedType(arg.reprType, link.type)),
      arg.hasDefault && arg.defaultValue != null ? escapeTableCell(`\`${arg.defaultValue}\``) : '',
      escapeTableCell(markdownToMdx(byName.get(arg.name) ?? '', { linkCode: link.code })),
    ].join(' | '),
  )
  const parts = ['## Arguments']
  if (rows.length)
    parts.push(
      [
        '| Name | Type | Default | Description |',
        '| --- | --- | --- | --- |',
        ...rows.map((row) => `| ${row} |`),
      ].join('\n'),
    )
  for (const arg of args) {
    if (arg.tagValues?.length)
      parts.push(
        `Allowed values for \`${arg.name}\`: ${arg.tagValues.map((value) => `\`${value}\``).join(', ')}`,
      )
  }
  if (unmatched.length) parts.push(markdownToMdx(unmatched.join('\n'), { linkCode: link.code }))
  return parts.join('\n\n')
}

function functionPage(page: Page & { entry: CatalogueEntry }, model: SiteModel): string {
  const link = linkerFor(page, model)
  const mdx = (text: string) => markdownToMdx(text, { linkCode: link.code })
  const { body, sections } = splitSections(page.doc.documentation)
  const section = (heading: string) => sections.find((s) => s.heading === heading)?.text
  const parts = [
    frontMatter(page),
    `# ${escapeMdxText(page.title)}`,
    nodeJsx(nodeProps(page, model)),
    ...badges(page),
  ]
  const group = groupLine(page, model)
  if (group) parts.push(group)
  if (body) parts.push(mdx(body))
  const args = argumentsSection(page.entry, section('Arguments'), link)
  if (args) parts.push(args)
  const returnType = 'returnType' in page.entry ? page.entry.returnType : undefined
  if (returnType || section('Returns')) {
    parts.push(
      '## Returns',
      ...(returnType ? [linkedType(returnType, link.type)] : []),
      ...(section('Returns') ? [mdx(section('Returns')!)] : []),
    )
  }
  for (const heading of ['Examples', 'Errors', 'Remarks'] as const) {
    if (section(heading)) parts.push(`## ${heading}`, mdx(section(heading)!))
  }
  for (const other of sections.filter(
    (s) => !(KNOWN_SECTIONS as readonly string[]).includes(s.heading),
  )) {
    parts.push(`## ${escapeMdxText(other.heading)}`, mdx(other.text))
  }
  return parts.join('\n\n') + '\n'
}

function functionList(from: Page, pages: Page[], model: SiteModel): string[] {
  return pages.flatMap((page) =>
    isFunctionPage(page) ?
      [
        `### [${escapeMdxText(page.nodeName)}](${relativeLink(from, page)})`,
        nodeJsx({ ...nodeProps(page, model), size: 'small' }),
        ...(page.doc.documentationSummary ? [markdownToMdx(page.doc.documentationSummary)] : []),
      ]
    : [],
  )
}

function documentation(page: Page, model: SiteModel): string[] {
  const link = linkerFor(page, model)
  const { body, sections } = splitSections(page.doc.documentation)
  return [
    ...(body ? [markdownToMdx(body, { linkCode: link.code })] : []),
    ...sections.flatMap((s) => [
      `## ${escapeMdxText(s.heading)}`,
      markdownToMdx(s.text, { linkCode: link.code }),
    ]),
  ]
}

function typePage(page: Page, model: SiteModel): string {
  const entry = page.entry as CatalogueEntry & { type: 'type' }
  const qualified = `${entry.module}.${entry.name}`
  const link = linkerFor(page, model)
  const members = model.pages.filter(
    (p) =>
      isFunctionPage(p) &&
      'returnType' in p.entry &&
      ((p.kind === 'constructor' && p.entry.returnType === qualified) ||
        ((p.kind === 'staticMethod' || p.kind === 'instanceMethod') &&
          'selfType' in p.entry &&
          p.entry.selfType === qualified)),
  )
  const parts = [frontMatter(page, TOC_TO_LEVEL_2), `# ${escapeMdxText(page.title)}`]
  if (entry.reexports?.includes(`${page.library}.Main`))
    parts.push(`Exported from \`${page.library}\``)
  if (entry.parentType && !entry.parentType.endsWith('.Any'))
    parts.push(`Inherits from ${linkedType(entry.parentType, link.type)}`)
  parts.push(...documentation(page, model))
  const listed = (heading: string, pages: Page[]) =>
    pages.length ? [`## ${heading}`, ...functionList(page, pages, model)] : []
  parts.push(
    ...listed(
      'Constructors',
      members.filter((p) => p.kind === 'constructor'),
    ),
  )
  parts.push(
    ...listed(
      'Static methods',
      members.filter((p) => p.kind === 'staticMethod'),
    ),
  )
  parts.push(
    ...listed(
      'Methods',
      members.filter((p) => p.kind === 'instanceMethod'),
    ),
  )
  const conversions = model.conversions.get(qualified) ?? []
  if (conversions.length) {
    parts.push(
      '## Conversions',
      ...conversions.flatMap((c) => [
        `### From ${linkedType(c.source, link.type)}`,
        ...(c.doc.documentation ?
          [
            markdownToMdx(splitSections(c.doc.documentation).body, {
              linkCode: link.code,
            }),
          ]
        : []),
      ]),
    )
  }
  const extensions = model.extensions.get(qualified) ?? []
  if (extensions.length) {
    parts.push('## Extension methods')
    for (const library of [...new Set(extensions.map((p) => p.library))].sort()) {
      parts.push(
        `### ${library}`,
        ...functionList(
          page,
          extensions.filter((p) => p.library === library),
          model,
        ).map((line) => line.replace(/^### /, '#### ')),
      )
    }
  }
  return parts.join('\n\n') + '\n'
}

function modulePage(page: Page, model: SiteModel): string {
  const own = model.pages.filter((p) => p.module === page.module && p !== page)
  const parts = [
    frontMatter(page, TOC_TO_LEVEL_2),
    `# ${escapeMdxText(page.title)}`,
    ...documentation(page, model),
  ]
  if (page.kind === 'library') {
    const modules = model.pages.filter((p) => p.kind === 'module' && p.library === page.library)
    if (modules.length)
      parts.push(
        '## Modules',
        modules
          .map(
            (m) =>
              `- [${escapeMdxText(m.title)}](${relativeLink(page, m)})${m.doc.documentationSummary ? ` — ${markdownToMdx(m.doc.documentationSummary)}` : ''}`,
          )
          .join('\n'),
      )
  }
  const types = own.filter((p) => p.kind === 'type')
  if (types.length)
    parts.push(
      '## Types',
      types
        .map(
          (t) =>
            `- [${escapeMdxText(t.title)}](${relativeLink(page, t)})${t.doc.documentationSummary ? ` — ${markdownToMdx(t.doc.documentationSummary)}` : ''}`,
        )
        .join('\n'),
    )
  const functions = own.filter((p) => p.kind === 'moduleFunction')
  if (functions.length) parts.push('## Functions', ...functionList(page, functions, model))
  const extensions = own.filter(
    (p) => p.kind === 'extensionMethod' || isMethodFromOtherModule(p, model),
  )
  if (extensions.length)
    parts.push('## Extension methods', ...functionList(page, extensions, model))
  return parts.join('\n\n') + '\n'
}

/** The whole MDX file of a page. */
export function renderPage(page: Page, model: SiteModel): string {
  if (isFunctionPage(page)) return functionPage(page, model)
  if (page.kind === 'type') return typePage(page, model)
  return modulePage(page, model)
}
