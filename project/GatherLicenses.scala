import sbt.Keys._
import sbt._
import complete.DefaultParsers._
import src.main.scala.licenses.backend.{
  CombinedBackend,
  GatherCopyrights,
  GatherNotices,
  GithubHeuristic
}
import src.main.scala.licenses.frontend.SbtLicenses
import src.main.scala.licenses.report._
import src.main.scala.licenses.{
  DependencySummary,
  DistributionDescription,
  ReviewedSummary
}

import scala.sys.process._

/** The task and configuration for automatically gathering license information.
  */
object GatherLicenses {
  val distributions = taskKey[Seq[DistributionDescription]](
    "Defines descriptions of distributions."
  )
  val configurationRoot = settingKey[File]("Path to review configuration.")
  val licenseConfigurations =
    settingKey[Set[String]]("The ivy configurations we consider in the review.")
  private val stateFileName = "report-state"

  /** The task that performs the whole license gathering process. */
  def run = Def.inputTask {
    val names: Seq[String] = spaceDelimited("<arg>").parsed
    val log                = state.value.log
    val targetRoot         = target.value
    log.info(
      "Gathering license files and copyright notices. " +
      "This task may take a long time."
    )

    val configRoot = configurationRoot.value

    val namesToProcess: Set[String] = names.toSet
    val knownDistributions          = distributions.value
    val distributionsToProcess =
      if (names.isEmpty) knownDistributions
      else
        knownDistributions.filter(distribution =>
          namesToProcess.contains(distribution.artifactName)
        )

    val unrecognizedDistributions =
      namesToProcess -- distributionsToProcess.map(_.artifactName).toSet
    if (unrecognizedDistributions.nonEmpty) {
      val message =
        s"Unrecognized distribution names: $unrecognizedDistributions."
      log.error(message)
      throw new IllegalArgumentException(message)
    }
    log.info(
      s"Found following distributions to process: ${distributionsToProcess.map(_.artifactName)}"
    )

    val reports = distributionsToProcess.map { distribution =>
      log.info(s"Processing the ${distribution.artifactName} distribution")
      val projectNames = distribution.sbtComponents.map(_.name)
      log.info(
        s"It consists of the following sbt project roots:" +
        s" ${projectNames.mkString(", ")}"
      )
      val distributionRoot = configRoot / distribution.artifactName
      val expectedEmptyComponents =
        readComponentsWithoutDependencies(distributionRoot)
      val (sbtInfo, sbtDiagnostics) =
        SbtLicenses.analyze(
          distribution.sbtComponents,
          expectedEmptyComponents,
          log
        )

      val allInfo = sbtInfo // TODO [RW] add Rust frontend result here (#1187)

      log.info(s"${allInfo.size} unique dependencies discovered")
      val defaultBackend = CombinedBackend(GatherNotices, GatherCopyrights)

      val processed = allInfo.map { dependency =>
        log.debug(
          s"Processing ${dependency.moduleInfo} (${dependency.license}) -> " +
          s"${dependency.url}"
        )
        val defaultAttachments = defaultBackend.run(dependency.sources)
        val WithDiagnostics(attachments, attachmentDiagnostics) =
          if (defaultAttachments.nonEmpty) WithDiagnostics(defaultAttachments)
          else GithubHeuristic(dependency, log).run()
        (dependency, attachments, attachmentDiagnostics)
      }

      val forSummary            = processed.map(t => (t._1, t._2))
      val processingDiagnostics = processed.flatMap(_._3)
      val summary               = DependencySummary(forSummary)
      val WithDiagnostics(processedSummary, summaryDiagnostics) =
        Review(distributionRoot, summary).run()
      val allDiagnostics =
        sbtDiagnostics ++ processingDiagnostics ++ summaryDiagnostics
      val reportDestination =
        targetRoot / s"${distribution.artifactName}-report.html"

      val (warnings: Seq[Diagnostic.Warning], errors: Seq[Diagnostic.Error]) =
        Diagnostic.partition(allDiagnostics)

      if (warnings.nonEmpty) {
        log.warn(s"Found ${warnings.size} non-fatal warnings in the report:")
        warnings.foreach(notice => log.warn(notice.message))
      }

      if (errors.isEmpty) {
        log.info("No fatal errors found in the report.")
      } else {
        log.error(s"Found ${errors.size} fatal errors in the report:")
        errors.foreach(problem => log.error(problem.message))
      }

      Report.writeHTML(
        distribution,
        processedSummary,
        allDiagnostics,
        reportDestination
      )
      log.info(
        s"Written the report for the ${distribution.artifactName} to " +
        s"`$reportDestination`."
      )
      val packagePath = distribution.packageDestination
      PackageNotices.create(distribution, processedSummary, packagePath)
      ReportState.write(
        distributionRoot / stateFileName,
        distribution,
        expectedEmptyComponents,
        errors.size
      )
      log.info(s"Re-generated distribution notices at `$packagePath`.")
      if (errors.nonEmpty) {
        log.warn(
          "The distribution notices were regenerated, but there are " +
          "not-reviewed issues within the report. The notices are probably " +
          "incomplete."
        )
      }

      (distribution, processedSummary)
    }

    log.warn(
      "Finished gathering license information. " +
      "This is an automated process, make sure that its output is reviewed " +
      "by a human to ensure that all licensing requirements are met."
    )

    reports
  }

