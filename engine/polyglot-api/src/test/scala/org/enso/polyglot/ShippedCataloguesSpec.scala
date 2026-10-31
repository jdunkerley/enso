package org.enso.polyglot

import org.enso.pkg.PackageManager
import org.scalatest.ConfigMap
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.FixtureAnyWordSpec
import org.scalatest.fixture.ConfigMapFixture

import java.io.File
import java.nio.file.Files

/** Checks the `catalogue.json` of every library in a built distribution with
  * the language server's own rule (`LibraryCatalogue.validate`): each one must
  * be accepted, with no entry left out, so that a packaging step, a hashing
  * difference between `TruffleFile` and `File` or a codec change cannot turn
  * the catalogues off unnoticed (Note [Library Catalogue] in
  * `TruffleCompilerContext`).
  *
  * It needs the distribution's `lib` directory as the `lib` config entry, and
  * is cancelled without it, as in `sbt test`. CI's engine distribution build
  * runs it on the distribution it built (`ciBuildEngineDistribution`):
  * {{{
  * sbt "polyglot-api/testOnly org.enso.polyglot.ShippedCataloguesSpec -- -Dlib=<distribution>/lib"
  * }}}
  */
class ShippedCataloguesSpec
    extends FixtureAnyWordSpec
    with ConfigMapFixture
    with Matchers {

  /** The `<namespace>/<name>/<version>` directories under `lib`. */
  private def libraries(lib: File): Seq[(String, File)] =
    for {
      namespace <- Option(lib.listFiles()).toSeq.flatten.filter(_.isDirectory)
      name      <- Option(namespace.listFiles()).toSeq.flatten.filter(_.isDirectory)
      version   <- Option(name.listFiles()).toSeq.flatten.filter(_.isDirectory)
      if new File(version, "package.yaml").isFile
    } yield (s"${namespace.getName}.${name.getName}", version)

  "The catalogues of a built distribution" should {
    "all be accepted by the language server, with every entry" in {
      (configMap: ConfigMap) =>
        val lib = configMap.getOptional[String]("lib") match {
          case Some(path) => new File(path)
          case None =>
            cancel("No `lib` given: run with `-- -Dlib=<distribution>/lib`.")
        }
        assert(lib.isDirectory, s"$lib is not a directory")
        val found = libraries(lib)
        assert(found.size >= 10, s"Only ${found.size} libraries in $lib")

        val problems = found.flatMap { case (library, root) =>
          val file = new File(root, LibraryCatalogue.FileName)
          LibraryCatalogue.validate(library, root) match {
            case LibraryCatalogue.Validation.Declined =>
              Option.when(file.exists())(
                s"$library declines a catalogue but has $file"
              )
            case LibraryCatalogue.Validation.Unusable(reason) =>
              Some(s"$library: $reason")
            case LibraryCatalogue.Validation.Usable(catalogue, skipped) =>
              val version =
                PackageManager.Default.loadPackage(root).get.getConfig().version
              Seq(
                Option.when(skipped.nonEmpty)(
                  s"$library: entries left out: ${skipped.mkString("; ")}"
                ),
                Option.when(catalogue.entries.isEmpty)(s"$library: no entries"),
                Option.when(catalogue.version != version)(
                  s"$library: version ${catalogue.version}, package $version"
                )
              ).flatten.headOption
          }
        }
        problems shouldEqual Seq()
        // At least the libraries that declare one have a catalogue.
        found.count { case (_, root) =>
          Files.isRegularFile(root.toPath.resolve(LibraryCatalogue.FileName))
        } should be >= 10
    }
  }
}
