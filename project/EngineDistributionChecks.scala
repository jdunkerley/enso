import sbt._
import sbt.internal.util.ManagedLogger

/** The checks on the engine package right after `buildEngineDistribution`: `jvm.options` is
  * there, and the IR cache size check. `ciBuildEngineDistribution` and `buildEngineBundle` both
  * run it, so it is written once.
  *
  * On Windows this also copied the MSVC runtime DLLs next to the package's binaries
  * (`MsvcRuntime`, from the native `enso.exe` days) until #701: every DLL left in the package is
  * loaded into the bundled JDK's `java.exe`, which has already loaded that JDK's own
  * `vcruntime140.dll`, so the copies were never used.
  */
object EngineDistributionChecks {

  /** @param packageRoot the engine package (`engineDistributionRoot`) */
  def afterBuild(
    packageRoot: File,
    ensoVersion: String,
    log: ManagedLogger
  ): Unit = {
    if (!(packageRoot / "jvm.options").isFile)
      throw new RuntimeException(
        s"${packageRoot / "jvm.options"} is missing (spec stage 1c)."
      )
    IRCaches.checkCacheSizes(
      stdLibRoot  = packageRoot / "lib" / "Standard",
      ensoVersion = ensoVersion,
      log         = log
    )
  }
}
