/**
 * @file The colours of component groups. Every node of a group is drawn in `var(<groupColorVar>)`,
 * which `WithCurrentProject.vue` sets to {@link groupColor}. The docs site's generator writes the
 * same variables, so a component looks the same on the site.
 */
import type { GroupInfo } from '$/providers/openedProjects/suggestionDatabase/groupInfo'
import { colorFromString } from '@/util/colors'

/** The CSS variable holding a group's colour; `--group-color-fallback` for no group. */
export function groupColorVar(group: GroupInfo | undefined): string {
  const name = group ? `${group.project}-${group.name}`.replace(/[^\w]/g, '-') : 'fallback'
  return `--group-color-${name}`
}

/** A CSS reference to a group's colour. */
export function groupColorStyle(group: GroupInfo | undefined): string {
  return `var(${groupColorVar(group)})`
}

/** The colour a group's variable is set to: the one `package.yaml` declares, else one derived from its name. */
export function groupColor(group: GroupInfo): string {
  return group.color ?? colorFromString(group.name)
}
