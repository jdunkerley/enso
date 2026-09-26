package src.main.scala.licenses.frontend

import java.nio.file.Path
import sbt.librarymanagement.{ConfigRef, ModuleReport, UpdateReport}
import sbtlicensereport.license.{DepModuleInfo, LicenseCategory, LicenseInfo}

/** A third-party module that the build resolved for a distribution component.
  *
  * @param module the resolved module coordinates
  * @param license the licence picked from the module's POM
  * @param homepage the project URL from the module's POM, if any
  * @param sources the `-sources` JARs resolved for exactly this module
  */
case class ResolvedDependency(
  module: DepModuleInfo,
  license: LicenseInfo,
  homepage: Option[String],
  sources: Seq[Path]
)

/** Everything the licence review needs to know about one sbt project's
  * dependencies.
  *
  * @param dependencies modules that contribute an artifact to the project
  * @param modulesWithoutArtifacts modules that resolved without any artifact
  *                                (BOMs and parent POMs declared as
  *                                dependencies); nothing of theirs is shipped
  * @param unmatchedSources `-sources` JARs that do not belong to any module in
  *                         `dependencies`
  */
case class ComponentDependencies(
  dependencies: Seq[ResolvedDependency],
  modulesWithoutArtifacts: Seq[DepModuleInfo],
  unmatchedSources: Seq[Path]
)

/** Reads the dependencies of a project from sbt's own dependency resolution.
  *
  * Note [Licence Review Follows The Shipped Resolution]
  * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  * The review must describe the modules that are shipped, and what is shipped
  * is decided by the `update` report (coursier): `StdBits.copyDependencies`,
  * the engine's module path and the JAR wrappers all read it. The review used
  * to take its modules from `sbt-license-report`, which runs a separate Ivy
  * resolution of the same project, and the two disagree wherever a
  * dependency's POM manages the versions of its transitive dependencies:
  * `snowflake-jdbc-thin` imports `grpc-bom` and `protobuf-bom`
  * (`<scope>import</scope>`), which coursier applies and Ivy does not, so the
  * review described gRPC 1.67.1 and protobuf 3.25.5 while gRPC 1.77.0 and
  * protobuf 4.28.2 were shipped (and `std-aws` had commons-logging 1.1.3
  * described, 1.2 shipped). The review therefore takes both the
  * modules and their licences from the `update` report. The POM metadata there
  * is the same as Ivy's, and the licence is picked by the same rule as
  * `sbt-license-report` uses, so the reviewed licence names are unchanged.
  *
  * A module that resolves to no artifact at all - a BOM or a parent POM
  * declared as a dependency, like `software.amazon.awssdk:bom` in `std-aws` -
  * contributes nothing that is shipped, so it is left out of the review.
  *
  * Sources come from the `updateClassifiers` report, which is the same
  * resolution with classifiers, and are paired with a module by its exact
  * coordinates. (They used to be paired by name and major version, because
  * exact versions failed to match - which was the Ivy/coursier disagreement.)
  */
object ResolvedDependencies {

  /** Collects the dependencies of one project.
    *
    * @param update the project's `update` report
    * @param classified the project's `updateClassifiers` report
    * @param configurations names of the configurations whose modules are
    *                       shipped
    * @param licenseSelection licence categories in order of preference, used
    *                         to pick one licence of a multi-licensed module
    * @param overrides licence overrides configured for the project
    * @param exclusions dependency exclusions configured for the project
    */
  def collect(
    update: UpdateReport,
    classified: UpdateReport,
    configurations: Set[String],
    licenseSelection: Seq[LicenseCategory],
    overrides: DepModuleInfo => Option[LicenseInfo],
    exclusions: DepModuleInfo => Option[Boolean]
  ): ComponentDependencies = {
    val (withArtifacts, withoutArtifacts) =
      resolvedModules(update, configurations)
        .filterNot(m => exclusions(moduleInfo(m)).getOrElse(false))
        .partition(_.artifacts.nonEmpty)

    val sourcesByModule: Map[DepModuleInfo, Seq[Path]] =
      resolvedModules(classified, configurations)
        .map(m => moduleInfo(m) -> sourceJars(m))
        .filter(_._2.nonEmpty)
        .groupBy(_._1)
        .map { case (module, entries) =>
          module -> entries.flatMap(_._2).distinct
        }

    val dependencies = withArtifacts.map { report =>
      val module = moduleInfo(report)
      ResolvedDependency(
        module = module,
        license =
          overrides(module).getOrElse(pickLicense(licenseSelection, report)),
        homepage = report.homepage,
        sources  = sourcesByModule.getOrElse(module, Seq())
      )
    }

    val known = dependencies.map(_.module).toSet
    val unmatchedSources =
      sourcesByModule
        .filter { case (module, _) => !known.contains(module) }
        .values
        .flatten
        .toSeq
        .sortBy(_.toString)

    ComponentDependencies(
      dependencies            = dependencies,
      modulesWithoutArtifacts = withoutArtifacts.map(moduleInfo),
      unmatchedSources        = unmatchedSources
    )
  }

  /** The non-evicted modules of the selected configurations, one entry per
    * module.
    */
  private def resolvedModules(
    report: UpdateReport,
    configurations: Set[String]
  ): Seq[ModuleReport] = {
    val modules = for {
      name          <- configurations.toSeq.sorted
      configuration <- report.configuration(ConfigRef(name)).toSeq
      module        <- configuration.modules
      if !module.evicted
    } yield module
    // A module can be listed once per configuration and, when it is depended
    // on with several classifiers, once per classifier. Merge the artifacts.
    modules
      .groupBy(moduleInfo)
      .toSeq
      .sortBy(_._1.toString)
      .map { case (_, reports) =>
        reports.head.withArtifacts(
          reports.flatMap(_.artifacts).distinct.toVector
        )
      }
  }

  private def sourceJars(module: ModuleReport): Seq[Path] =
    module.artifacts.collect {
      case (artifact, file) if artifact.classifier.contains("sources") =>
        file.toPath
    }

  /** The coordinates of the module, in the form used by the review. */
  def moduleInfo(module: ModuleReport): DepModuleInfo =
    DepModuleInfo(
      module.module.organization,
      module.module.name,
      module.module.revision
    )

  /** Picks one licence of the module, preferring the licence categories in
    * the order given.
    *
    * This is the rule `sbt-license-report` applies, including its placeholder
    * for a POM that declares no licence, so that the licence names (which key
    * the `reviewed-licenses` configuration) stay the same.
    */
  def pickLicense(
    licenseSelection: Seq[LicenseCategory],
    module: ModuleReport
  ): LicenseInfo = {
    val noneSpecified = "none specified"
    val declared = module.licenses.map { case (name, url) =>
      (name, url.getOrElse(""))
    }
    val licenses =
      if (declared.isEmpty) Seq((noneSpecified, noneSpecified)) else declared
    val preferred = licenseSelection.iterator.flatMap { category =>
      licenses.collectFirst {
        case (name, url) if category.unapply(name) =>
          LicenseInfo(category, name, url)
      }
    }
    if (preferred.hasNext) preferred.next()
    else {
      val (name, url) = licenses.head
      LicenseInfo(LicenseCategory.Unrecognized, name, url)
    }
  }
}
