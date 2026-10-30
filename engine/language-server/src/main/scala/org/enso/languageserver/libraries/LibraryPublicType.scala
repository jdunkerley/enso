package org.enso.languageserver.libraries

import com.typesafe.scalalogging.Logger
import org.enso.editions.Editions
import org.enso.librarymanager.InstalledLibraries
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.pkg.PackageManager

import scala.util.{Failure, Success}

/** A type an installed library declares in its `package.yaml`
  * (`public-types:`).
  *
  * @param name the type's name, as its library's `Main.enso` exports it
  * @param library the library's qualified name, e.g. `Standard.SQLite`
  */
case class LibraryPublicType(name: String, library: String)

object LibraryPublicType {
  private lazy val logger = Logger[LibraryPublicType.type]

  /** The declared types of every library the project can resolve without a
    * download, in the libraries' name order. Computed afresh on each call,
    * unlike the runtime's service discovery, which lists the installed
    * libraries once per context (Note [Service Discovery Over Installed
    * Libraries] in `LookupServicesNode`). A library whose `package.yaml`
    * cannot be read is logged and left out, as the runtime does.
    */
  def list(
    edition: Editions.ResolvedEdition,
    preferLocalLibraries: Boolean,
    localLibraryProvider: LocalLibraryProvider,
    publishedLibraryCache: PublishedLibraryCache
  ): Seq[LibraryPublicType] =
    InstalledLibraries
      .find(
        edition,
        preferLocalLibraries,
        localLibraryProvider,
        publishedLibraryCache
      )
      .flatMap { library =>
        PackageManager.Default.loadPackage(library.root.location.toFile) match {
          case Success(pkg) =>
            pkg
              .getConfig()
              .publicTypes
              .map(LibraryPublicType(_, library.name.toString))
          case Failure(error) =>
            logger.warn(
              s"Library ${library.name} is left out of the public types: " +
              error.getMessage
            )
            Nil
        }
      }
}
