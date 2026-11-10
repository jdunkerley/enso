package org.enso.runtimeversionmanager.releases.graalvm

import org.enso.cli.OS

import java.nio.file.Path
import org.enso.cli.task.TaskProgress
import org.enso.runtimeversionmanager.components.GraalVMVersion
import org.enso.runtimeversionmanager.releases.github.GithubReleaseProvider
import org.enso.runtimeversionmanager.releases.{
  ReleaseProviderException,
  SimpleReleaseProvider
}

import scala.util.{Failure, Success}

/** [[GraalVMRuntimeReleaseProvider]] implementation providing Graal Community
  * Edition releases from the given [[SimpleReleaseProvider]].
  */
class GraalCEReleaseProvider(releaseProvider: SimpleReleaseProvider)
    extends GraalVMRuntimeReleaseProvider {

  /** @inheritdoc */
  override def packageFileName(version: GraalVMVersion): String = {
    GraalCEReleaseProvider.packageFileNameForCurrentOS(version)
  }

  /** @inheritdoc */
  override def downloadPackage(
    version: GraalVMVersion,
    destination: Path
  ): TaskProgress[Unit] = {
    val packageName = packageFileName(version)
    val release =
      releaseProvider.releaseForTag(GraalCEReleaseProvider.tagName(version))
    release match {
      case Failure(exception) =>
        TaskProgress.immediateFailure(exception)
      case Success(release) =>
        release.assets
          .find(_.fileName == packageName)
          .map(_.downloadTo(destination))
          .getOrElse {
            TaskProgress.immediateFailure(
              ReleaseProviderException(
                s"Cannot find package `$packageName` in the release."
              )
            )
          }
    }
  }
}

object GraalCEReleaseProvider {
  private val githubRepository =
    new GithubReleaseProvider("graalvm", "graalvm-ce-builds")

  /** Default [[GraalVMRuntimeReleaseProvider]] that provides Graal CE releases
    * using the GitHub Release API.
    */
  val default = new GraalCEReleaseProvider(githubRepository)

  /** Whether `version` is a GraalVM 25+ innovation release (25.1, 25.2, ...),
    * whose JDK has a version of its own: release `25.5.5.0.3` ships JDK
    * `25.0.5.0.3`. On 25.0.x the two are equal.
    */
  def isInnovationRelease(version: GraalVMVersion): Boolean =
    version.graalMajorVersion >= 25 && version.graalVersion != version.javaVersion

  /** The tag of the `graalvm-ce-builds` release that holds `version`. */
  def tagName(version: GraalVMVersion): String =
    if (version.graalMajorVersion < 23) {
      s"vm-${version.graalVersion}"
    } else if (isInnovationRelease(version)) {
      s"graal-${version.graalVersion}"
    } else {
      s"jdk-${version.javaVersion}"
    }

  /** Generates the name of the package for the currently running OS and a
    * specified release version.
    */
  def packageFileNameForCurrentOS(version: GraalVMVersion): String =
    packageFileName(version, OS.operatingSystem, OS.architecture)

  /** The name of the package of `version` for the given OS and architecture
    * (as [[OS.architecture]] names it).
    */
  def packageFileName(
    version: GraalVMVersion,
    operatingSystem: OS,
    architecture: String
  ): String = {
    val os = operatingSystem match {
      case OS.Linux   => "linux"
      case OS.MacOS   => if (version.graalMajorVersion < 23) "darwin" else "macos"
      case OS.Windows => "windows"
    }
    val extension = operatingSystem match {
      case OS.Linux   => ".tar.gz"
      case OS.MacOS   => ".tar.gz"
      case OS.Windows => ".zip"
    }
    if (version.graalMajorVersion < 23) {
      val arch = architecture
      "graalvm-ce-" +
      s"java${version.javaVersion}-$os-$arch-${version.graalVersion}$extension"
    } else {
      val arch = architecture match {
        case "amd64" => "x64"
        case arch    => arch
      }
      // `graalvm-community-jdk-25i5-25.0.5.0.3_…` on the innovation line.
      val release =
        if (isInnovationRelease(version)) {
          val minor = version.graalVersion.split('.')(1)
          s"${version.graalMajorVersion}i$minor-"
        } else {
          ""
        }
      "graalvm-community-jdk-" +
      s"$release${version.javaVersion}_${os}-${arch}_bin$extension"
    }
  }
}
