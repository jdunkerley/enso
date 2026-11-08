package org.enso.editions.provider

import org.enso.editions.{EditionName, EditionSerialization, Editions}

import java.nio.file.{Files, Path}
import scala.annotation.tailrec
import scala.collection.Factory
import scala.jdk.StreamConverters.StreamHasToScala
import scala.util.Using

/** An implementation of [[EditionProvider]] that looks for the edition files in
  *  a list of filesystem paths.
  *
  * @param searchPaths the directories to look in, in order; the first one that
  *                    has the edition wins
  * @param ignoredNames for some of the directories, edition names whose files
  *                     there are ignored, as if they were not there
  */
class FileSystemEditionProvider(
  searchPaths: List[Path],
  ignoredNames: Map[Path, Set[String]] = Map.empty
) extends EditionProvider {

  private def isIgnored(name: String, path: Path): Boolean =
    ignoredNames.get(path).exists(_.contains(name))

  /** @inheritdoc */
  override def findEditionForName(
    name: String
  ): Either[EditionLoadingError, Editions.Raw.Edition] =
    findEdition(name, searchPaths)

  @tailrec
  private def findEdition(
    name: String,
    paths: List[Path]
  ): Either[EditionLoadingError, Editions.Raw.Edition] = paths match {
    case head :: tail =>
      val headResult = loadEdition(name, head)
      headResult match {
        case Left(EditionNotFound(_)) =>
          findEdition(name, tail)
        case _ => headResult
      }
    case Nil => Left(EditionNotFound(name))
  }

  private def loadEdition(
    name: String,
    path: Path
  ): Either[EditionLoadingError, Editions.Raw.Edition] = {
    val fileName    = EditionName(name).toFileName
    val editionPath = path.resolve(fileName)
    if (!isIgnored(name, path) && Files.exists(editionPath)) {
      EditionSerialization
        .loadEdition(editionPath)
        .toEither
        .left
        .map(EditionReadError)
    } else Left(EditionNotFound(name))
  }

  /** Finds all editions available on the [[searchPaths]]. */
  override def findAvailableEditions(
    ignoreUpdateRequest: Boolean
  ): Seq[String] =
    searchPaths.flatMap(findEditionsAt).distinct

  private def findEditionName(path: Path): Option[String] =
    EditionName.fromFilename(path.getFileName.toString).map(_.name)

  private def findEditionsAt(path: Path): Seq[String] =
    listDir(path)
      .filter(Files.isRegularFile(_))
      .flatMap(findEditionName)
      .filterNot(isIgnored(_, path))

  private def listDir(dir: Path): Seq[Path] =
    if (Files.exists(dir))
      Using(Files.list(dir))(_.toScala(Factory.arrayFactory).toSeq).get
    else Seq()
}
