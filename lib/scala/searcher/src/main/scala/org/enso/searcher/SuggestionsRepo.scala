package org.enso.searcher

import org.enso.polyglot.Suggestion
import org.enso.polyglot.runtime.Runtime.Api.{
  ExportsUpdate,
  SuggestionUpdate,
  SuggestionsDatabaseAction
}
import org.enso.searcher.data.QueryResult
import org.enso.searcher.sql.SuggestionRowUniqueIndex

import scala.collection.mutable

/** The object for accessing the suggestions database. */
trait SuggestionsRepo[F[_]] {

  /** Initialize the repo. */
  def init: F[Unit]

  /** Get current version of the repo. */
  def currentVersion: F[Long]

  /** Get all suggestions.
    *
    * @return the current database version and the list of suggestions
    */
  def getAll: F[(Long, Seq[SuggestionEntry])]

  /** Insert the suggestion.
    *
    * @param suggestion the suggestion to insert
    * @return the id of an inserted suggestion
    */
  def insert(suggestion: Suggestion): F[Option[Long]]

  /** Insert a list of suggestions.
    *
    * @param suggestions the suggestions to insert
    * @return the current database version and a list of inserted suggestion ids
    */
  def insertAll(suggestions: Seq[Suggestion]): F[(Long, Seq[Long])]

  /** Apply suggestion updates.
    *
    * @param tree the sequence of suggestion updates
    * @return the result of applying the updates
    */
  def applyTree(
    tree: Seq[SuggestionUpdate]
  ): F[Seq[QueryResult[SuggestionUpdate]]]

  /** Apply the sequence of actions on the database.
    *
    * @param actions the list of actions
    * @return the result of applying the actions
    */
  def applyActions(
    actions: Seq[SuggestionsDatabaseAction]
  ): F[Seq[QueryResult[SuggestionsDatabaseAction]]]

  /** Get the suggestions related to the export updates.
    *
    * @param actions the list of updates
    * @return the suggestions ids associated with the export updates
    */
  def getExportedSymbols(
    actions: Seq[ExportsUpdate]
  ): F[Seq[QueryResult[ExportsUpdate]]]

  /** Remove suggestions by module names.
    *
    * @param modules the list of module names
    * @return the current database version and a list of removed suggestion ids
    */
  def removeModules(modules: Seq[String]): F[(Long, Seq[Long])]

  /** Remove suggestions by their ids.
    *
    * @param ids the ids of the suggestions to remove
    * @return the current database version and the ids that were removed
    */
  def removeAll(ids: Seq[Long]): F[(Long, Seq[Long])]

  /** Cleans the repo resetting the version. */
  def clean: F[Unit]
}

object SuggestionsRepo {

  /** Splits `suggestions` into those `insertAll` accepts together and the
    * duplicates it would reject: a suggestion whose
    * [[SuggestionRowUniqueIndex]] an earlier one has.
    *
    * @return the first suggestion of each index, in order, and the rest
    */
  def partitionDuplicates(
    suggestions: Seq[Suggestion]
  ): (Seq[Suggestion], Seq[Suggestion]) = {
    val seen = mutable.HashSet[SuggestionRowUniqueIndex]()
    suggestions.partition(s => seen.add(SuggestionRowUniqueIndex(s)))
  }
}
