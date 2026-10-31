package org.enso.languageserver.search

import io.circe.generic.auto._
import io.circe.syntax._
import io.circe.{Decoder, Encoder, Json}
import org.enso.languageserver.filemanager.{FileSystemFailure, Path}
import org.enso.polyglot.Suggestion
import org.enso.polyglot.SuggestionJson
import org.enso.searcher.SuggestionEntry

object SearchProtocol {

  type SuggestionId = Long

  private object CodecField {

    val Type = "type"
  }

  private object CodecType {

    val Add = "Add"

    val Remove = "Remove"

    val Modify = "Modify"
  }

  implicit val suggestionEncoder: Encoder[Suggestion] =
    SuggestionJson.suggestionEncoder

  implicit val suggestionDecoder: Decoder[Suggestion] =
    SuggestionJson.suggestionDecoder

  /** The object representing a field modification.
    *
    * @param tag the modifying action
    * @param value the updated value
    */
  case class FieldUpdate[A](tag: FieldActions.FieldAction, value: Option[A])

  /** The modifying action on the field. */
  object FieldActions extends Enumeration {
    type FieldAction = Value

    val Remove, Set = Value

    implicit val genderDecoder: Decoder[FieldAction] =
      Decoder.decodeEnumeration(FieldActions)
    implicit val genderEncoder: Encoder[FieldAction] =
      Encoder.encodeEnumeration(FieldActions)
  }

  /** An operation applied to the suggestion argument. */
  sealed trait SuggestionArgumentUpdate
  object SuggestionArgumentUpdate {

    /** Add the argument to a list.
      *
      * @param index the position of the argument
      * @param argument the argument to add
      */
    case class Add(index: Int, argument: Suggestion.Argument)
        extends SuggestionArgumentUpdate

    /** Remove the argument from a list.
      *
      * @param index the position of the arugment
      */
    case class Remove(index: Int) extends SuggestionArgumentUpdate

    /** Modify the argument at the specified index.
      *
      * @param index the position of the argument
      * @param name the name to update
      * @param reprType the argument type to update
      * @param isSuspended the suspended flag to update
      * @param hasDefault the default flag to update
      * @param defaultValue the default value to update
      */
    case class Modify(
      index: Int,
      name: Option[FieldUpdate[String]]         = None,
      reprType: Option[FieldUpdate[String]]     = None,
      isSuspended: Option[FieldUpdate[Boolean]] = None,
      hasDefault: Option[FieldUpdate[Boolean]]  = None,
      defaultValue: Option[FieldUpdate[String]] = None
    ) extends SuggestionArgumentUpdate

    implicit val suggestionArgumentActionDecoder
      : Decoder[SuggestionArgumentUpdate] =
      Decoder.instance { cursor =>
        cursor.downField(CodecField.Type).as[String].flatMap {
          case CodecType.Add =>
            Decoder[SuggestionArgumentUpdate.Add].tryDecode(cursor)

          case CodecType.Remove =>
            Decoder[SuggestionArgumentUpdate.Remove].tryDecode(cursor)

          case CodecType.Modify =>
            Decoder[SuggestionArgumentUpdate.Modify].tryDecode(cursor)
        }
      }

    implicit val suggestionArgumentActionEncoder
      : Encoder[SuggestionArgumentUpdate] =
      Encoder.instance[SuggestionArgumentUpdate] {
        case add: SuggestionArgumentUpdate.Add =>
          Encoder[SuggestionArgumentUpdate.Add]
            .apply(add)
            .deepMerge(Json.obj(CodecField.Type -> CodecType.Add.asJson))
            .dropNullValues

        case remove: SuggestionArgumentUpdate.Remove =>
          Encoder[SuggestionArgumentUpdate.Remove]
            .apply(remove)
            .deepMerge(Json.obj(CodecField.Type -> CodecType.Remove.asJson))
            .dropNullValues

        case modify: SuggestionArgumentUpdate.Modify =>
          Encoder[SuggestionArgumentUpdate.Modify]
            .apply(modify)
            .deepMerge(Json.obj(CodecField.Type -> CodecType.Modify.asJson))
            .dropNullValues
      }
  }