  private def verifyReportStatus(
    log: Logger,
    targetRoot: File,
    distributionDescription: DistributionDescription,
    distributionConfig: File
  ): Unit = {
    val name = distributionDescription.artifactName

    def warnAndThrow(exceptionMessage: String): Nothing = {
      log.error(exceptionMessage)
      log.warn(
        "Please make sure to run `enso / gatherLicenses` " +
        s"and review the reports generated at $targetRoot, " +
        "ensuring that the legal review is complete and there are no warnings."
      )
      log.warn(
        "See docs/distribution/licenses.md#review-process for a more detailed " +
        "explanation."
      )
      throw LegalReviewException(exceptionMessage)
    }

    ReportState.read(distributionConfig / stateFileName, log) match {
      case Some(reviewState) =>
        val currentInputHash =
          ReportState.computeInputHash(
            distributionDescription,
            readComponentsWithoutDependencies(distributionConfig)
          )
        if (currentInputHash != reviewState.inputHash) {
          log.info("Input hash computed from build.sbt: " + currentInputHash)
          log.info("Input hash stored in metadata: " + reviewState.inputHash)
          warnAndThrow(
            s"Report for the $name is not up to date - " +
            s"it seems that some dependencies were added or removed, or its " +
            s"`$componentsWithoutDependenciesFileName` list changed."
          )
        }

        if (reviewState.warningsCount > 0) {
          warnAndThrow(
            // `warningsCount` counts fatal errors: warnings are not stored.
            s"Report for the $name has ${reviewState.warningsCount} fatal " +
            s"errors - run `gatherLicenses` to see them."
          )
        }

        log.info(s"Report for $name is reviewed.")
      case None =>
        warnAndThrow(s"Report for $name has not been generated.")
    }
  }

  private def verifyPackage(
    log: Logger,
    distributionConfig: File,
    packageDestination: File
  ): Unit = {
    val reportState = ReportState
      .read(distributionConfig / stateFileName, log)
      .getOrElse(
        throw LegalReviewException(
          s"Report at $distributionConfig is not available. " +
          s"Make sure to run `enso/gatherLicenses` or `openLegalReviewReport`."
        )
      )

    val currentOutputHash = ReportState.computeOutputHash(packageDestination)
    if (currentOutputHash != reportState.outputHash) {
      log.info("Output hash computed from build.sbt: " + currentOutputHash)
      log.info("Output hash stored in metadata: " + reportState.outputHash)
      log.error(
        s"Generated package at $packageDestination seems to be not up-to-date."
      )
      log.warn(
        "Re-run `enso/gatherLicenses` and make sure that all files " +
        "from the notice package are committed, no unexpected files " +
        "have been added and the package is created in a consistent way."
      )
      throw LegalReviewException(
        s"Package $packageDestination has different content than expected."
      )
    } else {
      log.info(s"Package $packageDestination is up-to-date.")
    }
  }

