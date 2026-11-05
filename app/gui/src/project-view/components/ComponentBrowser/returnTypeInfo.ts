import { TypeInfo } from '$/providers/openedProjects/project/computedValueRegistry'
import { parseAbsoluteProjectPathRaw, type AbsoluteProjectPath } from '@/util/projectPath'

/**
 * Type information for a suggestion's return type as the engine prints it. An intersection such as
 * `Standard.Base.Table.Table & Standard.Base.Any.Any` is a value of every one of its types, so each
 * operand is a visible type; an operand that is not a plain qualified name is skipped.
 */
export function returnTypeInfo(returnType: string): TypeInfo | undefined {
  const types = returnType
    .split(' & ')
    .map((operand) => parseAbsoluteProjectPathRaw(operand.trim()))
    .flatMap((parsed): AbsoluteProjectPath[] => (parsed.ok ? [parsed.value] : []))
  return TypeInfo.fromParsedTypes(types, [])
}