  /** Base trait for suggestion database updaetes. */
  sealed trait SuggestionsDatabaseUpdate
  object SuggestionsDatabaseUpdate {

    /** Create or replace the database entry.
      *
      * @param id the suggestion id
      * @param suggestion the new suggestion
      */
    case class Add(id: SuggestionId, suggestion: Suggestion)
        extends SuggestionsDatabaseUpdate

    /** Remove the database entry.
      *
      * @param id the suggestion id
      */
    case class Remove(id: SuggestionId) extends SuggestionsDatabaseUpdate

    /** Modify the database entry.
      *
      * @param id the suggestion id
      * @param externalId the external id to update
      * @param arguments the arguments to update
      * @param module the module name to update
      * @param selfType the self type to update
      * @param returnType the return type to update
      * @param documentation the documentation string to update
      * @param scope the scope to update
      * @param reexport the module reexporting the suggestion
      */
    case class Modify(
      id: SuggestionId,
      externalId: Option[FieldUpdate[Suggestion.ExternalID]] = None,
      arguments: Option[Seq[SuggestionArgumentUpdate]]       = None,
      module: Option[FieldUpdate[String]]                    = None,
      selfType: Option[FieldUpdate[String]]                  = None,
      returnType: Option[FieldUpdate[String]]                = None,
      documentation: Option[FieldUpdate[String]]             = None,
      scope: Option[FieldUpdate[Suggestion.Scope]]           = None,
      reexport: Option[FieldUpdate[String]]                  = None
    ) extends SuggestionsDatabaseUpdate

    implicit val decoder: Decoder[SuggestionsDatabaseUpdate] =
      Decoder.instance { cursor =>
        cursor.downField(CodecField.Type).as[String].flatMap {
          case CodecType.Add =>
            Decoder[SuggestionsDatabaseUpdate.Add].tryDecode(cursor)

          case CodecType.Remove =>
            Decoder[SuggestionsDatabaseUpdate.Remove].tryDecode(cursor)

          case CodecType.Modify =>
            Decoder[SuggestionsDatabaseUpdate.Modify].tryDecode(cursor)
        }
      }

    implicit val encoder: Encoder[SuggestionsDatabaseUpdate] =
      Encoder.instance[SuggestionsDatabaseUpdate] {
        case add: SuggestionsDatabaseUpdate.Add =>
          Encoder[SuggestionsDatabaseUpdate.Add]
            .apply(add)
            .deepMerge(Json.obj(CodecField.Type -> CodecType.Add.asJson))
            .dropNullValues

        case remove: SuggestionsDatabaseUpdate.Remove =>
          Encoder[SuggestionsDatabaseUpdate.Remove]
            .apply(remove)
            .deepMerge(Json.obj(CodecField.Type -> CodecType.Remove.asJson))

        case modify: SuggestionsDatabaseUpdate.Modify =>
          Encoder[SuggestionsDatabaseUpdate.Modify]
            .apply(modify)
            .deepMerge(Json.obj(CodecField.Type -> CodecType.Modify.asJson))
            .dropNullValues
      }
  }

  /** The entry in the suggestions database.
    *
    * @param id the suggestion id
    * @param suggestion the suggestion
    */
  case class SuggestionDatabaseEntry(id: SuggestionId, suggestion: Suggestion)

  object SuggestionDatabaseEntry {

    /** Create the database entry from the polyglot suggestion entry.
      *
      * @param entry the suggestion entry
      * @return the database entry
      */
    def apply(entry: SuggestionEntry): SuggestionDatabaseEntry =
      new SuggestionDatabaseEntry(entry.id, entry.suggestion)

    private object CodecField {

      val Id = "id"

      val Suggestion = "suggestion"
    }

