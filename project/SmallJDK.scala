import sbt.io.IO

import java.io.File
import java.nio.file.{Path, Paths}
import scala.collection.immutable.Seq

/** Building small JDK distributions with `jlink` command
  */
object SmallJDK {

  private val NI_BUILDER_MODULES = Seq(
    "org.graalvm.nativeimage.builder",
    "org.graalvm.nativeimage.driver",
    "org.graalvm.nativeimage.librarysupport",
    "org.graalvm.nativeimage.objectfile",
    "org.graalvm.nativeimage.pointsto"
  )

  private val NI_BASE_MODULES = Seq(
    "org.graalvm.nativeimage",
    "org.graalvm.nativeimage.base",
    "com.oracle.graal.graal_enterprise",
    "com.oracle.svm.svm_enterprise"
  )

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

  private val ADDITIONAL_NI_BUILD_MODS = Seq(
    "java.prefs"
  )

  private val DEBUG_MODULES = Seq(
    "jdk.jdwp.agent"
  )

  private val PYTHON_MODULES = Seq(
    "java.naming",
    "jdk.security.auth"
  )

  /** Builds a small JDK appropriate for building native image.
    * @param targetJdkDirectory Target directory. If non empty, will be deleted.
    */
  def buildSmallJDKForNativeImage(
    targetJdkDirectory: File
  ): Unit = {
    if (targetJdkDirectory.exists()) {
      IO.delete(targetJdkDirectory)
    }
    val niModules     = (NI_BASE_MODULES ++ NI_BUILDER_MODULES).mkString(",")
    val jdkModules    = (JDK_MODULES ++ ADDITIONAL_NI_BUILD_MODS).mkString(",")
    val debugModules  = DEBUG_MODULES.mkString(",")
    val pythonModules = PYTHON_MODULES.mkString(",")

    val mp = modulePath()
      .map(_.toAbsolutePath.toString)
      .mkString(File.pathSeparator)

    val jlinkArgs = Seq(
      "--module-path",
      mp,
      "--output",
      targetJdkDirectory.toString,
      "--add-modules",
      s"$niModules,$jdkModules,$debugModules,$pythonModules"
    )
    runJlink(jlinkArgs)
    copyLibDirs(targetJdkDirectory)
    assert(
      targetJdkDirectory.exists(),
      "Directory of small JDK " + targetJdkDirectory + " is not present"
    )
  }

  /** Builds a small JDK with `jlink` appropriate for running
    * Enso in `--jvm` mode.
    * @param targetJdkDirectory Target directory. If not empty,
    *                          will be deleted.
    */
  def buildSmallJDKForRelease(
    targetJdkDirectory: File
  ): Unit = {
    if (targetJdkDirectory.exists()) {
      IO.delete(targetJdkDirectory)
    }
    val mp = modulePath()
      .map(_.toAbsolutePath.toString)
      .mkString(File.pathSeparator)
    val modules =
      JDK_MODULES ++ NI_BASE_MODULES ++ DEBUG_MODULES ++ PYTHON_MODULES
    val jlinkArgs = Seq(
      "--no-header-files",
      "--no-man-pages",
      "--generate-cds-archive",
      "--module-path",
      mp,
      "--output",
      targetJdkDirectory.toString,
      "--add-modules",
      modules.mkString(",")
    )
    runJlink(jlinkArgs)
    copyLibDirs(targetJdkDirectory)
    assert(
      targetJdkDirectory.exists(),
      "Directory of small JDK " + targetJdkDirectory +
      " was not created."
    )
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

  private def copyLibDirs(smallJdkDirectory: File): Unit = {
    libDirs().foreach(libDir =>
      IO.copyDirectory(
        libDir.toFile,
        smallJdkDirectory.toPath
          .resolve("lib")
          .resolve(libDir.toFile.getName)
          .toFile
      )
    )
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

  private def modulePath(): List[Path] = {
    val moduleJars = List(
      "lib/svm/bin/../../graalvm/svm-driver.jar",
      "lib/svm/bin/../builder/native-image-base.jar",
      "lib/svm/bin/../builder/espresso-svm.jar",
      "lib/svm/bin/../builder/objectfile.jar",
      "lib/svm/bin/../builder/pointsto.jar",
      "lib/svm/bin/../builder/reporter.jar",
      "lib/svm/bin/../builder/svm-enterprise.jar",
      "lib/svm/bin/../builder/svm.jar",
      "lib/svm/bin/../builder/svm-configure.jar",
      "lib/svm/bin/../builder/svm-capnproto-runtime.jar",
      "lib/svm/bin/../builder/svm-foreign.jar",
      // New in GraalVM 25.5: org.graalvm.nativeimage.base requires these.
      "lib/svm/bin/../builder/svm-shared.jar",
      "lib/svm/bin/../builder/vmaccess.jar",
      "lib/svm/bin/../builder/vmaccess-guest.jar",
      "lib/svm/bin/../builder/hostvmaccess.jar",
      // ...and org.graalvm.nativeimage.driver these, for the native-image JDK.
      "lib/svm/bin/../builder/svm-guest-staging.jar",
      "lib/svm/bin/../builder/svm-jvmci-guest-staging.jar",
      "lib/svm/bin/../builder/svm-jvmci-shared.jar",
      "lib/svm/bin/../library-support.jar"
    )
    moduleJars.map { jar =>
      javaHome().resolve(jar)
    }
  }

  private def libDirs(): List[Path] = {
    val targetLibDirs = List(
      "graalvm",
      "svm",
      "static",
      "truffle"
    )
    targetLibDirs.map { d =>
      javaHome().resolve("lib").resolve(d)
    }
  }
}
