package org.enso.languageserver.libraries

import org.enso.editions.{Editions, LibraryName}
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.librarymanager.resolved.LibraryRoot
import org.enso.semver.SemVer
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.Files

class LibraryPublicTypesSpec extends AnyWordSpec with Matchers {
  "LibraryPublicType.list" should {
    "list the types an installed library declares" in {
      val root = Files.createTempDirectory("public-types")
      Files.writeString(
        root.resolve("package.yaml"),
        """name: Lib
          |namespace: Foo
          |version: 0.0.1
          |public-types: [Thing, Other_Thing]
          |""".stripMargin
      )
      val name = LibraryName("Foo", "Lib")
      val local = new LocalLibraryProvider {
        override def findLibrary(n: LibraryName): Option[LibraryRoot] =
          if (n == name) Some(LibraryRoot(root)) else None
        override def findAvailableLocalLibraries(): List[LibraryName] =
          List(name)
      }
      val noCache = new PublishedLibraryCache {
        override def isLibraryCached(n: LibraryName, v: SemVer): Boolean = false
        override def findCachedLibrary(
          n: LibraryName,
          v: SemVer
        ): Option[LibraryRoot] = None
      }
      val edition = Editions.Resolved.Edition(
        parent        = None,
        engineVersion = Some(SemVer.of(0, 0, 0)),
        repositories  = Map(),
        libraries     = Map()
      )
      LibraryPublicType.list(edition, true, local, noCache) shouldEqual Seq(
        LibraryPublicType("Thing", "Foo.Lib"),
        LibraryPublicType("Other_Thing", "Foo.Lib")
      )
    }
  }
}
