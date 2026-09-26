import type { GraphStore, NodeId } from '$/providers/openedProjects/graph'
import type { NodeType } from '$/providers/openedProjects/graph/graphDatabase'
import type { GroupInfo } from '$/providers/openedProjects/suggestionDatabase'
import { colorFromString } from '@/util/colors'
import { ProjectPath } from '@/util/projectPath'
import { computed } from 'vue'

/** TODO: Add docs */
export function useNodeColors(graphStore: GraphStore, getCssValue: (variable: string) => string) {
  function getNodeColor(node: NodeId) {
    const color = graphStore.db.getNodeColorStyle(node)
    if (color.startsWith('var')) {
      // Some colors are defined in CSS variables, we need to get the actual color.
      const variableName = color.slice(4, -1)
      const value = getCssValue(variableName)
      if (value === '') return undefined
      return value
    } else {
      return color
    }
  }

  function getNodeColors(filter?: (node: NodeId) => boolean) {
    return computed(() => {
      const colors = new Set<string>()
      for (const node of graphStore.db.nodeIds()) {
        if (filter?.(node) !== false) {
          const color = getNodeColor(node)
          if (color) colors.add(color)
        }
      }
      return colors
    })
  }

  return { getNodeColor, getNodeColors }
}

/** Where a node's displayed colour comes from. */
export type NodeColorSource = 'override' | 'fixed' | 'group' | 'type' | 'cached' | 'none'

/** A node's displayed colour (a CSS colour or `var(…)` reference) and where it comes from. */
export interface NodeColorInfo {
  color: string
  source: NodeColorSource
}

/**
 * Compute node color based on the node type, group, and type name. The cached colour, saved from
 * an earlier session, is used only while none of those is known yet.
 *
 * Until the suggestion database has loaded, a node's group cannot be known, so a colour derived
 * from its type is only provisional: the cached colour (which is the group colour, if the node has
 * one) is preferred to it then, so the node does not flash to its type colour and back.
 */
export function computeNodeColor(
  getType: () => NodeType,
  getGroup: () => GroupInfo | undefined,
  getTypeName: () => ProjectPath | undefined,
  getCachedColor: () => string | undefined = () => undefined,
  suggestionsLoaded: () => boolean = () => true,
): NodeColorInfo {
  if (getType() === 'output') return { color: 'var(--output-node-color)', source: 'fixed' }
  if (getType() === 'input') return { color: 'var(--output-node-color)', source: 'fixed' }
  const group = getGroup()
  if (group) return { color: groupColorStyle(group), source: 'group' }
  if (!suggestionsLoaded()) {
    const cachedColor = getCachedColor()
    if (cachedColor) return { color: cachedColor, source: 'cached' }
  }
  const typeName = getTypeName()
  if (typeName) return { color: colorFromString(typeName.key()), source: 'type' }
  const cachedColor = getCachedColor()
  if (cachedColor) return { color: cachedColor, source: 'cached' }
  return { color: 'var(--node-color-no-type)', source: 'none' }
}

/** TODO: Add docs */
export function groupColorVar(group: GroupInfo | undefined): string {
  const name = group ? `${group.project}-${group.name}`.replace(/[^\w]/g, '-') : 'fallback'
  return `--group-color-${name}`
}

/** TODO: Add docs */
export function groupColorStyle(group: GroupInfo | undefined): string {
  return `var(${groupColorVar(group)})`
}
