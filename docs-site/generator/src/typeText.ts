/** A fully qualified name inside a type expression (`Standard.Base.Data.Text.Text`). */
export const QUALIFIED_NAME = /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\b/g

/** The last segment of a qualified name. */
export function simpleName(qualifiedName: string): string {
  return qualifiedName.slice(qualifiedName.lastIndexOf('.') + 1)
}

/** A type expression with every qualified name shortened, as the graph editor shows types. */
export function unqualifiedType(type: string): string {
  return type.replace(QUALIFIED_NAME, simpleName)
}
