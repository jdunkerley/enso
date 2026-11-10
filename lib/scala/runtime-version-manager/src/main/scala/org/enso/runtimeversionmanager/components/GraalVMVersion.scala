package org.enso.runtimeversionmanager.components

import org.enso.semver.SemVer

/** Version information identifying the runtime that can be used with an engine
  * release.
  *
  * @param graalVersion version of the GraalVM release (an engine manifest's
  *                     `graal-vm-version`). Can be specified as a semantic
  *                     version, or as up to five dot-separated numbers (an
  *                     innovation release, e.g. `25.5.5.0.3`).
  * @param javaVersion Java version of the GraalVM flavour that should be used
  *                    (`graal-java-version`). Can be specified as a single
  *                    integer, a semantic version or up to five dot-separated
  *                    numbers (`25.0.5.0.3`). On GraalVM's innovation line it
  *                    differs from the release's version.
  */
case class GraalVMVersion(graalVersion: String, javaVersion: String)
    extends Comparable[GraalVMVersion] {
  require(GraalVMVersion.isCorrectVersionFormat(graalVersion))
  require(GraalVMVersion.isCorrectVersionFormat(javaVersion))

  /** @inheritdoc
    */
  override def toString: String = s"GraalVM $graalVersion Java $javaVersion"

  def graalMajorVersion: Int = graalVersion.split("\\.").head.toInt

  def javaMajorVersion: Int = {
    if (javaVersion.contains(".")) {
      javaVersion.split("\\.").head.toInt
    } else {
      javaVersion.toInt
    }
  }

  override def compareTo(other: GraalVMVersion): Int = {
    val javaSemVer      = SemVer.parse(javaVersion)
    val otherJavaSemVer = SemVer.parse(other.javaVersion)
    if (javaSemVer.isSuccess && otherJavaSemVer.isSuccess) {
      val comp = javaSemVer.get.compareTo(otherJavaSemVer.get)
      if (comp != 0) {
        return comp
      }
    }
    val javaNumericComp =
      GraalVMVersion.compareNumeric(javaVersion, other.javaVersion)
    if (javaNumericComp.exists(_ != 0)) {
      return javaNumericComp.get
    }

    val graalSemVer      = SemVer.parse(graalVersion)
    val otherGraalSemVer = SemVer.parse(other.graalVersion)
    if (graalSemVer.isSuccess && otherGraalSemVer.isSuccess) {
      val comp = graalSemVer.get.compareTo(otherGraalSemVer.get)
      if (comp != 0) {
        return comp
      }
    }
    val graalNumericComp =
      GraalVMVersion.compareNumeric(graalVersion, other.graalVersion)
    if (graalNumericComp.exists(_ != 0)) {
      return graalNumericComp.get
    }

    val javaMajorComp = javaMajorVersion.compareTo(other.javaMajorVersion)
    if (javaMajorComp != 0) {
      return javaMajorComp
    }
    val graalMajorComp = graalMajorVersion.compareTo(other.graalMajorVersion)
    if (graalMajorComp != 0) {
      return graalMajorComp
    }

    // Consistent with equals: versions that compare equal above but are
    // spelled differently (`25.0.1` and `25.0.1.0`) are ordered by their text.
    val graalTextComp = graalVersion.compareTo(other.graalVersion)
    if (graalTextComp != 0) {
      return graalTextComp
    }
    javaVersion.compareTo(other.javaVersion)
  }
}

object GraalVMVersion {

  /** One to five dot-separated numbers. GraalVM's innovation releases have
    * five: release `25.5.5.0.3` ships JDK `25.0.5.0.3`.
    */
  private val numericVersion = "^\\d+(\\.\\d+){0,4}$"

  def isCorrectVersionFormat(version: String): Boolean =
    version.matches(numericVersion) || SemVer.parse(version).isSuccess

  /** Compares two versions made of dot-separated numbers component by
    * component, a missing component counting as zero; `None` unless both are
    * of that form.
    */
  private[components] def compareNumeric(a: String, b: String): Option[Int] =
    if (a.matches(numericVersion) && b.matches(numericVersion)) {
      val as = a.split('.').map(_.toLong)
      val bs = b.split('.').map(_.toLong)
      val n  = math.max(as.length, bs.length)
      Some(
        as.padTo(n, 0L)
          .zip(bs.padTo(n, 0L))
          .map { case (x, y) => java.lang.Long.compare(x, y) }
          .find(_ != 0)
          .getOrElse(0)
      )
    } else {
      None
    }
}
