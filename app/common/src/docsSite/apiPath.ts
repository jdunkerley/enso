/**
 * @file The path of a library entry's page on the user documentation site (`docs-site/`), relative
 * to its Components root (`<base>/docs/api/`). The site's generator and the IDE's documentation
 * links both call {@link apiPath}, so the two cannot disagree. Rule and examples:
 * `docs/superpowers/specs/2026-11-04-user-docs-site-design.md`, "URLs".
 */

/** What a page documents. A getter, a module function and an extension method are all `method`. */
export type ApiEntryKind = 'module' | 'type' | 'constructor' | 'method'

/** The fields of a catalogue (or suggestion database) entry that decide its page's path. */
export interface ApiPathEntry {
  readonly kind: ApiEntryKind
  /** The defining module, fully qualified (`Standard.Table.Table`); for a module, the module. */
  readonly module: string
  /** The type's or member's name. Unused for a module. */
  readonly name?: string | undefined
  /**
   * A constructor's type, or a method's self type, fully qualified. A method whose self type is
   * its own module is a module-level function and gets a bare name.
   */
  readonly owner?: string | undefined
}

/**
 * A conversion (`Target.from that`): the language server's `SuggestionJson.isConversion`. The
 * site's generator lists conversions on their target type's page and gives them no page of their
 * own, so the IDE links to none.
 */
export function isConversion(entry: {
  readonly name: string
  readonly isStatic: boolean
  readonly arguments: readonly { readonly name: string }[]
}): boolean {
  return entry.name === 'from' && !entry.isStatic && entry.arguments[0]?.name === 'that'
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * A member's name as a path segment: an identifier as it is, anything else (an operator) as `op-`
 * and its UTF-8 bytes in hex, since `*`, `<`, `>` and `|` are not allowed in Windows file names.
 */
export function memberSegment(name: string): string {
  if (IDENTIFIER.test(name)) return name
  const bytes = new TextEncoder().encode(name)
  return 'op-' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function lastSegment(qualifiedName: string): string {
  return qualifiedName.slice(qualifiedName.lastIndexOf('.') + 1)
}

function required(value: string | undefined, what: string, entry: ApiPathEntry): string {
  if (value == null || value === '')
    throw new Error(`${entry.kind} in ${entry.module} has no ${what}`)
  return value
}

/** The page path of `entry`: `<library>/<module path>/<member>`, with no leading or trailing slash. */
export function apiPath(entry: ApiPathEntry): string {
  const segments = entry.module.split('.')
  if (segments.length < 3) throw new Error(`Not a fully qualified module: ${entry.module}`)
  const library = segments.slice(0, 2).join('.')
  const modulePath = segments.slice(2)
  const isMain = modulePath.length === 1 && modulePath[0] === 'Main'
  const base = [library, ...modulePath]
  switch (entry.kind) {
    case 'module':
      return isMain ? library : base.join('/')
    case 'type':
      return [...base, required(entry.name, 'name', entry)].join('/')
    case 'constructor': {
      const owner = lastSegment(required(entry.owner, 'type', entry))
      return [...base, `${owner}.${memberSegment(required(entry.name, 'name', entry))}`].join('/')
    }
    case 'method': {
      const name = memberSegment(required(entry.name, 'name', entry))
      const owner = required(entry.owner, 'self type', entry)
      return [...base, owner === entry.module ? name : `${lastSegment(owner)}.${name}`].join('/')
    }
  }
}
