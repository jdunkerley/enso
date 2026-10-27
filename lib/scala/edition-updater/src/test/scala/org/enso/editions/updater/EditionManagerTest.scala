package org.enso.editions.updater

import org.enso.distribution.{DistributionManager, Environment}
import org.enso.distribution.config.GlobalConfigurationManager
import org.enso.librarymanager.test.published.repository.ExampleRepository
import org.enso.testkit.WithTemporaryDirectory
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Path}

class EditionManagerTest
    extends AnyWordSpec
    with Matchers
    with WithTemporaryDirectory {

  val repo      = new ExampleRepository(Path.of("."))
  def port: Int = 47310
  def repoPath  = getTestDirectory.resolve("repo")

  /** A distribution inside the test directory whose global config points the
    * edition providers at the local test repository.
    */
  def makeDistributionManager(): DistributionManager = {
    val configDir = getTestDirectory.resolve("test_config")
    Files.createDirectories(configDir)
    Files.writeString(
      configDir.resolve(GlobalConfigurationManager.globalConfigName),
      s"edition-providers:\n- http://localhost:$port/editions\n"
    )
    val env = Map(
      "ENSO_DATA_DIRECTORY"    -> getTestDirectory.resolve("test_data"),
      "ENSO_CONFIG_DIRECTORY"  -> configDir,
      "ENSO_RUNTIME_DIRECTORY" -> getTestDirectory.resolve("test_run"),
      "ENSO_HOME"              -> getTestDirectory.resolve("test_home")
    ).view.mapValues(_.toString).toMap
    val environment = new Environment {
      override def getPathToRunningExecutable: Path =
        getTestDirectory.resolve("bin").resolve("enso")
      override def getEnvVar(key: String): Option[String] =
        env.get(key).orElse(super.getEnvVar(key))
    }
    new DistributionManager(environment)
  }

  override def beforeEach(): Unit = {
    super.beforeEach()
    repo.createRepository(repoPath)
  }

  "EditionManager" should {
    "download new editions on update when updating" in {
      repo.withServer(port, repoPath) {
        val manager =
          EditionManager(makeDistributionManager(), updating = true)
        manager.findAllAvailableEditions(update = false) shouldBe empty
        manager.findAllAvailableEditions(update =
          true
        ) should contain theSameElementsAs Seq("testlocal")
      }
    }

    "ignore update when not updating" in {
      repo.withServer(port, repoPath) {
        val manager = EditionManager(makeDistributionManager())
        manager.findAllAvailableEditions(update = true) shouldBe empty
      }
    }
  }
}
