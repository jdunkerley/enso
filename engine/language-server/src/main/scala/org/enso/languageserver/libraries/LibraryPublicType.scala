package org.enso.languageserver.libraries

import org.enso.editions.Editions
import org.enso.librarymanager.InstalledLibraries
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.pkg.PackageManager

/** A type an installed library declares in its `package.yaml`
  * (`public-types:`).
  *
  * @param name the type's name, as its library's `Main.enso` exports it
  * @param library the library's qualified name, e.g. `Standard.SQLite`
  */
case class LibraryPublicType(name: String, library: String)

object LibraryPublicType {

  /** The declared types of every library the project can resolve without a
    * download, in the libraries' name order.
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
        PackageManager.Default
          .loadPackage(library.root.location.toFile)
          .toOption
          .toSeq
          .flatMap(_.getConfig().publicTypes)
          .map(LibraryPublicType(_, library.name.toString))
      }
}
