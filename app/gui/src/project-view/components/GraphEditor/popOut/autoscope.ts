import { Ast } from '@/util/ast'
import { qnLastSegment } from '@/util/qualifiedName'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'

/** What `qualifyAutoscoped` needs to know: does `typeQn` (fully qualified) have a constructor `name`? */
export type HasConstructor = (typeQn: string, name: string) => boolean

/** The auto-scoped identifiers of `expr`, in `visitRecursive` order. */
function autoscopedIn(expr: Ast.Ast): Ast.AutoscopedIdentifier[] {
  const found: Ast.AutoscopedIdentifier[] = []
  Ast.visitRecursive(expr, (ast) => {
    if (ast instanceof Ast.AutoscopedIdentifier) found.push(ast)
    return true
  })
  return found
}

/** The type expected at an auto-scoped name: at the name itself, else at its enclosing application. */
function expectedTypeAt(
  ast: Ast.AutoscopedIdentifier,
  expectedTypes: ReadonlyMap<Ast.AstId, string>,
): string | undefined {
  const own = expectedTypes.get(ast.id)
  if (own != null) return own
  const parent = ast.parent()
  if (parent instanceof Ast.App && parent.function.id === ast.id)
    return expectedTypes.get(parent.id)
}

/**
 * The expression's code with each auto-scoped constructor (`..Month`, including the head of an
 * application such as `..Week Day_Of_Week.Sunday`) written as `<Type>.<Constructor>`, where
 * `<Type>` is the last segment of the type expected at that position. `expectedTypes` maps an
 * AST id to the expected type there (as the language server reports it, e.g.
 * `Standard.Base.Data.Time.Date_Period.Date_Period`, or a union `A | B`); the type of an
 * auto-scoped name is looked up at the name itself, then at its enclosing application.
 * For a union, the member that `hasConstructor` confirms is used.
 * Returns `Err(name)` naming the first constructor whose type cannot be determined.
 */
export function qualifyAutoscoped(
  expr: Ast.Expression,
  expectedTypes: ReadonlyMap<Ast.AstId, string>,
  hasConstructor: HasConstructor,
): Result<string, string> {
  // Types are keyed by the original's ids, so resolve them there, then rewrite a copy of the same
  // shape in the same order.
  const originals = autoscopedIn(expr)
  const types = originals.map((ast) => expectedTypeAt(ast, expectedTypes))
  const copy = Ast.copyIntoNewModule(expr)
  const targets = autoscopedIn(copy)
  if (targets.length !== originals.length) return Err('..')
  const replacements: [Ast.AutoscopedIdentifier, string][] = []
  for (const [i, target] of targets.entries()) {
    const name = target.identifier.code()
    const type = types[i]
    const members = type?.split('|').map((member) => member.trim()) ?? []
    const member = members.length === 1 ? members[0] : members.find((m) => hasConstructor(m, name))
    if (!member) return Err(`..${name}`)
    replacements.push([target, `${qnLastSegment(member as Ast.QualifiedName)}.${name}`])
  }
  for (const [target, code] of replacements) {
    const replacement = Ast.parseExpression(code, copy.module)
    if (!replacement) return Err(`..${target.identifier.code()}`)
    if (target.id === copy.id) return Ok(replacement.code())
    copy.module.replace(target.id, replacement)
  }
  return Ok(copy.code())
}
