package org.enso.runtimeversionmanager.releases.graalvm

import org.enso.cli.OS
import org.enso.runtimeversionmanager.components.GraalVMVersion
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

class GraalCEReleaseProviderSpec extends AnyWordSpec with Matchers {
  private val lts        = GraalVMVersion("25.0.1", "25.0.1")
  private val innovation = GraalVMVersion("25.5.5.0.3", "25.0.5.0.3")

  "GraalCEReleaseProvider" should {
    "find 25.0.x under its JDK's tag" in {
      GraalCEReleaseProvider.tagName(lts) shouldEqual "jdk-25.0.1"
      GraalCEReleaseProvider.tagName(
        GraalVMVersion("23.2.0", "21.0.0")
      ) shouldEqual "jdk-21.0.0"
      GraalCEReleaseProvider.tagName(
        GraalVMVersion("22.3.1", "17")
      ) shouldEqual "vm-22.3.1"
    }

    "find an innovation release under its release's tag" in {
      GraalCEReleaseProvider.isInnovationRelease(innovation) shouldBe true
      GraalCEReleaseProvider.isInnovationRelease(lts) shouldBe false
      // The release/JDK shape: a JDK of another release, or a feature release
      // 0 with a different JDK, is not an innovation release.
      GraalCEReleaseProvider.isInnovationRelease(
        GraalVMVersion("25.5.5.0.3", "25.0.4.1.1")
      ) shouldBe false
      GraalCEReleaseProvider.isInnovationRelease(
        GraalVMVersion("25.0.2", "25.0.1")
      ) shouldBe false
      GraalCEReleaseProvider.isInnovationRelease(
        GraalVMVersion("25.1.3", "25.0.3")
      ) shouldBe true
      GraalCEReleaseProvider.tagName(innovation) shouldEqual "graal-25.5.5.0.3"
    }

    "name 25.0.x's packages by the JDK's version" in {
      GraalCEReleaseProvider.packageFileName(
        lts,
        OS.Linux,
        "amd64"
      ) shouldEqual "graalvm-community-jdk-25.0.1_linux-x64_bin.tar.gz"
      GraalCEReleaseProvider.packageFileName(
        lts,
        OS.Windows,
        "amd64"
      ) shouldEqual "graalvm-community-jdk-25.0.1_windows-x64_bin.zip"
    }

    "name an innovation release's packages as graalvm-ce-builds does" in {
      GraalCEReleaseProvider.packageFileName(
        innovation,
        OS.Linux,
        "amd64"
      ) shouldEqual "graalvm-community-jdk-25i5-25.0.5.0.3_linux-x64_bin.tar.gz"
      GraalCEReleaseProvider.packageFileName(
        innovation,
        OS.MacOS,
        "aarch64"
      ) shouldEqual "graalvm-community-jdk-25i5-25.0.5.0.3_macos-aarch64_bin.tar.gz"
      GraalCEReleaseProvider.packageFileName(
        innovation,
        OS.Windows,
        "amd64"
      ) shouldEqual "graalvm-community-jdk-25i5-25.0.5.0.3_windows-x64_bin.zip"
    }
  }
}
