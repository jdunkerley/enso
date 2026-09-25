package src.main.scala.licenses.frontend

import java.nio.file.Path
import sbt.Compile
import sbt.internal.util.ManagedLogger
import sbt.io.IO
import src.main.scala.licenses.report.Diagnostic
import src.main.scala.licenses.{
  DependencyInformation,
  SBTDistributionComponent,
  SourceAccess
}

/** Defines the algorithm for discovering dependency metadata.
  */
object SbtLicenses {

  /** Defines configurations that are deemed relevant for dependency discovery.
    *
    * Currently we only analyse Compile dependencies as these are the ones that
    * get packaged.
    *
    * Provided dependencies are assumed to be already present in the used
    * runtime, so we do not distribute them. One exception is the launcher which
    * does distribute the provided SubstrateVM dependencies as part of it being
    * compiled with the SVM. But that has to be handled independently anyway.
    * Another is a JAR wrapper that a standard library depends on as `provided`
    * and then ships itself; such a wrapper is listed as a component of the
    * distribution.
    */
  val relevantConfigurations = Seq(Compile)

  /** Analyzes the provided [[SBTDistributionComponent]]s collecting their
    * unique dependencies and issuing any warnings.
    *
    * @param components description of SBT components included in the
    *                   distribution
    * @param expectedEmptyComponents names of components that are known to have
    *                                no third-party dependencies, with the
    *                                reason
    * @param log logger to use
    * @return a sequence of collected dependency information and a sequence of
    *         encountered warnings
    */
  def analyze(
    components: Seq[SBTDistributionComponent],
    expectedEmptyComponents: Map[String, String],
    log: ManagedLogger
  ): (Seq[DependencyInformation], Seq[Diagnostic]) = {
    val distinctDependencies =
      components
        .flatMap(_.dependencies.dependencies)
        .groupBy(_.module)
        .toSeq
        .sortBy(_._1.toString)
        .map { case (_, same) =>
          same.head.copy(sources = same.flatMap(_.sources).distinct)
        }

    val relevantDeps =
      for (dependency <- distinctDependencies)
        yield DependencyInformation(
          moduleInfo = dependency.module,
          license    = dependency.license,
          sources    = dependency.sources.map(createSourceAccessFromJAR),
          url        = dependency.homepage
        )
    val keptDeps = relevantDeps.filter(DependencyFilter.shouldKeep)

    for {
      module <- components
        .flatMap(_.dependencies.modulesWithoutArtifacts)
        .filter(DependencyFilter.shouldKeep)
        .distinct
        .sortBy(_.toString)
    } log.info(
      s"$module resolves to no artifact (a BOM or a parent POM declared as a " +
      s"dependency), so nothing of it is shipped; it is not part of the report."
    )

    val missingWarnings = for {
      dep <- keptDeps
      if dep.sources.isEmpty
    } yield Diagnostic.Warning(s"Could not find sources for ${dep.moduleInfo}")

    // A source unmatched within one component may belong to a module that
    // another component of the same distribution resolves.
    val unexpectedWarnings = for {
      source <- components
        .flatMap(_.dependencies.unmatchedSources)
        .distinct
      if !distinctDependencies.exists(_.sources.contains(source))
    } yield Diagnostic.Warning(
      s"Found a source $source that does not belong to any known " +
      s"dependencies, perhaps the algorithm needs updating?"
    )

    val emptinessDiagnostics = components.flatMap { component =>
      val thirdParty =
        component.dependencies.dependencies.filter(dep =>
          DependencyFilter.shouldKeep(dep.module)
        )
      expectedEmptyComponents.get(component.name) match {
        case Some(reason) if thirdParty.isEmpty =>
          log.info(
            s"Component ${component.name} has no third-party dependencies, " +
            s"as expected: $reason"
          )
          Seq()
        case Some(_) =>
          Seq(
            Diagnostic.Warning(
              s"Component ${component.name} is listed as having no " +
              s"third-party dependencies, but it has " +
              s"${thirdParty.map(_.module).mkString(", ")}. Remove it from " +
              s"the list."
            )
          )
        case None if thirdParty.isEmpty =>
          Seq(
            Diagnostic.Warning(
              s"License report for component ${component.name} is empty."
            )
          )
        case None => Seq()
      }
    }

    // An entry for a component that is no longer part of the distribution
    // (renamed or removed) is never visited above, so check for it separately.
    val componentNames = components.map(_.name).toSet
    val unknownEntryWarnings = for {
      name <- expectedEmptyComponents.keys.toSeq.sorted
      if !componentNames.contains(name)
    } yield Diagnostic.Warning(
      s"Component $name is listed as having no third-party dependencies, but " +
      s"it is not a component of this distribution. Remove it from the list."
    )

    (
      keptDeps,
      missingWarnings ++ unexpectedWarnings ++ emptinessDiagnostics ++
      unknownEntryWarnings
    )
  }

  /** Creates a [[SourceAccess]] instance that unpacks the source files from a
    * JAR archive into a temporary directory.
    *
    * It removes the temporary directory after the analysis is finished.
    */
  private def createSourceAccessFromJAR(jarPath: Path): SourceAccess =
    new SourceAccess {
      override def access[R](withSources: Path => R): R =
        IO.withTemporaryDirectory { root =>
          IO.unzip(jarPath.toFile, root, jarFileNameFilter)
          withSources(root.toPath)
        }
    }

  /** Filter for the files extracted from the JAR archive.
    *
    * Filtered files:
    * - Files with absolute paths
    *
    * @param name the file name in the JAR archive
    * @return the predicate indicating if the path should be extracted
    */
  private def jarFileNameFilter(name: String): Boolean = {
    !name.startsWith("/")
  }
}
