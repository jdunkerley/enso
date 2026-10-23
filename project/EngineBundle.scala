import sbt._
import sbt.internal.util.ManagedLogger

/** The engine bundle that the IDE ships: the engine package, a small JDK to run it with, and an
  * empty `.enso.bundle` marker, laid out as `./run backend get` laid it out
  * (`build_tools/build/src/engine/bundle.rs`, `paths.yaml`):
  *
  * {{{
  * built-distribution/engine-bundle-<version>-<os>-<arch>/enso/
  *   .enso.bundle
  *   dist/<version>/                                     the engine package
  *   runtime/graalvm-ce-java<graalVersion>-<graalMavenPackagesVersion>/   the small JDK
  * }}}
  */
object EngineBundle {

  /** The bundle's root directory for this platform. */
  def root(
    artifactRoot: File,
    ensoVersion: String,
    os: DistributionPackage.OS,
    arch: DistributionPackage.Architecture
  ): File =
    artifactRoot / s"engine-bundle-$ensoVersion-${os.name}-${arch.name}" / "enso"

  /** The runtime directory's name, as `./run` named it. */
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
    log: ManagedLogger
  ): File = {
    IO.delete(bundleRoot)
    IO.createDirectory(bundleRoot)
    IO.copyDirectory(
      enginePackage,
      bundleRoot / "dist" / ensoVersion,
      overwrite            = true,
      preserveLastModified = true,
      preserveExecutable   = true
    )
    IO.copyDirectory(
      smallJdk,
      bundleRoot / "runtime" / runtimeDir,
      overwrite            = true,
      preserveLastModified = true,
      preserveExecutable   = true
    )
    IO.touch(bundleRoot / ".enso.bundle")
    log.info(s"Engine bundle created at $bundleRoot.")
    bundleRoot
  }
}
