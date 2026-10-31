package org.enso.polyglot

import io.circe.Json
import io.circe.parser.parse
import io.circe.syntax._
import org.enso.pkg.PackageManager
import org.enso.polyglot.SuggestionJson.{suggestionDecoder, suggestionEncoder}

import java.io.File
import java.nio.file.Files
import scala.jdk.CollectionConverters._
import scala.util.{Failure, Success, Try}

/** A library's `catalogue.json`: its global suggestions that the component
  * browser shows, in the language server's JSON form ([[SuggestionJson]]), so
  * that the IDE can offer them before the library is loaded. `enso --compile`
  * writes it; the language server reads it (Note [Library Catalogue] in
  * `TruffleCompilerContext`).
  *
  * @param library the library's qualified name, e.g. `Standard.AWS`
  * @param version the library's version, from its `package.yaml`
  * @param engineVersion the version of the engine that wrote it
  * @param sourceHash `Package.sourceHash` of the sources it was written from
  * @param entries the published suggestions
  */
final case class LibraryCatalogue(
  library: String,
  version: String,
  engineVersion: String,
  sourceHash: String,
  entries: Seq[Suggestion]
) {

  /** @return the file's content */
  def toJson: String =
    Json
      .obj(
        "format"        -> LibraryCatalogue.Format.asJson,
        "library"       -> library.asJson,
        "version"       -> version.asJson,
        "engineVersion" -> engineVersion.asJson,
        "sourceHash"    -> sourceHash.asJson,
        "entries"       -> entries.asJson
      )
      .noSpaces
}

object LibraryCatalogue {

  /** The format this code writes and reads. */
  val Format: Int = 1

  /** The file's name, next to the library's `package.yaml`. */
  val FileName: String = "catalogue.json"

  /** The GUI's rule for an internal module (`isInternalModulePath` in
    * `filtering.ts`), on the module's path inside its library. Unlike the GUI,
    * which hides such modules only for `Standard.*` libraries and shows their
    * methods when the self type is known, the catalogue leaves them out of
    * every library, always: those entries appear once the library is loaded.
    */
  private val InternalModule = "Internal(?:[._]|$)".r

  private val PrivateFlag = "private:\\s*true".r

  /** The catalogue of `suggestions`, keeping those [[isPublished]] allows. */
  def create(
    library: String,
    version: String,
    engineVersion: String,
    sourceHash: String,
    suggestions: java.util.List[Suggestion]
  ): LibraryCatalogue =
    LibraryCatalogue(
      library,
      version,
      engineVersion,
      sourceHash,
      suggestions.asScala.toVector.filter(isPublished)
    )

  /** @return whether the suggestion belongs in a catalogue: a global one, not
    * in an `Internal` module and not marked `private: true`
    */
  def isPublished(suggestion: Suggestion): Boolean =
    Suggestion.isGlobal(suggestion) &&
    !isInternalModule(suggestion.module) &&
    !isPrivate(suggestion.documentation)

  /** @param module a module's qualified name
    * @return whether the GUI treats the module as internal
    */
  def isInternalModule(module: String): Boolean = {
    val path = module.split('.').drop(2).mkString(".")
    InternalModule.findFirstIn(path).isDefined
  }

  /** @return whether the documentation's front matter (`---` … `---` at its
    * start) says `private: true`, as the GUI reads it (`extractMetadata`)
    */
  def isPrivate(documentation: Option[String]): Boolean =
    documentation.exists { doc =>
      val lines = doc.linesIterator.map(_.strip).dropWhile(_.isEmpty)
      lines.hasNext && lines.next() == "---" &&
      lines.takeWhile(_ != "---").exists(PrivateFlag.matches)
    }

  /** Reads a catalogue, leaving out the entries it cannot decode.
    *
    * @return the catalogue and, for each entry left out, why; or why the text
    * is not a catalogue this code reads (its header)
    */
  def read(text: String): Either[String, (LibraryCatalogue, Seq[String])] =
    for {
      json <- parse(text).left.map(_.getMessage)
      cursor = json.hcursor
      format <- cursor.get[Int]("format").left.map(_.getMessage)
      _ <- Either.cond(
        format == Format,
        (),
        s"format $format, this engine reads $Format"
      )
      header <- (for {
        library       <- cursor.get[String]("library")
        version       <- cursor.get[String]("version")
        engineVersion <- cursor.get[String]("engineVersion")
        sourceHash    <- cursor.get[String]("sourceHash")
        entries       <- cursor.get[Vector[Json]]("entries")
      } yield (library, version, engineVersion, sourceHash, entries)).left
        .map(_.getMessage)
    } yield {
      val (library, version, engineVersion, sourceHash, entries) = header
      val decoded                                                = entries.map(_.as[Suggestion])
      val skipped = decoded.zipWithIndex.collect { case (Left(error), index) =>
        s"entry $index: ${error.getMessage}"
      }
      val catalogue = LibraryCatalogue(
        library,
        version,
        engineVersion,
        sourceHash,
        decoded.collect { case Right(suggestion) => suggestion }
      )
      (catalogue, skipped)
    }

  /** Whether a library's catalogue can be used. */
  sealed trait Validation
  object Validation {

    /** The library's `package.yaml` says `catalogue: false`. */
    case object Declined extends Validation

    /** @param reason why the catalogue cannot be used */
    final case class Unusable(reason: String) extends Validation

    /** @param catalogue the catalogue
      * @param skipped why each entry left out of it was
      */
    final case class Usable(catalogue: LibraryCatalogue, skipped: Seq[String])
        extends Validation
  }

  /** Checks the catalogue of a library, as the language server uses it: it
    * is there, its header parses, its format is [[Format]], it names the
    * library and its `sourceHash` equals `Package.sourceHash` of the
    * library's sources.
    *
    * @param library the library's qualified name
    * @param root the library's root directory
    * @param checkHash whether to hash the sources (false when they are known
    * to match already)
    * @return whether the catalogue can be used, with its entries if it can
    */
  def validate(
    library: String,
    root: File,
    checkHash: Boolean = true
  ): Validation = {
    val file = root.toPath.resolve(FileName)
    PackageManager.Default.loadPackage(root) match {
      case Failure(error) =>
        Validation.Unusable(
          s"the library cannot be read (${error.getMessage})"
        )
      case Success(pkg) if !pkg.getConfig().catalogue => Validation.Declined
      case Success(_) if !Files.isRegularFile(file) =>
        Validation.Unusable("there is none")
      case Success(pkg) =>
        Try(Files.readString(file)).toEither.left
          .map(_.getMessage)
          .flatMap(read) match {
          case Left(error) => Validation.Unusable(s"it cannot be read ($error)")
          case Right((catalogue, _)) if catalogue.library != library =>
            Validation.Unusable(s"it describes ${catalogue.library}")
          case Right((catalogue, _))
              if checkHash && pkg.sourceHash() != catalogue.sourceHash =>
            Validation.Unusable(
              "the library's sources changed after it was written"
            )
          case Right((catalogue, skipped)) =>
            Validation.Usable(catalogue, skipped)
        }
    }
  }

  /** @return the catalogue in `text`, or why it is not one this code reads,
    * including any entry it cannot decode
    */
  def fromJson(text: String): Either[String, LibraryCatalogue] =
    read(text).flatMap {
      case (catalogue, Seq()) => Right(catalogue)
      case (_, skipped)       => Left(skipped.mkString("; "))
    }
}
