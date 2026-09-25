package src.main.scala.licenses

import sbt.File
import src.main.scala.licenses.frontend.ComponentDependencies

/** Describes a component included in the distribution managed by SBT.
  *
  * @param name name of the component
  * @param dependencies the component's dependencies, as resolved by the
  *                     `update` and `updateClassifiers` tasks
  */
case class SBTDistributionComponent(
  name: String,
  dependencies: ComponentDependencies
)

/** Describes an artifact consisting of multiple components that is distributed
  * independently.
  *
  * @param artifactName name of the artifact
  * @param packageDestination location of the generated notice package
  * @param sbtComponents sequence of SBT components that constitute this
  *                      artifact; only root components (components that are
  *                      directly packaged and distributed) are required (i.e.
  *                      if X is distributed and X depends on Y but Y is not
  *                      directly included, it does not have to be on this list
  *                      as it will be automatically discovered); a project
  *                      that is only a `provided` dependency but whose
  *                      artifacts are shipped anyway (the JAR wrappers) must
  *                      be listed
  */
case class DistributionDescription(
  artifactName: String,
  packageDestination: File,
  sbtComponents: Seq[SBTDistributionComponent]
) {

  /** Returns names of root components included in the distribution.
    */
  def rootComponentsNames: Seq[String] = sbtComponents.map(_.name)
}
