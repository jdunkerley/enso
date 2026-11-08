package org.enso.editions.updater

import org.enso.distribution.{DistributionManager, Environment, LanguageHome}
import org.enso.editions.Editions
import org.enso.distribution.config.GlobalConfigurationManager
import org.enso.librarymanager.test.published.repository.{
  DummyRepository,
  ExampleRepository
}
import org.enso.testkit.WithTemporaryDirectory
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.file.{Files, Path}

class EditionManagerTest
    extends AnyWordSpec
    with Matchers
    with WithTemporaryDirectory {

  val repo      = new ExampleRepository(Path.of("."))
  val port: Int = DummyRepository.freePort()
  def repoPath  = getTestDirectory.resolve("repo")

  /** A distribution inside the test directory whose global config points the
    * edition providers at the local test repository.
    */
  def makeDistributionManager(
    withProviders: Boolean = true
  ): DistributionManager = {
    val configDir = getTestDirectory.resolve("test_config")
    Files.createDirectories(configDir)
    if (withProviders) {
      Files.writeString(
        configDir.resolve(GlobalConfigurationManager.globalConfigName),
        s"edition-providers:\n- http://localhost:$port/editions\n"
      )
    }
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

    "have no edition provider by default, so an update downloads nothing" in {
      repo.withServer(port, repoPath) {
        val dm = makeDistributionManager(withProviders = false)
        new GlobalConfigurationManager(
          dm
        ).getConfig.editionProviders shouldBe empty
        val manager = EditionManager(dm, updating = true)
        manager.findAllAvailableEditions(update = true) shouldBe empty
      }
    }

    "ignore update when not updating" in {
      repo.withServer(port, repoPath) {
        val manager = EditionManager(makeDistributionManager())
        manager.findAllAvailableEditions(update = true) shouldBe empty
      }
    }

    "ignore a cached 0.0.0-dev edition, but not other cached editions" in {
      val dm       = makeDistributionManager(withProviders = false)
      val cacheDir = dm.paths.cachedEditions
      Files.createDirectories(cacheDir)
      Files.writeString(
        cacheDir.resolve("0.0.0-dev.yaml"),
        "engine-version: 0.0.0-dev\n"
      )
      Files.writeString(
        cacheDir.resolve("2025.1.1.yaml"),
        "engine-version: 2025.1.1\n"
      )
      val home = makeLanguageHome("2026.1.1-dev")

      for (updating <- Seq(false, true)) {
        val manager = EditionManager(dm, Some(home), updating = updating)
        def resolve(name: String) =
          manager.resolveEdition(Editions.Raw.Edition(parent = Some(name)))

        resolve("0.0.0-dev").isFailure shouldBe true
        resolve("2025.1.1").get.parent
          .flatMap(_.engineVersion)
          .map(_.toString) shouldBe Some("2025.1.1")
        resolve("2026.1.1-dev").isSuccess shouldBe true
        manager.findAllAvailableEditions(
          update = false
        ) should contain theSameElementsAs Seq("2026.1.1-dev", "2025.1.1")
      }
    }

    "still find a bundled 0.0.0-dev edition" in {
      val dm       = makeDistributionManager(withProviders = false)
      val cacheDir = dm.paths.cachedEditions
      Files.createDirectories(cacheDir)
      Files.writeString(
        cacheDir.resolve("0.0.0-dev.yaml"),
        "engine-version: 9.9.9\n"
      )
      val manager =
        EditionManager(dm, Some(makeLanguageHome("0.0.0-dev")))
      val resolved = manager
        .resolveEdition(Editions.Raw.Edition(parent = Some("0.0.0-dev")))
        .get
      resolved.parent.flatMap(_.engineVersion).map(_.toString) shouldBe
      Some("0.0.0-dev")
    }
  }

  /** A language home whose `editions` directory bundles one edition. */
  private def makeLanguageHome(edition: String): LanguageHome = {
    val root      = getTestDirectory.resolve("engine")
    val component = root.resolve("component")
    Files.createDirectories(component)
    val editions = root.resolve("editions")
    Files.createDirectories(editions)
    Files.writeString(
      editions.resolve(s"$edition.yaml"),
      s"engine-version: $edition\n"
    )
    LanguageHome(component)
  }
}
