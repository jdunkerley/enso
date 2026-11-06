import type { QualifiedName } from '@/util/qualifiedName'

/**
 * Description of a Component Group, as the language server reports it from a library's
 * `package.yaml` (`component-groups`).
 *
 * These are groups displayed in the Component Browser. Also, nodes being a call to method from
 * given group will inherit its color. Its own module so code outside the suggestion database (the
 * docs site's generator) can use it without loading the database.
 */
export interface GroupInfo {
  color?: string
  name: string
  project: QualifiedName
}
