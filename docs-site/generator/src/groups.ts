import { parse } from 'yaml'
import type { GroupInfo, QualifiedName } from './gui'

/**
 * A library's name and its component groups, from its `package.yaml`, as the language server gives
 * them to the GUI (`loadGroups` in the suggestion database): each entry of `component-groups.new`
 * is `Name` or `Name: { color: … }`. `extends` adds components to other libraries' groups and
 * creates none, so it plays no part in colours.
 */
export function readGroups(packageYaml: string): {
  library: string
  groups: GroupInfo[]
} {
  const config = parse(packageYaml) as {
    name: string
    namespace: string
    'component-groups'?: {
      new?: (string | Record<string, { color?: string } | null>)[]
    }
  }
  const library = `${config.namespace}.${config.name}`
  const groups = (config['component-groups']?.new ?? []).map((group): GroupInfo => {
    const [name, settings] = typeof group === 'string' ? [group, null] : Object.entries(group)[0]!
    return {
      project: library as QualifiedName,
      name,
      ...(settings?.color ? { color: settings.color } : {}),
    }
  })
  return { library, groups }
}
