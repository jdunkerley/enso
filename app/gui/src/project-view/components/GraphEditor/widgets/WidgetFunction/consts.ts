import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import type { Identifier } from 'ydoc-shared/ast'

/** The module of the IDE's widget query (`Standard.Base.Metadata.Widget_Query`). */
export const WIDGET_QUERY_MODULE = 'Standard.Base.Metadata.Widget_Query'
export const WIDGET_QUERY_PATH = ProjectPath.create(
  'Standard.Base' as QualifiedName,
  'Metadata.Widget_Query' as QualifiedName,
)
/** The widget query of a call: `resolve_call`. */
export const RESOLVE_CALL = 'resolve_call' as Identifier
// Structurally a `MethodPointer`; not annotated, so this file (part of `tsconfig.node.json`'s closed file set) does not pull `methodPointer.ts` in.
export const RESOLVE_CALL_POINTER = {
  module: WIDGET_QUERY_PATH,
  definedOnType: WIDGET_QUERY_PATH,
  name: RESOLVE_CALL,
}
