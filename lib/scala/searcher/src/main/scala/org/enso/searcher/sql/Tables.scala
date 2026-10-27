package org.enso.searcher.sql

import org.enso.polyglot.Suggestion

object ScopeColumn {

  /** A constant representing an empty value in the scope column. */
  val EMPTY: Int = -1
}

object SelfTypeColumn {

  /** A constant representing en empty value in the self type column. */
  val EMPTY: String = "\u0500"
}

object NameColumn {

  /** Create the method name for conversion */
  def conversionMethodName(
    sourceType: String,
    returnType: String
  ): String =
    s"${Suggestion.Kind.Conversion.From}_${sourceType}_${returnType}"

}

/** An element of unique suggestion index.
  *
  * @param kind the type of a suggestion
  * @param module the module name
  * @param name the suggestion name
  * @param selfType the self type of a suggestion
  * @param scopeStartLine the line of the start position of the scope
  * @param scopeStartOffset the offset of the start position of the scope
  * @param scopeEndLine the line of the end position of the scope
  * @param scopeEndOffset the offset of the end position of the scope
  */
final case class SuggestionRowUniqueIndex(
  kind: Suggestion.Kind,
  module: String,
  name: String,
  selfType: String,
  scopeStartLine: Int,
  scopeStartOffset: Int,
  scopeEndLine: Int,
  scopeEndOffset: Int
)

object SuggestionRowUniqueIndex {

  /** Create an index element from the provided suggestion.
    *
    * @param suggestion the suggestion
    * @return an index element representing the provided suggestion
    */
  def apply(suggestion: Suggestion): SuggestionRowUniqueIndex = {
    val scope = Suggestion.Scope(suggestion)
    val suggestionName = suggestion match {
      case conversion: Suggestion.Conversion =>
        NameColumn.conversionMethodName(
          conversion.arguments.head.reprType,
          conversion.returnType
        )
      case _ => suggestion.name
    }
    new SuggestionRowUniqueIndex(
      Suggestion.Kind(suggestion),
      suggestion.module,
      suggestionName,
      Suggestion.SelfType(suggestion).getOrElse(SelfTypeColumn.EMPTY),
      scope.map(_.start.line).getOrElse(ScopeColumn.EMPTY),
      scope.map(_.start.character).getOrElse(ScopeColumn.EMPTY),
      scope.map(_.end.line).getOrElse(ScopeColumn.EMPTY),
      scope.map(_.end.character).getOrElse(ScopeColumn.EMPTY)
    )
  }
}
