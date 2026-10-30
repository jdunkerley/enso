package org.enso.librarymanager

import org.enso.editions.{Editions, LibraryVersion}
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache

/** The libraries a project can resolve without downloading anything: the
  * edition's libraries (with its parents') that are cached or bundled, and,
  * when the project prefers local libraries, the local ones. Used by the
  * runtime's service discovery and by the language server's
  * `library/listPublicTypes`, so the two always agree.
  */
object InstalledLibraries {

  /** @return the installed libraries, sorted by name */
  def find(
    edition: Editions.ResolvedEdition,
    preferLocalLibraries: Boolean,
    localLibraryProvider: LocalLibraryProvider,
    publishedLibraryCache: PublishedLibraryCache
  ): Seq[ResolvedLibrary] = {
    val resolver = LibraryResolver(localLibraryProvider)
    val locals =
      if (preferLocalLibraries)
        localLibraryProvider.findAvailableLocalLibraries()
      else Nil
    val names = edition.getAllDefinedLibraries.keySet ++ locals
    names.toSeq.sortBy(_.toString).flatMap { name =>
      resolver
        .resolveLibraryVersion(name, edition, preferLocalLibraries)
        .toOption
        .flatMap {
          case version @ LibraryVersion.Local =>
            localLibraryProvider
              .findLibrary(name)
              .map(ResolvedLibrary(name, version, _))
          case version @ LibraryVersion.Published(semver, _) =>
            publishedLibraryCache
              .findCachedLibrary(name, semver)
              .map(ResolvedLibrary(name, version, _))
        }
    }
  }
}