    implicit val encoder: Encoder[SuggestionDatabaseEntry] =
      Encoder.instance { entry =>
        Json.obj(
          CodecField.Id         -> entry.id.asJson,
          CodecField.Suggestion -> Encoder[Suggestion].apply(entry.suggestion)
        )
      }

    implicit val decoder: Decoder[SuggestionDatabaseEntry] =
      Decoder.instance { cursor =>
        for {
          id         <- cursor.downField(CodecField.Id).as[SuggestionId]
          suggestion <- cursor.downField(CodecField.Suggestion).as[Suggestion]
        } yield SuggestionDatabaseEntry(id, suggestion)
      }
  }

  /** A notification about changes in the suggestions database.
    *
    * @param currentVersion current version of the suggestions database
    * @param updates the list of database updates
    */
  case class SuggestionsDatabaseUpdateNotification(
    currentVersion: Long,
    updates: Seq[SuggestionsDatabaseUpdate]
  )

  /** A request to clear the suggestions database. */
  case object ClearSuggestionsDatabase

  /** The request to receive contents of the suggestions database. */
  case object GetSuggestionsDatabase

  /** The reply to the [[GetSuggestionsDatabase]] request.
    *
    * @param currentVersion current version of the suggestions database
    * @param entries the entries of the suggestion database
    */
  case class GetSuggestionsDatabaseResult(
    currentVersion: Long,
    entries: Seq[SuggestionDatabaseEntry]
  )

  /** The request to receive the current version of the suggestions database. */
  case object GetSuggestionsDatabaseVersion

  /** The reply to the [[GetSuggestionsDatabaseVersion]] request.
    *
    * @param version current version of the suggestions database
    */
  case class GetSuggestionsDatabaseVersionResult(version: Long)

  /** Base trait for export statements. */
  sealed trait Export {
    def module: String
  }
  object Export {

    /** Qualified module re-export.
      *
      * @param module the module name that exports the given module
      * @param alias new module name if the module was renamed in the export
      * clause
      */
    case class Qualified(module: String, alias: Option[String]) extends Export

    /** Unqualified module export.
      *
      * @param module the module name that exports the given module
      */
    case class Unqualified(module: String) extends Export

    private object CodecType {

      val Qualified = "Qualified"

      val Unqualified = "Unqualified"
    }

    implicit val encoder: Encoder[Export] =
      Encoder.instance {
        case qualified: Qualified =>
          Encoder[Export.Qualified]
            .apply(qualified)
            .deepMerge(Json.obj(CodecField.Type -> CodecType.Qualified.asJson))
            .dropNullValues

        case unqualified: Unqualified =>
          Encoder[Export.Unqualified]
            .apply(unqualified)
            .deepMerge(
              Json.obj(CodecField.Type -> CodecType.Unqualified.asJson)
            )
            .dropNullValues
      }

    implicit val decoder: Decoder[Export] =
      Decoder.instance { cursor =>
        cursor.downField(CodecField.Type).as[String].flatMap {
          case CodecType.Qualified =>
            Decoder[Export.Qualified].tryDecode(cursor)

          case CodecType.Unqualified =>
            Decoder[Export.Unqualified].tryDecode(cursor)
        }
      }
  }

  /** The request to invalidate the modules index. */
  case object InvalidateModulesIndex

  /** The request to invalidate the suggestions database. */
  case object InvalidateSuggestionsDatabase

  /** The reply to the invalidate request. */
  case object InvalidateSuggestionsDatabaseResult

  /** Base trait for search request errors. */
  sealed trait SearchFailure

  /** Signals about file system error. */
  case class FileSystemError(e: FileSystemFailure) extends SearchFailure

  /** Signals that the project not found in the root directory. */
  case object ProjectNotFoundError extends SearchFailure

  /** Signals that the requested suggestion was not found. */
  case object SuggestionNotFoundError extends SearchFailure

  /** Signals that the module name can not be resolved for the given file.
    *
    * @param file the file path
    */
  case class ModuleNameNotResolvedError(file: Path) extends SearchFailure
}