  /** The task that verifies if the report has been generated and is up-to-date.
    */
  lazy val verifyReports = Def.task {
    val configRoot = configurationRoot.value
    val log        = streams.value.log
    val targetRoot = target.value

    for (distribution <- distributions.value) {
      val distributionConfig = configRoot / distribution.artifactName
      verifyReportStatus(
        log                     = log,
        targetRoot              = targetRoot,
        distributionDescription = distribution,
        distributionConfig      = distributionConfig
      )
      verifyPackage(
        log                = log,
        distributionConfig = distributionConfig,
        packageDestination = distribution.packageDestination
      )
    }
  }

  /** A task that verifies if contents of the provided package directory are
    * up-to-date with the review state.
    *
    * It takes two arguments:
    * - an artifact name identifying the distribution
    * - a path to the generated packages.
    */
  lazy val verifyGeneratedPackage = Def.inputTask {
    val configRoot        = configurationRoot.value
    val log               = streams.value.log
    val args: Seq[String] = spaceDelimited("<arg>").parsed
    val (distributionName, packagePathString) = args match {
      case Seq(distribution, path) => (distribution, path)
      case _ =>
        throw new IllegalArgumentException(
          "The task expects exactly 2 arguments."
        )
    }
    val packageDestination = file(packagePathString)
    verifyPackage(
      log                = log,
      distributionConfig = configRoot / distributionName,
      packageDestination = packageDestination
    )
  }

  case class LegalReviewException(string: String)
      extends RuntimeException(string)

  /** Launches a server that allows to easily review the generated report.
    *
    * Requires `npm` to be on the system PATH.
    */
  def runReportServer(): Unit = {
    Seq("npm", "install").!
    Process(Seq("npm", "start"), file("tools/legal-review-helper"))
      .run(connectInput = true)
      .exitValue()
  }

  /** Name of the file, in a distribution's review configuration, that lists
    * the components which are expected to have no third-party dependencies.
    *
    * Each line is `<component>: <reason>`; blank lines and lines starting with
    * `#` are ignored. A component with no third-party dependencies that is not
    * listed is reported as a warning, because it usually means that what it
    * ships is invisible to the review (for example a library that it depends
    * on as `provided` and ships through a JAR wrapper that is not a component
    * of the distribution). A listed component that does have dependencies, or
    * a listed name that is not a component of the distribution, is an error,
    * so that the list cannot go stale; and the list is part of the input hash
    * in `report-state`, so editing it requires regenerating the report.
    */
  val componentsWithoutDependenciesFileName = "components-without-dependencies"

  private def readComponentsWithoutDependencies(
    distributionRoot: File
  ): Map[String, String] = {
    val file = distributionRoot / componentsWithoutDependenciesFileName
    if (!file.exists()) Map()
    else
      IO.readLines(file)
        .map(_.trim)
        .filter(line => line.nonEmpty && !line.startsWith("#"))
        .map { line =>
          line.split(":", 2) match {
            case Array(component, reason) if reason.trim.nonEmpty =>
              component.trim -> reason.trim
            case _ =>
              throw new IllegalArgumentException(
                s"Malformed line in $file: `$line`. " +
                "Expected `<component>: <reason>`."
              )
          }
        }
        .toMap
  }

  /** A task that prints which sub-projects of which distributions resolve a
    * dependency, to help track down where a dependency comes from.
    *
    * sbt's built-in `<project>/dependencyTree` shows which of the project's
    * dependencies pulls it in.
    */
  lazy val analyzeDependency = Def.inputTask {
    val args: Seq[String]      = spaceDelimited("<arg>").parsed
    val evaluatedDistributions = distributions.value
    val log                    = streams.value.log
    for (arg <- args) {
      for (distribution <- evaluatedDistributions) {
        for (sbtComponent <- distribution.sbtComponents) {
          for (dep <- sbtComponent.dependencies.dependencies) {
            if (dep.module.name.contains(arg)) {
              log.info(
                s"${distribution.artifactName} distribution, project " +
                s"${sbtComponent.name} contains ${dep.module}; run " +
                s"`${sbtComponent.name}/dependencyTree` to see what depends " +
                s"on it."
              )
            }
          }
        }
      }
    }
  }
}
