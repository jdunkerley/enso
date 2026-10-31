package org.enso.librarymanager

import org.enso.editions.Editions.Repository
import org.enso.editions.{Editions, LibraryName}
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.librarymanager.resolved.LibraryRoot
import org.enso.semver.SemVer
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Path

class InstalledLibrariesSpec extends AnyWordSpec with Matchers {
  private val repo      = Repository("main", "https://example.com/main")
  private val cached    = LibraryName("Standard", "Cached")
  private val notCached = LibraryName("Standard", "Not_Cached")
  private val local     = LibraryName("Foo", "Local")

  private def published(name: LibraryName) =
    name -> Editions.Resolved.PublishedLibrary(name, SemVer.of(1, 0, 0), repo)

  private val edition = Editions.Resolved.Edition(
    parent        = None,
    engineVersion = Some(SemVer.of(0, 0, 0)),
    repositories  = Map("main" -> repo),
    libraries     = Map(published(cached), published(notCached))
  )

  private object Local extends LocalLibraryProvider {
    override def findLibrary(name: LibraryName): Option[LibraryRoot] =
      if (name == local) Some(LibraryRoot(Path.of("Foo", "Local"))) else None
    override def findAvailableLocalLibraries(): List[LibraryName] = List(local)
  }

  private object Cache extends PublishedLibraryCache {
    override def isLibraryCached(name: LibraryName, version: SemVer): Boolean =
      name == cached
    override def findCachedLibrary(
      name: LibraryName,
      version: SemVer
    ): Option[LibraryRoot] =
      if (name == cached) Some(LibraryRoot(Path.of("cache", "Cached")))
      else None
  }

  "InstalledLibraries.find" should {
    "list the edition's cached libraries only" in {
      InstalledLibraries
        .find(edition, preferLocalLibraries = false, Local, Cache)
        .map(_.name) shouldEqual Seq(cached)
    }

    "add local libraries, sorted by name, when the project prefers them" in {
      InstalledLibraries
        .find(edition, preferLocalLibraries = true, Local, Cache)
        .map(_.name) shouldEqual Seq(local, cached)
    }
  }
}
