import sbtlicensereport.SbtLicenseReport.autoImportImpl.{
  licenseDepExclusions,
  licenseOverrides,
  licenseSelection
}
import sbt.Keys.{update, updateClassifiers}
import sbt.{File, Project}
import src.main.scala.licenses.{
  DistributionDescription,
  SBTDistributionComponent
}
import src.main.scala.licenses.frontend.ResolvedDependencies

import scala.language.experimental.macros
import scala.reflect.macros.blackbox

object Distribution {

  /** Creates a [[DistributionDescription]].
    */
  def apply(
    name: String,
    packageDestination: File,
    sbtComponents: Seq[SBTDistributionComponent]
  ): DistributionDescription =
    DistributionDescription(name, packageDestination, sbtComponents)

  /** A macro that creates [[SBTDistributionComponent]] descriptions from a list
    * of project references.
    */
  def sbtProjects(projects: Project*): Seq[SBTDistributionComponent] =
    macro sbtProjectsImpl

  /** Implementation of the [[sbtProjects]] macro.
    *
    * It triggers execution of the tasks that are used to get information from
    * SBT on each project. See Note [Licence Review Follows The Shipped
    * Resolution] for why this reads `update` rather than `sbt-license-report`.
    */
  def sbtProjectsImpl(c: blackbox.Context)(
    projects: c.Expr[Project]*
  ): c.Expr[Seq[SBTDistributionComponent]] = {
    import c.universe._
    val gathered = {
      projects.map(p =>
        reify {
          val dependencies = ResolvedDependencies.collect(
            update           = (p.splice / update).value,
            classified       = (p.splice / updateClassifiers).value,
            configurations   = GatherLicenses.licenseConfigurations.value,
            licenseSelection = (p.splice / licenseSelection).value,
            overrides        = (p.splice / licenseOverrides).value.lift,
            exclusions       = (p.splice / licenseDepExclusions).value.lift
          )
          SBTDistributionComponent(p.splice.id, dependencies)
        }
      )
    }
    c.Expr[Seq[SBTDistributionComponent]](
      Apply(reify(Seq).tree, gathered.map(_.tree).toList)
    )
  }
}
