package org.enso.languageserver.search

import com.typesafe.scalalogging.LazyLogging
import org.enso.editions.LibraryName
import org.enso.languageserver.libraries.BlockingOperation
import org.enso.librarymanager.ResolvedLibrary
import org.enso.pkg.{Package, PackageManager}
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

  /** @return the valid catalogues of the installed libraries, in library
    * name order
    */
  def load(): Future[Seq[InstalledCatalogue]]
}

object CatalogueSource {

  /** No catalogues: the handler behaves as it did before catalogues. */
  val Empty: CatalogueSource = () => Future.successful(Seq())
}

/** Reads the `catalogue.json` of each installed library (Note [Library
  * Catalogue] in `TruffleCompilerContext`).
  *
  * A catalogue is used only when its header parses, its format is one this
  * engine reads, it names the library and its `sourceHash` matches the
  * library's sources (`Package.sourceHash`). Otherwise it is skipped with a
  * warning and the library's components appear once the library is loaded, as
  * without a catalogue. An entry that cannot be decoded is skipped with a
  * warning, and the others are kept. A library whose `package.yaml` says
  * `catalogue: false` is skipped quietly. The outcome for a library is kept
  * until its `package.yaml`, its catalogue or one of its sources changes size
  * or modification time, so a project that is reopened does not hash the
  * sources again. A load that starts while another runs shares its result,
  * so the read when the runtime starts and the first fill of the database
  * do not hash the same sources twice.
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

  private val checked =
    new ConcurrentHashMap[Path, (Stamp, Option[InstalledCatalogue])]()

  private val running = new AtomicReference[Future[Seq[InstalledCatalogue]]]()

  /** @inheritdoc */
  override def load(): Future[Seq[InstalledCatalogue]] = {
    val promise = Promise[Seq[InstalledCatalogue]]()
    val current = running.compareAndExchange(null, promise.future)
    if (current != null) current
    else {
      // Cleared before the result is published, so a load that follows it
      // reads again.
      readAll().onComplete { result =>
        running.compareAndSet(promise.future, null)
        promise.complete(result)
      }(ExecutionContext.parasitic)
      promise.future
    }
  }

  private def readAll(): Future[Seq[InstalledCatalogue]] =
    BlockingOperation.run {
      Try(installedLibraries()) match {
        case Success(libraries) =>
          libraries.flatMap { library =>
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
      case Some((`stamp`, outcome)) => outcome
      case _ =>
        val outcome = check(library.name, root)
        checked.put(root, (stamp, outcome))
        outcome
    }
  }

  private def check(
    name: LibraryName,
    root: Path
  ): Option[InstalledCatalogue] = {
    def skip(reason: String): Option[InstalledCatalogue] = {
      logger.warn("The catalogue of library [{}] is skipped: {}.", name, reason)
      None
    }
    val file = root.resolve(LibraryCatalogue.FileName)
    PackageManager.Default.loadPackage(root.toFile) match {
      case Failure(error) =>
        skip(s"the library cannot be read (${error.getMessage})")
      case Success(pkg) if !pkg.getConfig().catalogue =>
        // Declared, not broken: `catalogue: false` in its `package.yaml`.
        logger.debug("Library [{}] declines a catalogue.", name)
        None
      case Success(_) if !Files.isRegularFile(file) => skip("there is none")
      case Success(pkg) =>
        Try(Files.readString(file)).toEither.left
          .map(_.getMessage)
          .flatMap(LibraryCatalogue.read) match {
          case Left(error) => skip(s"it cannot be read ($error)")
          case Right((catalogue, _))
              if catalogue.library != name.qualifiedName =>
            skip(s"it describes ${catalogue.library}")
          case Right((catalogue, _))
              if pkg.sourceHash() != catalogue.sourceHash =>
            skip("the library's sources changed after it was written")
          case Right((catalogue, skipped)) =>
            skipped.foreach { reason =>
              logger.warn(
                "An entry of the catalogue of library [{}] is skipped: {}.",
                name,
                reason
              )
            }
            Some(InstalledCatalogue(name, catalogue.entries))
        }
    }
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
