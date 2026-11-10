package org.enso.runtimeversionmanager.components

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class GraalVMVersionSpec extends AnyWordSpec with Matchers {

  "GraalVM Version" should {
    "greater JDK version is considered newer" in {
      val graalVersion = "24.0.0"
      val ver1         = GraalVMVersion(graalVersion, "21.0.2")
      val ver2         = GraalVMVersion(graalVersion, "17.0.7")
      (ver1.compareTo(ver2) > 0) shouldBe true
    }

    "If JDK version is same (semver), greater Graal version is newer" in {
      val jdkVersion = "21.0.2"
      val ver1       = GraalVMVersion("24.0.2", jdkVersion)
      val ver2       = GraalVMVersion("24.0.0", jdkVersion)
      (ver1.compareTo(ver2) > 0) shouldBe true
    }

    "If JDK version is same (non semver), greater Graal version is newer" in {
      val jdkVersion = "21"
      val ver1       = GraalVMVersion("24.0.2", jdkVersion)
      val ver2       = GraalVMVersion("24.0.0", jdkVersion)
      (ver1.compareTo(ver2) > 0) shouldBe true
    }

    "be correctly ordered" in {
      val ver1       = GraalVMVersion("24.0.0", "21.0.2")
      val ver2       = GraalVMVersion("23.1.2", "21.0.2")
      val ver3       = GraalVMVersion("23.1.0", "21.0.1")
      val ver4       = GraalVMVersion("23.0.0", "17.0.7")
      val lst        = List(ver4, ver2, ver3, ver1)
      val sortedList = lst.sortWith((ver1, ver2) => ver1.compareTo(ver2) < 0)
      sortedList shouldEqual List(ver4, ver3, ver2, ver1)
    }

    "accept GraalVM's four- and five-part versions, and no more" in {
      GraalVMVersion.isCorrectVersionFormat("25") shouldBe true
      GraalVMVersion.isCorrectVersionFormat("25.0.1") shouldBe true
      GraalVMVersion.isCorrectVersionFormat("25.4.4.1") shouldBe true
      GraalVMVersion.isCorrectVersionFormat("25.5.5.0.3") shouldBe true
      GraalVMVersion.isCorrectVersionFormat("1.0.0-pre") shouldBe true
      GraalVMVersion.isCorrectVersionFormat("25.5.5.0.3.1") shouldBe false
      GraalVMVersion.isCorrectVersionFormat("25.5.x") shouldBe false
      GraalVMVersion.isCorrectVersionFormat("") shouldBe false
    }

    "hold an innovation release, whose JDK is not the release" in {
      val version = GraalVMVersion("25.5.5.0.3", "25.0.5.0.3")
      version.graalMajorVersion shouldEqual 25
      version.javaMajorVersion shouldEqual 25
      version.toString shouldEqual "GraalVM 25.5.5.0.3 Java 25.0.5.0.3"
    }

    "order five-part versions numerically, component by component" in {
      val lts        = GraalVMVersion("25.0.1", "25.0.1")
      val i4         = GraalVMVersion("25.4.4.1.1", "25.0.4.1.1")
      val i5         = GraalVMVersion("25.5.5.0.3", "25.0.5.0.3")
      val i5Patched  = GraalVMVersion("25.5.5.0.10", "25.0.5.0.10")
      val lst        = List(i5Patched, i5, lts, i4)
      val sortedList = lst.sortWith((a, b) => a.compareTo(b) < 0)
      sortedList shouldEqual List(lts, i4, i5, i5Patched)
      i5.compareTo(GraalVMVersion("25.5.5.0.3", "25.0.5.0.3")) shouldEqual 0
    }

    "compare equal only when equal" in {
      val padded = GraalVMVersion("25.0.1.0", "25.0.1")
      val plain  = GraalVMVersion("25.0.1", "25.0.1")
      padded.compareTo(plain) should not equal 0
      padded.compareTo(plain).sign shouldEqual -plain.compareTo(padded).sign
      plain.compareTo(GraalVMVersion("25.0.1", "25.0.1")) shouldEqual 0
    }

    "order releases of the same JDK by the release" in {
      val jdk = "25.0.5.0.3"
      (GraalVMVersion("25.5.5.0.3", jdk)
        .compareTo(GraalVMVersion("25.4.4.1.1", jdk)) > 0) shouldBe true
    }
  }
}
