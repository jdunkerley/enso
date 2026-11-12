import sbt.io.IO

import java.io.File
import java.nio.file.Path
import scala.collection.immutable.Seq

/** Building small JDK distributions with `jlink` command
  */
object SmallJDK {

  private val JDK_MODULES = Seq(
    "java.naming",
    "java.net.http",
    "java.rmi",
    "jdk.attach",
    "jdk.charsets",
    "jdk.crypto.ec",
    "jdk.httpserver",
    "jdk.localedata",
    // jlink on GraalVM 25.0.1 pulled these three in transitively; 25.5 does not.
    "java.sql",
    "java.transaction.xa",
    "java.xml"
  )

  /* Note [The Release JDK's Truffle Modules]
   * ========================================
   * Until the native-image modules went (#701, a follow-up of #683), the image also took
   * `org.graalvm.nativeimage`, `org.graalvm.nativeimage.base`, `graal_enterprise` and
   * `svm_enterprise`, with the native-image builder's jars from `lib/svm` on the module path, and
   * those pulled the modules below in transitively. They are named here instead:
   * - `java.management`, `jdk.management` and `jdk.unsupported`: Truffle's optimizing runtime (the
   *   `truffle-runtime` and `truffle-compiler` jars in `component/`) requires them, and without
   *   them the boot layer does not resolve;
   * - `jdk.graal.compiler`: the Graal compiler as a Java module ("jargraal"), with
   *   `jdk.internal.vm.ci` and the `org.graalvm.truffle.compiler`, `org.graalvm.word` and
   *   `org.graalvm.collections` modules it requires. Truffle compiles through libgraal
   *   (`jvmcicompiler.dll`/`libjvmcicompiler.so`, which belongs to `java.base`), so this is only
   *   the fallback when libgraal cannot be used; it stays so that the runtime is the one the
   *   engine has always had. Without it the image is ~31 MB smaller and still compiles (checked
   *   on 25.5.5 in #701).
   * The image then differs from the old one by exactly the native-image modules
   * (`org.graalvm.nativeimage*`, `*_enterprise`, `jdk.graal.compiler.*vmaccess*`), and nothing is
   * copied from the build JDK's `lib/`: `lib/svm`, `lib/static`, `lib/graalvm` and
   * `lib/truffle` held only the native-image builder, its static JDK libraries, its agents,
   * `truffle-runtime-svm.jar` and a `truffle-compiler.jar` that no launcher puts on a path (the
   * engine's is in `component/`).
   */
  private val TRUFFLE_MODULES = Seq(
    "java.management",
    "jdk.management",
    "jdk.unsupported",
    "jdk.graal.compiler"
  )

  private val DEBUG_MODULES = Seq(
    "jdk.jdwp.agent"
  )

  private val PYTHON_MODULES = Seq(
    "java.naming",
    "jdk.security.auth"
  )

  /** Builds a small JDK with `jlink` appropriate for running
    * Enso in `--jvm` mode. On Windows its `java.exe` and `javaw.exe` get the
    * UTF-8 code page manifest (Note [The Bundled java.exe Uses UTF-8] in
    * `JavaUtf8Manifest`), so every Windows build of the engine bundle has it.
    * @param targetJdkDirectory Target directory. If not empty,
    *                          will be deleted.
    * @param buildRoot the build's root directory (the manifest is under `project/`)
    */
  def buildSmallJDKForRelease(
    targetJdkDirectory: File,
    buildRoot: File,
    log: sbt.Logger
  ): Unit = {
    if (targetJdkDirectory.exists()) {
      IO.delete(targetJdkDirectory)
    }
    val modules =
      (JDK_MODULES ++ TRUFFLE_MODULES ++ DEBUG_MODULES ++ PYTHON_MODULES).distinct
    val jlinkArgs = Seq(
      "--no-header-files",
      "--no-man-pages",
      "--generate-cds-archive",
      "--output",
      targetJdkDirectory.toString,
      "--add-modules",
      modules.mkString(",")
    )
    runJlink(jlinkArgs)
    assert(
      targetJdkDirectory.exists(),
      "Directory of small JDK " + targetJdkDirectory +
      " was not created."
    )
    if (Platform.isWindows) {
      JavaUtf8Manifest.embed(
        targetJdkDirectory,
        JavaUtf8Manifest.manifest(buildRoot),
        log
      )
      JavaUtf8Manifest.checkActive(targetJdkDirectory, log)
    }
  }

  /** Fails the build when `jdkDirectory`'s `java` cannot map its CDS archive
    * (spec stage 1b).
    */
  def checkSharing(jdkDirectory: File, log: sbt.Logger): Unit = {
    val isWindows = sys.props("os.name").toLowerCase.contains("windows")
    val java = new File(
      new File(jdkDirectory, "bin"),
      if (isWindows) "java.exe" else "java"
    )
    val output = new StringBuilder
    val exit = scala.sys.process
      .Process(Seq(java.getAbsolutePath, "-Xshare:on", "-version"))
      .!(scala.sys.process.ProcessLogger(l => output.append(l).append('\n')))
    if (exit != 0) {
      throw new RuntimeException(
        s"$java -Xshare:on -version exited $exit: the bundled JDK has no usable CDS archive.\n$output"
      )
    }
    log.info(s"CDS archive in $jdkDirectory maps (-Xshare:on).")
  }

  private def runJlink(
    args: Seq[String]
  ): Unit = {
    val exitCode = scala.sys.process.Process(jlink().toString, args).!
    if (exitCode != 0) {
      throw new RuntimeException(
        s"Failed to execute ${jlink()} ${args.mkString(" ")} - exit code: $exitCode"
      )
    }
  }

  private def javaHome(): Path = {
    val prop = System.getProperty("java.home")
    if (prop == null) {
      throw new RuntimeException("Missing java.home prop")
    } else {
      Path.of(prop)
    }
  }

  private def jlink(): Path = {
    javaHome().resolve("bin").resolve("jlink")
  }
}
