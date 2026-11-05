import { TypeInfo } from '$/providers/openedProjects/project/computedValueRegistry'
import { parseAbsoluteProjectPathRaw, type AbsoluteProjectPath } from '@/util/projectPath'

/** Split the text at every top-level (outside brackets) occurrence of the operator. */
function splitTopLevel(text: string, operator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && c === operator && text[i - 1] === ' ' && text[i + 1] === ' ') {
      parts.push(text.slice(start, i - 1))
      start = i + 2
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim())
}

/** Remove the brackets that enclose the whole of the text. */
function unwrapBrackets(text: string): string {
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0
    for (let i = 0; i < text.length - 1; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
      if (depth === 0) return text
    }
    text = text.slice(1, -1).trim()
  }
  return text
}

/** The type an operand of an intersection stands for, if it is a single, named type. */
function operandType(operand: string): AbsoluteProjectPath | undefined {
  const text = unwrapBrackets(operand)
  if (splitTopLevel(text, '|').length > 1 || text.includes('->')) return undefined
  // An applied type, `Vector Text`, is a value of its head type.
  const head = text.split(' ')[0]
  if (head == null || head.startsWith('(')) return undefined
  const parsed = parseAbsoluteProjectPathRaw(head)
  return parsed.ok ? parsed.value : undefined
}

/**
 * Type information for a suggestion's return type as the engine prints it. An intersection such as
 * `Standard.Base.Table.Table & Standard.Base.Any.Any` is a value of every one of its types, so each
 * operand that is a single named type (or an application of one) is a visible type. A union is a
 * value of one of its types, which is not known, so it gives no type information.
 */
export function returnTypeInfo(returnType: string): TypeInfo | undefined {
  const text = unwrapBrackets(returnType.trim())
  if (splitTopLevel(text, '|').length > 1) return undefined
  const types = splitTopLevel(text, '&').flatMap((operand) => {
    const type = operandType(operand)
    return type ? [type] : []
  })
  return TypeInfo.fromParsedTypes(types, [])
}
