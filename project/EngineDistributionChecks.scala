import sbt._
import sbt.internal.util.ManagedLogger

/** What `./run` did to the engine package right after `buildEngineDistribution`, on every
  * platform: the IR cache size check, and on Windows the MSVC runtime DLL copy (`MsvcRuntime`).
  * `ciBuildEngineDistribution` and `buildEngineBundle` both run it, so it is written once.
  */
object EngineDistributionChecks {

  /** @param packageRoot the engine package (`engineDistributionRoot`) */
  def afterBuild(
    packageRoot: File,
    ensoVersion: String,
    log: ManagedLogger
  ): Unit = {
    IRCaches.checkCacheSizes(
      stdLibRoot  = packageRoot / "lib" / "Standard",
      ensoVersion = ensoVersion,
      log         = log
    )
    if (Platform.isWindows) MsvcRuntime.copyCrtDlls(packageRoot, log)
  }
}
