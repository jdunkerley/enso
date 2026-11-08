package org.enso.editions.updater

import org.enso.distribution.config.GlobalConfigurationManager
import org.enso.distribution.{DistributionManager, LanguageHome}
import org.enso.editions
import org.enso.editions.{EditionResolver, Editions}
import org.enso.semver.SemVer

import java.nio.file.Path
import scala.util.Try

/** A helper class for resolving editions. */
class EditionManager private (
  editionProvider: editions.provider.EditionProvider
) {
  private val editionResolver = EditionResolver(editionProvider)
  private val engineVersionResolver =
    editions.EngineVersionResolver(editionProvider)

  /** Resolves a raw edition, loading its parents from the edition search path.
    *
    * @param edition the edition to resolve
    * @return the resolved edition
    */
  def resolveEdition(
    edition: Editions.RawEdition
  ): Try[Editions.ResolvedEdition] =
    editionResolver.resolve(edition).toTry

  /** Resolves the engine version that should be used based on the provided raw
    * edition configuration.
    *
    * @param edition the edition configuration to base the selected version on;
    *                if it is not specified, it will fallback to the default
    *                engine version
    * @return the resolved engine version
    */
  def resolveEngineVersion(edition: Editions.RawEdition): Try[SemVer] =
    engineVersionResolver.resolveEnsoVersion(edition).toTry

  /** Find all editions available in the [[searchPaths]], performing an update
    * if asked to.
    */
  def findAllAvailableEditions(update: Boolean): Seq[String] =
    editionProvider.findAvailableEditions(update)
}

object EditionManager {

  /** Create an [[EditionProvider]] that can locate editions from the
    * distribution (if updating) and the language home.
    */
  final def makeEditionProvider(
    distributionManager: DistributionManager,
    languageHome: Option[LanguageHome],
    updating: Boolean
  ): editions.provider.EditionProvider = {
    val config      = new GlobalConfigurationManager(distributionManager).getConfig
    val searchPaths = getSearchPaths(distributionManager, languageHome)
    val cachePath   = distributionManager.paths.cachedEditions
    if (updating) {
      new UpdatingEditionProvider(
        searchPaths,
        cachePath,
        config.editionProviders
      )
    } else {
      val actualSearchPaths = (searchPaths ++ List(cachePath)).distinct
      new editions.provider.FileSystemEditionProvider(
        actualSearchPaths,
        ignoredCachedEditions(cachePath)
      )
    }
  }

  /** The edition names whose files in the user's edition cache are ignored.
    * Note [A Cached Development Edition Is Ignored].
    */
  val IgnoredCachedEditionNames: Set[String] = Set("0.0.0-dev")

  /* Note [A Cached Development Edition Is Ignored]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * `0.0.0-dev` is the edition every development build bundles and writes
   * into the projects it creates. An installed IDE bundles its own edition
   * (say `2026.1.1-dev`), so for it the name `0.0.0-dev` is found only in the
   * user's cache, `<data>/editions`, where it is a stale file from some other
   * build (upstream's lists every `Standard.*` at `0.0.0-dev` from a
   * repository that no longer serves them). Resolving a project against it
   * makes every import try a download that cannot succeed (#600). So the
   * cached file of that name is ignored: the edition is then not found, and
   * the runtime and the language server fall back to the bundled edition,
   * which is what such a project needs. A development build still finds its
   * own `0.0.0-dev` in the language home first, and other cached editions
   * are used as before. A development engine run without a language home that
   * relied on a hand-placed `<data>/editions/0.0.0-dev.yaml` now falls back to
   * its default edition too; put such a file on `ENSO_EDITION_PATH` instead,
   * which is still searched.
   */
  private[updater] def ignoredCachedEditions(
    cachePath: Path
  ): Map[Path, Set[String]] = Map(cachePath -> IgnoredCachedEditionNames)

  /** Get search paths associated with the distribution and language home. */
  private def getSearchPaths(
    distributionManager: DistributionManager,
    languageHome: Option[LanguageHome]
  ): List[Path] = {
    val paths = languageHome.map(_.editions).toList ++
      distributionManager.paths.editionSearchPaths
    paths.distinct
  }

  /** Create an [[EditionManager]] that can locate editions from the
    * distribution and the language home.
    *
    * @param updating whether [[EditionManager.findAllAvailableEditions]] with
    *                 `update = true` should download new editions from the
    *                 edition providers in the global config; without it that
    *                 flag has no effect
    */
  def apply(
    distributionManager: DistributionManager,
    languageHome: Option[LanguageHome] = None,
    updating: Boolean                  = false
  ): EditionManager = new EditionManager(
    makeEditionProvider(distributionManager, languageHome, updating)
  )
}
