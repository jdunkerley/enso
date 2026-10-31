package org.enso.polyglot

import io.circe.generic.auto._
import io.circe.syntax._
import io.circe.{Decoder, Encoder, HCursor, Json}
import org.enso.pkg.QualifiedName

/** The JSON form of a [[Suggestion]]: what the language server sends in
  * `search/suggestionsDatabaseUpdates`, and what a library's `catalogue.json`
  * holds ([[LibraryCatalogue]]). One codec, so that the two cannot differ.
  */
object SuggestionJson {

  private object CodecField {

    val Type = "type"

    val ExternalId = "externalId"

    val Module = "module"

    val Name = "name"

    val Params = "params"

    val ReturnType = "returnType"

    val ParentType = "parentType"

    val Documentation = "documentation"

    val Reexport = "reexport"

    val Reexports = "reexports"

    val Arguments = "arguments"

    val IsStatic = "isStatic"
  }

  private object SuggestionType {

    val Module = "module"

    val Type = "type"

    val Constructor = "constructor"

    val Method = "method"

    val Function = "function"

    val Local = "local"
  }

  implicit val suggestionEncoder: Encoder[Suggestion] =
    Encoder.instance[Suggestion] {
      case module: Suggestion.Module =>
        Encoder[Suggestion.Module]
          .apply(module)
          .deepMerge(
            Json.obj(
              CodecField.Type     -> SuggestionType.Module.asJson,
              CodecField.Reexport -> module.reexports.headOption.asJson
            )
          )

      case tpe: Suggestion.Type =>
        Encoder[Suggestion.Type]
          .apply(tpe)
          .deepMerge(
            Json.obj(
              CodecField.Type       -> SuggestionType.Type.asJson,
              CodecField.ReturnType -> Json.Null,
              CodecField.Reexport   -> tpe.reexports.headOption.asJson
            )
          )
          .dropNullValues

      case constructor: Suggestion.Constructor =>
        Encoder[Suggestion.Constructor]
          .apply(constructor)
          .deepMerge(
            Json.obj(
              CodecField.Type     -> SuggestionType.Constructor.asJson,
              CodecField.Reexport -> constructor.reexports.headOption.asJson
            )
          )
          .dropNullValues

      case conversion: Suggestion.Conversion =>
        Encoder[Suggestion.DefinedMethod]
          .apply(conversionToMethod(conversion))
          .deepMerge(
            Json.obj(
              CodecField.Type     -> SuggestionType.Method.asJson,
              CodecField.Reexport -> conversion.reexports.headOption.asJson
            )
          )
          .dropNullValues

      case getter: Suggestion.Getter =>
        Encoder[Suggestion.DefinedMethod]
          .apply(getterToMethod(getter))
          .deepMerge(
            Json.obj(
              CodecField.Type     -> SuggestionType.Method.asJson,
              CodecField.Reexport -> getter.reexports.headOption.asJson
            )
          )
          .dropNullValues

      case method: Suggestion.DefinedMethod =>
        Encoder[Suggestion.DefinedMethod]
          .apply(method)
          .deepMerge(
            Json.obj(
              CodecField.Type     -> SuggestionType.Method.asJson,
              CodecField.Reexport -> method.reexports.headOption.asJson
            )
          )
          .dropNullValues

      case function: Suggestion.Function =>
        Encoder[Suggestion.Function]
          .apply(function)
          .deepMerge(
            Json.obj(CodecField.Type -> SuggestionType.Function.asJson)
          )
          .dropNullValues

      case local: Suggestion.Local =>
        Encoder[Suggestion.Local]
          .apply(local)
          .deepMerge(Json.obj(CodecField.Type -> SuggestionType.Local.asJson))
          .dropNullValues
    }

  private def conversionToMethod(
    conversion: Suggestion.Conversion
  ): Suggestion.DefinedMethod =
    Suggestion.DefinedMethod(
      conversion.externalId,
      conversion.module,
      conversion.name,
      conversion.arguments,
      conversion.selfType,
      conversion.returnType,
      conversion.isStatic,
      conversion.documentation,
      conversion.annotations,
      conversion.reexports
    )

  private def getterToMethod(
    getter: Suggestion.Getter
  ): Suggestion.DefinedMethod =
    Suggestion.DefinedMethod(
      getter.externalId,
      getter.module,
      getter.name,
      getter.arguments,
      getter.selfType,
      getter.returnType,
      getter.isStatic,
      getter.documentation,
      getter.annotations,
      getter.reexports
    )

  private val suggestionTypeDecoder: Decoder[Suggestion.Type] =
    Decoder.instance { cursor =>
      for {
        externalId <- cursor
          .downField(CodecField.ExternalId)
          .as[Option[Suggestion.ExternalID]]
        module <- cursor.downField(CodecField.Module).as[String]
        name   <- cursor.downField(CodecField.Name).as[String]
        params <- cursor
          .downField(CodecField.Params)
          .as[Seq[Suggestion.Argument]]
        parentType <- cursor.downField(CodecField.ParentType).as[Option[String]]
        documentation <- cursor
          .downField(CodecField.Documentation)
          .as[Option[String]]
        reexports <- cursor.downField(CodecField.Reexports).as[Set[String]]
      } yield {
        val returnType =
          QualifiedName.fromString(module).createChild(name).toString
        Suggestion.Type(
          externalId,
          module,
          name,
          params,
          returnType,
          parentType,
          documentation,
          reexports
        )
      }
    }

  implicit val suggestionDecoder: Decoder[Suggestion] =
    Decoder.instance { cursor =>
      cursor.downField(CodecField.Type).as[String].flatMap {
        case SuggestionType.Module =>
          Decoder[Suggestion.Module].tryDecode(cursor)

        case SuggestionType.Type =>
          suggestionTypeDecoder.tryDecode(cursor)

        case SuggestionType.Constructor =>
          Decoder[Suggestion.Constructor].tryDecode(cursor)

        case SuggestionType.Method =>
          // Not `Decoder[Suggestion.Method]`: circe derives that for the sealed
          // trait and expects a wrapper object, which the encoder never writes.
          // A conversion is written as a method (`conversionToMethod`) and is
          // read back as one, so that the repository keeps two conversions to
          // one type apart (`SuggestionRowUniqueIndex`). Getters read back as
          // methods, with the same JSON.
          if (isConversion(cursor))
            Decoder[Suggestion.Conversion].tryDecode(cursor)
          else Decoder[Suggestion.DefinedMethod].tryDecode(cursor)

        case SuggestionType.Function =>
          Decoder[Suggestion.Function].tryDecode(cursor)

        case SuggestionType.Local =>
          Decoder[Suggestion.Local].tryDecode(cursor)
      }
    }

  /** Whether a `"method"` is a written conversion: named `from`, not static,
    * with `that` as its first argument (`buildConversion` drops `self`, so an
    * instance method's first argument is `self` instead).
    */
  private def isConversion(cursor: HCursor): Boolean =
    cursor
      .get[String](CodecField.Name)
      .contains(Suggestion.Kind.Conversion.From) &&
    !cursor.get[Boolean](CodecField.IsStatic).getOrElse(false) &&
    cursor
      .downField(CodecField.Arguments)
      .downArray
      .get[String](CodecField.Name)
      .contains("that")
}
