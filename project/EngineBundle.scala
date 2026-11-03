import sbt._

import java.nio.file.{
  FileVisitResult,
  Files,
  LinkOption,
  Path,
  SimpleFileVisitor,
  StandardCopyOption
}
import java.nio.file.attribute.BasicFileAttributes

/** The engine bundle that the IDE ships: the engine package, a small JDK to run it with, and an
  * empty `.enso.bundle` marker, laid out as the retired build CLI's `backend get` laid it out
  * (its `bundle.rs`, `paths.yaml`):
  *
  * {{{
  * built-distribution/engine-bundle-<version>-<os>-<arch>/enso/
  *   .enso.bundle
  *   dist/<version>/                                     the engine package
  *   runtime/graalvm-ce-java<graalVersion>-<graalMavenPackagesVersion>/   the small JDK
  * }}}
  */
object EngineBundle {

  /** The standard libraries that the engine distribution has and the IDE's bundle leaves out: a
    * test library, to be fetched later like any library that is not bundled (the user's decision;
    * docs/superpowers/plans/2026-10-31-database-test-suite.md). `IRCaches.checkCacheSizes` does
    * not count them either, since its budget is what users get.
    */
  val librariesNotBundled: Seq[String] = Seq("Database_Test_Suite")

  /** The bundle's root directory for this platform. */
  def root(
    artifactRoot: File,
    ensoVersion: String,
    os: DistributionPackage.OS,
    arch: DistributionPackage.Architecture
  ): File =
    artifactRoot / s"engine-bundle-$ensoVersion-${os.name}-${arch.name}" / "enso"

  /** The runtime directory's name, as the retired build CLI named it. */
  def runtimeDirName(
    graalVersion: String,
    graalMavenPackagesVersion: String
  ): String =
    s"graalvm-ce-java$graalVersion-$graalMavenPackagesVersion"

  /** Recreates the bundle at `bundleRoot` from `enginePackage` and `smallJdk`; returns its root. */
  def create(
    bundleRoot: File,
    enginePackage: File,
    smallJdk: File,
    ensoVersion: String,
    runtimeDir: String,
    log: Logger
  ): File = {
    IO.delete(bundleRoot)
    IO.createDirectory(bundleRoot)
    copyTree(
      enginePackage,
      bundleRoot / "dist" / ensoVersion,
      skip = librariesNotBundled.map(name =>
        (enginePackage / "lib" / "Standard" / name).toPath
      )
    )
    copyTree(smallJdk, bundleRoot / "runtime" / runtimeDir)
    IO.touch(bundleRoot / ".enso.bundle")
    log.info(s"Engine bundle created at $bundleRoot.")
    bundleRoot
  }

  /** Copies the tree at `source` to `target` as the retired build CLI's `mirror_directory` did:
    * symbolic links stay links (jlink's `legal/<module>/LICENSE` and friends point at
    * `../java.base/...`), and files keep their permissions and modification times. sbt's
    * `IO.copyDirectory` follows links, so it would turn each into a copy of its target.
    */
  private def copyTree(
    source: File,
    target: File,
    skip: Seq[Path] = Seq.empty
  ): Unit = {
    val from = source.toPath
    val to   = target.toPath
    Files.walkFileTree(
      from,
      new SimpleFileVisitor[Path] {
        override def preVisitDirectory(
          dir: Path,
          attrs: BasicFileAttributes
        ): FileVisitResult =
          if (skip.contains(dir)) FileVisitResult.SKIP_SUBTREE
          else {
            Files.createDirectories(to.resolve(from.relativize(dir)))
            FileVisitResult.CONTINUE
          }

        override def visitFile(
          file: Path,
          attrs: BasicFileAttributes
        ): FileVisitResult = {
          Files.copy(
            file,
            to.resolve(from.relativize(file)),
            StandardCopyOption.COPY_ATTRIBUTES,
            LinkOption.NOFOLLOW_LINKS
          )
          FileVisitResult.CONTINUE
        }
      }
    )
  }
}
