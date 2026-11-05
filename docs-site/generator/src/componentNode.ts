/**
 * @file The properties of a function's component node, by the graph editor's rules: its group's
 * colour variable (`groupColorVar`), else a colour from its declared return type (as
 * `computeNodeColor` colours a node by its value's type, which a static page cannot know), else the
 * fallback; the icon by `entryIcon`; required arguments by `isRequiredArgument`.
 */
import type { CatalogueEntry } from './catalogue'
import {
  colorFromString,
  entryIcon,
  groupColorVar,
  isRequiredArgument,
  projectPathKey,
} from './gui'
import type { Page, SiteModel } from './model'
import { QUALIFIED_NAME, unqualifiedType } from './typeText'

export interface NodeParam {
  name: string
  /** `<type>` or `<type> = <default>`, `~` before the type of a suspended argument. */
  tooltip: string
  optional: boolean
}

export interface ComponentNodeProps {
  name: string
  icon: string
  /** A CSS colour or `var(--group-color-…)`. */
  color: string
  returns: string
  params: NodeParam[]
  /** The full signature, for screen readers. */
  label: string
  size?: 'large' | 'small'
}

/** Icon names from doc comments that `icons.svg` does not have. */
export const unknownIcons = new Set<string>()

const FALLBACK = 'var(--group-color-fallback)'

/** The node's colour: group, else declared return type, else the fallback. */
export function nodeColor(page: Page & { entry: CatalogueEntry }, model: SiteModel): string {
  const group = page.doc.groupIndex != null ? model.groups[page.doc.groupIndex] : undefined
  if (group) return `var(${groupColorVar(group)})`
  const entry = page.entry
  const returnType = 'returnType' in entry ? entry.returnType : undefined
  // A single qualified type name; `Any`, unions, intersections and functions have no one colour.
  if (
    !returnType ||
    !new RegExp(`^${QUALIFIED_NAME.source}$`).test(returnType) ||
    returnType.endsWith('.Any')
  ) {
    return FALLBACK
  }
  const segments = returnType.split('.')
  return colorFromString(
    projectPathKey(segments.slice(0, 2).join('.'), segments.slice(2).join('.')),
  )
}

/** The component node of a function page: name, icon, colour, parameter pills and signature. */
export function nodeProps(
  page: Page & { entry: CatalogueEntry },
  model: SiteModel,
): ComponentNodeProps {
  const entry = page.entry
  const args = 'arguments' in entry ? entry.arguments.filter((arg) => arg.name !== 'self') : []
  const params = args.map((arg): NodeParam => {
    const type = (arg.isSuspended ? '~' : '') + unqualifiedType(arg.reprType)
    return {
      name: arg.name,
      tooltip: arg.hasDefault && arg.defaultValue != null ? `${type} = ${arg.defaultValue}` : type,
      optional: arg.hasDefault && !isRequiredArgument(arg),
    }
  })
  const returnType = 'returnType' in entry ? unqualifiedType(entry.returnType) : 'Any'
  const named = page.metadata?.icon
  if (named != null && page.doc.iconName == null) unknownIcons.add(named)
  return {
    name: page.nodeName,
    icon: entryIcon({ iconName: page.doc.iconName, kind: 'Method' }),
    color: nodeColor(page, model),
    returns: `Returns ${returnType}`,
    params,
    label: `${page.nodeName}(${params.map((param) => `${param.name}: ${param.tooltip}`).join(', ')}) -> ${returnType}`,
  }
}

/** The node as an MDX element; props are JSON, which MDX's JavaScript expressions accept. */
export function nodeJsx(props: ComponentNodeProps): string {
  const attributes = Object.entries(props).map(
    ([key, value]) => `${key}={${JSON.stringify(value)}}`,
  )
  return `<ComponentNode ${attributes.join(' ')} />`
}
