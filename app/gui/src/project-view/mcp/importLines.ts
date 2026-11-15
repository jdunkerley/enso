/**
 * @file Whole import lines from an MCP tool (`from Standard.Table import all`), parsed and added
 * to a module when it does not have them.
 */
import { newImportsLocation, recognizeImport } from '$/providers/openedProjects/module/imports'
import { Ast } from '@/util/ast'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { truncate } from './graphTools'

/** Most characters of a statement or line quoted back in an error. */
export const QUOTE_CHARS = 200

/** The text quoted back to the agent in an error, cut to {@link QUOTE_CHARS}. */
export function quote(text: string): string {
  return truncate(text, QUOTE_CHARS)
}

/** Whether the parser marked any part of `ast` as invalid. */
export function hasSyntaxError(ast: Ast.Ast): boolean {
  let found = false
  Ast.visitRecursive(ast, (node) => {
    if (node instanceof Ast.Invalid) found = true
    return !found
  })
  return found
}

/**
 * Parses whole import lines (`from Standard.Excel import all`, `import Standard.Base.Data.Text`).
 * Err names the first line that is not an import.
 */
export function parseImportLines(
  lines: readonly string[],
): Result<Ast.Owned<Ast.MutableStatement>[]> {
  const imports: Ast.Owned<Ast.MutableStatement>[] = []
  for (const line of lines) {
    const statement = Ast.parseModuleStatement(line)
    if (
      !(statement instanceof Ast.Import) ||
      hasSyntaxError(statement) ||
      recognizeImport(statement) == null
    ) {
      return Err(
        `Not an import line: \`${quote(line)}\`. ` +
          'Pass whole import lines, such as `from Standard.Table import all`.',
      )
    }
    imports.push(statement)
  }
  return Ok(imports)
}

/**
 * Adds the lines that the module does not already have (compared by normalised code), after the
 * existing imports. Returns how many were added. When any line is not an import, adds none.
 */
export function addImportLines(edit: Ast.MutableModule, lines: readonly string[]): Result<number> {
  const parsed = parseImportLines(lines)
  if (!parsed.ok) return parsed
  const root = edit.root()
  if (!(root instanceof Ast.MutableBodyBlock)) return Err('The module has no top-level block.')
  const present = new Set<string>()
  for (const statement of root.statements()) {
    if (statement instanceof Ast.Import) present.add(normalizedCode(statement))
  }
  const toAdd: Ast.Owned<Ast.MutableStatement>[] = []
  for (const statement of parsed.value) {
    const code = normalizedCode(statement)
    if (present.has(code)) continue
    present.add(code)
    // Parsed again into `edit`: the validated copy lives in a transient module.
    const added = Ast.parseModuleStatement(code, edit)
    if (added == null) return Err(`Not an import line: \`${quote(code)}\`.`)
    toAdd.push(added)
  }
  if (toAdd.length > 0) root.insert(newImportsLocation(root), ...toAdd)
  return Ok(toAdd.length)
}

/** The import's code with each run of whitespace made one space. */
function normalizedCode(statement: Ast.Ast): string {
  return statement.code().trim().replace(/\s+/g, ' ')
}
