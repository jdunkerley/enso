package org.enso.runtimeversionmanager.components

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.util.Try

class ManifestSpec extends AnyWordSpec with Matchers {

  /** `distribution/manifest.template.yaml` plus the two lines
    * `DistributionPackage.buildEngineManifest` appends, for a build on GraalVM
    * CE 25.5.5.0.3: the release and its JDK, with five components each.
    */
  private val innovationManifest =
    """minimum-launcher-version: 2024.5.1-nightly.2024.11.29
      |minimum-project-manager-version: 2024.5.1-nightly.2024.11.29
      |jvm-options:
      |  - value: "-Djdk.graal.PrintGraph=Network"
      |  - value: "--add-opens=java.base/java.nio=ALL-UNNAMED"
      |graal-vm-version: 25.5.5.0.3
      |graal-java-version: 25.0.5.0.3
      |""".stripMargin

  "Manifest" should {
    "read a manifest built on a GraalVM innovation release" in {
      val manifest = Manifest.fromYaml(innovationManifest).get
      manifest.graalVMVersion shouldEqual "25.5.5.0.3"
      manifest.graalJavaVersion shouldEqual "25.0.5.0.3"
      manifest.runtimeVersion shouldEqual GraalVMVersion(
        "25.5.5.0.3",
        "25.0.5.0.3"
      )
    }

    "read a manifest built on GraalVM 25.0.1" in {
      val manifest = Manifest
        .fromYaml(
          innovationManifest
            .replace("25.5.5.0.3", "25.0.1")
            .replace("25.0.5.0.3", "25.0.1")
        )
        .get
      manifest.runtimeVersion shouldEqual GraalVMVersion("25.0.1", "25.0.1")
    }

    "reject a version with more than five components" in {
      // The format check is a `require` in the constructor, which escapes `fromYaml`.
      Try(
        Manifest.fromYaml(
          innovationManifest.replace("25.5.5.0.3", "25.5.5.0.3.1")
        )
      ).flatten.isFailure shouldBe true
    }
  }
}
