package org.enso.languageserver.search

import com.typesafe.scalalogging.LazyLogging
import org.enso.editions.LibraryName
import org.enso.languageserver.libraries.BlockingOperation
import org.enso.librarymanager.ResolvedLibrary
import org.enso.pkg.Package
import org.enso.polyglot.{LibraryCatalogue, Suggestion}

import java.nio.file.{Files, Path}
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.jdk.CollectionConverters._
import scala.util.{Failure, Success, Try, Using}

/** A library's catalogue, read and checked against the library's sources.
  *
  * @param library the library
  * @param entries its catalogue's entries
  */
final case class InstalledCatalogue(
  library: LibraryName,
  entries: Seq[Suggestion]
)

/** Where the suggestions handler gets the installed libraries' catalogues. */
trait CatalogueSource {

  /** @param exclude the libraries whose catalogues are not wanted (those the
    * runtime has loaded), which are not read at all
    * @return the valid catalogues of the other installed libraries, in
    * library name order
    */
  def load(exclude: Set[LibraryName]): Future[Seq[InstalledCatalogue]]
}

object CatalogueSource {

  /** No catalogues: the handler behaves as it did before catalogues. */
  val Empty: CatalogueSource = _ => Future.successful(Seq())
}

/** Reads the `catalogue.json` of each installed library (Note [Library
  * Catalogue] in `TruffleCompilerContext`).
  *
  * A catalogue is used only when `LibraryCatalogue.validate` accepts it: its
  * header parses, its format is one this engine reads, it names the library
  * and its `sourceHash` matches the library's sources (`Package.sourceHash`).
  * Otherwise it is skipped with a warning and the library's components appear
  * once the library is loaded, as without a catalogue. An entry that cannot be
  * decoded is skipped with a warning, and the others are kept. A library whose
  * `package.yaml` says `catalogue: false` is skipped quietly.
  *
  * Only whether a library's catalogue is valid is kept, not its entries: they
  * are decoded again on each load, and the handler holds them only while it
  * inserts them. The validity is kept until the library's `package.yaml`, its
  * catalogue or one of its sources changes size or modification time, so a
  * later fill of the database within the same language server (after
  * `search/invalidateSuggestionsDatabase`) does not hash the sources again; a
  * reopened project starts a new language server and hashes them again. A
  * load that starts while another one for the same libraries runs shares its
  * result.
  *
  * @param installedLibraries the libraries the project resolves without a
  * download, in library name order
  */
final class InstalledCatalogues(installedLibraries: () => Seq[ResolvedLibrary])
    extends CatalogueSource
    with LazyLogging {

  private case class Stamp(
    config: Option[(Long, Long)],
    catalogue: Option[(Long, Long)],
    sources: Seq[(String, Long, Long)]
  )

  /** For each library root, its stamp and whether its catalogue is valid. */
  private val checked = new ConcurrentHashMap[Path, (Stamp, Boolean)]()

  private val running =
    new AtomicReference[(Set[LibraryName], Future[Seq[InstalledCatalogue]])]()

  /** @inheritdoc */
  override def load(
    exclude: Set[LibraryName]
  ): Future[Seq[InstalledCatalogue]] = {
    val promise = Promise[Seq[InstalledCatalogue]]()
    val mine    = (exclude, promise.future)
    val current = running.compareAndExchange(null, mine)
    if (current != null && current._1 == exclude) current._2
    else if (current != null) readAll(exclude)
    else {
      // Cleared before the result is published, so a load that follows it
      // reads again.
      readAll(exclude).onComplete { result =>
        running.compareAndSet(mine, null)
        promise.complete(result)
      }(ExecutionContext.parasitic)
      promise.future
    }
  }

  private def readAll(
    exclude: Set[LibraryName]
  ): Future[Seq[InstalledCatalogue]] =
    BlockingOperation.run {
      Try(installedLibraries()) match {
        case Success(libraries) =>
          libraries.filterNot(l => exclude.contains(l.name)).flatMap {
            library =>
              Try(read(library)) match {
                case Success(catalogue) => catalogue
                case Failure(error) =>
                  logger.warn(
                    s"The catalogue of library [${library.name}] is skipped",
                    error
                  )
                  None
              }
          }
        case Failure(error) =>
          logger.warn("Cannot list the installed libraries' catalogues", error)
          Seq()
      }
    }

  private def read(library: ResolvedLibrary): Option[InstalledCatalogue] = {
    val root  = library.root.location
    val stamp = stampOf(root)
    Option(checked.get(root)) match {
      case Some((`stamp`, false)) => None
      case Some((`stamp`, true))  =>
        // Valid when last checked, and unchanged since: decode it again,
        // without hashing the sources.
        check(library.name, root, checkHash = false, quiet = true)
      case _ =>
        val outcome = check(library.name, root, checkHash = true, quiet = false)
        checked.put(root, (stamp, outcome.isDefined))
        outcome
    }
  }

  private def check(
    name: LibraryName,
    root: Path,
    checkHash: Boolean,
    quiet: Boolean
  ): Option[InstalledCatalogue] =
    LibraryCatalogue.validate(
      name.qualifiedName,
      root.toFile,
      checkHash
    ) match {
      case LibraryCatalogue.Validation.Declined =>
        // Declared, not broken: `catalogue: false` in its `package.yaml`.
        logger.debug("Library [{}] declines a catalogue.", name)
        None
      case LibraryCatalogue.Validation.Unusable(reason) =>
        logger.warn(
          "The catalogue of library [{}] is skipped: {}.",
          name,
          reason
        )
        None
      case LibraryCatalogue.Validation.Usable(catalogue, skipped) =>
        if (!quiet) {
          skipped.foreach { reason =>
            logger.warn(
              "An entry of the catalogue of library [{}] is skipped: {}.",
              name,
              reason
            )
          }
        }
        Some(InstalledCatalogue(name, catalogue.entries))
    }

  private def stampOf(root: Path): Stamp = {
    def sizeAndTime(file: Path): (Long, Long) =
      (Files.size(file), Files.getLastModifiedTime(file).toMillis)
    def ofFile(name: String): Option[(Long, Long)] =
      Some(root.resolve(name)).filter(Files.isRegularFile(_)).map(sizeAndTime)
    val config    = ofFile(Package.configFileName)
    val catalogue = ofFile(LibraryCatalogue.FileName)
    val src       = root.resolve(Package.sourceDirName)
    val sources =
      if (!Files.isDirectory(src)) Vector()
      else
        Using.resource(Files.walk(src)) { files =>
          files
            .iterator()
            .asScala
            .filter(Files.isRegularFile(_))
            .map { file =>
              val (size, time) = sizeAndTime(file)
              (src.relativize(file).toString, size, time)
            }
            .toVector
            .sortBy(_._1)
        }
    Stamp(config, catalogue, sources)
  }
}
