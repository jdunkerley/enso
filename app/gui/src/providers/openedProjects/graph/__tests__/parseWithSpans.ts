import { assertDefined } from '@/util/assert'
import { Ast } from '@/util/ast'
import type { AstId } from 'ydoc-shared/ast'
import type { SourceRange } from 'ydoc-shared/util/data/text'
import { IdMap, type ExternalId } from 'ydoc-shared/yjsModel'

/**
 * Parse `code`, giving the expressions at the named `spans` stable external ids. Returns the AST
 * and lookups from a span's name to its external id and AST id.
 *
 * A test helper shared by several suites. It lives outside any `*.test.ts` file because
 * importing a test file runs that file's tests as well.
 */
export function parseWithSpans<T extends Record<string, SourceRange>>(code: string, spans: T) {
  const nameToEid = new Map<keyof T, ExternalId>()
  const eid = (name: keyof T) => nameToEid.get(name)!

  const idMap = IdMap.Mock()
  let nextIndex = 0
  for (const name in spans) {
    const span = spans[name]!
    assertDefined(span)
    const indexStr = `${nextIndex++}`
    const eid =
      idMap.getIfExist(span) ??
      (('00000000-0000-0000-0000-000000000000'.slice(0, -indexStr.length) + indexStr) as ExternalId)
    nameToEid.set(name, eid)
    idMap.insertKnownId(span, eid)
  }

  const { root: ast, getSpan } = Ast.parseUpdatingIdMap(code, idMap)
  const idFromExternal = new Map<ExternalId, AstId>()
  Ast.visitRecursive(ast, (ast) => {
    idFromExternal.set(ast.externalId, ast.id)
  })
  const id = (name: keyof T) => idFromExternal.get(eid(name))!

  return { ast, id, eid, getSpan }
}
