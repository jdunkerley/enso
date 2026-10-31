package org.enso.languageserver.search

import org.enso.editions.{LibraryName, LibraryVersion}
import org.enso.librarymanager.ResolvedLibrary
import org.enso.librarymanager.resolved.LibraryRoot
import org.enso.pkg.{Package, PackageManager}
import org.enso.polyglot.{LibraryCatalogue, Suggestion}
import org.enso.searcher.memory.InMemorySuggestionsRepo
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File
import java.nio.file.attribute.FileTime
import java.nio.file.{Files, Path}
import scala.concurrent.Await
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

class InstalledCataloguesSpec extends AnyWordSpec with Matchers {

  private val Timeout = 10.seconds

  private def entries(name: String): Seq[Suggestion] = Seq(
    Suggestion.Type(
      None,
      s"Foo.$name.Main",
      name,
      Seq(),
      s"Foo.$name.Main.$name",
      None,
      Some(s" The $name type.")
    )
  )

  /** A type and two conversions to it from different types, in one module:
    * the shape that collided when conversions decoded as methods.
    */
  private def conversions(name: String): Seq[Suggestion] = {
    def from(source: String) = Suggestion.Conversion(
      None,
      s"Foo.$name.Main",
      Seq(Suggestion.Argument("that", source, false, false, None)),
      s"Foo.$name.Main.$name",
      s"Foo.$name.Main.$name",
      None
    )
    entries(name) ++ Seq(
      from("Standard.Base.Data.Text.Text"),
      from("Standard.Base.Data.Numbers.Integer")
    )
  }

  /** A library `Foo.<name>` in `root`, with the catalogue `catalogue` writes
    * and `yaml` appended to its `package.yaml`.
    */
  private def library(
    root: Path,
    name: String,
    catalogue: Option[Package[File] => String],
    yaml: String = ""
  ): ResolvedLibrary = {
    val dir = Files.createDirectories(root.resolve(name))
    Files.writeString(
      dir.resolve("package.yaml"),
      s"name: $name\nnamespace: Foo\nversion: 1.0.0\n$yaml"
    )
    Files.createDirectories(dir.resolve("src"))
    Files.writeString(
      dir.resolve("src").resolve("Main.enso"),
      "## A library.\nmain = 42\n"
    )
    val pkg = PackageManager.Default.loadPackage(dir.toFile).get
    catalogue.foreach { text =>
      Files.writeString(dir.resolve(LibraryCatalogue.FileName), text(pkg))
    }
    ResolvedLibrary(
      LibraryName("Foo", name),
      LibraryVersion.Local,
      LibraryRoot(dir)
    )
  }

  /** The valid catalogue of `Foo.<name>`, holding `content` (by default the
    * library's one type), written for `pkg`'s sources.
    */
  private def valid(name: String, content: Option[Seq[Suggestion]] = None)(
    pkg: Package[File]
  ): String =
    LibraryCatalogue(
      s"Foo.$name",
      "1.0.0",
      "0.0.0-dev",
      pkg.sourceHash(),
      content.getOrElse(entries(name))
    ).toJson

  "InstalledCatalogues" should {
    "read the valid catalogues, and skip stale, corrupt, misnamed and missing ones" in {
      val root  = Files.createTempDirectory("catalogues")
      val good  = library(root, "Good", Some(valid("Good") _))
      val stale = library(root, "Stale", Some(valid("Stale") _))
      Files.writeString(
        stale.root.location.resolve("src").resolve("Main.enso"),
        "main = 43\n"
      )
      val corrupt =
        library(root, "Corrupt", Some((_: Package[File]) => "{ not json"))
      val misnamed = library(root, "Misnamed", Some(valid("Good") _))
      val missing  = library(root, "Missing", None)

      val catalogues =
        new InstalledCatalogues(() =>
          Seq(corrupt, good, misnamed, missing, stale)
        )
      Await.result(catalogues.load(), Timeout) shouldEqual
      Seq(InstalledCatalogue(LibraryName("Foo", "Good"), entries("Good")))
    }

    "notice a library that changes after its catalogue was read" in {
      val root       = Files.createTempDirectory("catalogues")
      val good       = library(root, "Good", Some(valid("Good") _))
      val catalogues = new InstalledCatalogues(() => Seq(good))
      Await.result(catalogues.load(), Timeout).map(_.library) shouldEqual
      Seq(LibraryName("Foo", "Good"))

      val main = good.root.location.resolve("src").resolve("Main.enso")
      Files.writeString(main, "## Changed.\nmain = 43\n")
      Files.setLastModifiedTime(
        main,
        FileTime.fromMillis(Files.getLastModifiedTime(main).toMillis + 2000)
      )
      Await.result(catalogues.load(), Timeout) shouldEqual Seq()
    }

    "skip a library that declines a catalogue" in {
      val root = Files.createTempDirectory("catalogues")
      val declined = library(
        root,
        "Declined",
        Some(valid("Declined") _),
        "catalogue: false\n"
      )
      Await.result(
        new InstalledCatalogues(() => Seq(declined)).load(),
        Timeout
      ) shouldEqual Seq()
    }

    "keep the other entries when one cannot be decoded" in {
      val root = Files.createTempDirectory("catalogues")
      val bad = library(
        root,
        "Bad",
        Some { (pkg: Package[File]) =>
          valid("Bad")(pkg)
            .replace("\"entries\":[", "\"entries\":[{\"type\":\"method\"},")
        }
      )
      Await.result(
        new InstalledCatalogues(() => Seq(bad)).load(),
        Timeout
      ) shouldEqual
      Seq(InstalledCatalogue(LibraryName("Foo", "Bad"), entries("Bad")))
    }

    "keep two conversions to one type apart, through to the repository" in {
      val root = Files.createTempDirectory("catalogues")
      val conv =
        library(root, "Conv", Some(valid("Conv", Some(conversions("Conv"))) _))
      val loaded =
        Await.result(new InstalledCatalogues(() => Seq(conv)).load(), Timeout)
      loaded.flatMap(_.entries) shouldEqual conversions("Conv")

      val repo = new InMemorySuggestionsRepo()
      Await.result(repo.init, Timeout)
      val (_, ids) =
        Await.result(repo.insertAll(loaded.flatMap(_.entries)), Timeout)
      ids.size shouldEqual 3
    }
  }
}
