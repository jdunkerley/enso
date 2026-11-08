package org.enso.languageserver.libraries

import org.enso.editions.provider.EditionProvider
import org.enso.editions.{DefaultEdition, EditionResolver, Editions}
import org.enso.languageserver.libraries.EditionReference.NamedEdition
import org.enso.pkg.{Config, PackageManager}

import com.typesafe.scalalogging.LazyLogging

import java.io.File
import scala.util.{Failure, Success, Try}

/** Resolves [[EditionReference]] to a raw or resolved edition. */
class EditionReferenceResolver(
  val projectRoot: File,
  editionProvider: EditionProvider,
  editionResolver: EditionResolver
) extends LazyLogging {
  private lazy val projectPackage =
    PackageManager.Default.loadPackage(projectRoot).get

  /** Loads the raw edition corresponding to the given [[EditionReference]]. */
  def resolveReference(
    editionReference: EditionReference
  ): Try[Editions.RawEdition] = editionReference match {
    case EditionReference.NamedEdition(editionName) =>
      editionProvider.findEditionForName(editionName).toTry
    case EditionReference.CurrentProjectEdition =>
      getCurrentProjectConfig.map(_.edition.getOrElse {
        // TODO [RW] default edition from config (#1864)
        DefaultEdition.getDefaultEdition
      })
  }

  /** Returns the configuration of the current project. */
  def getCurrentProjectConfig: Try[Config] = Try { projectPackage.getConfig() }

  /** Resolves all edition dependencies of an edition identified by
    * [[EditionReference]].
    */
  def resolveEdition(
    editionReference: EditionReference
  ): Try[Editions.ResolvedEdition] = for {
    raw      <- resolveReference(editionReference)
    resolved <- editionResolver.resolve(raw).toTry
  } yield resolved

  /** Resolves all edition dependencies of an edition identified by its name. */
  def resolveEdition(name: String): Try[Editions.ResolvedEdition] =
    resolveEdition(NamedEdition(name))

  /** Resolves a raw edition's parents. */
  def resolveRawEdition(
    edition: Editions.RawEdition
  ): Try[Editions.ResolvedEdition] =
    editionResolver.resolve(edition).toTry

  /** Resolves the current project's edition, or, if it cannot be resolved
    * (its edition file is not installed, say), the default edition, as the
    * runtime does (`DefaultPackageRepository.initializeRepository`). So the
    * listings of a project that runs on the default edition describe the
    * libraries it actually gets. Fails only if the default edition does not
    * resolve either.
    */
  def resolveCurrentProjectEditionOrDefault(): Try[Editions.ResolvedEdition] =
    resolveEdition(EditionReference.CurrentProjectEdition).recoverWith {
      error =>
        logger.warn(
          "The project's edition could not be resolved [{}]; using the " +
          "default edition instead.",
          error.getMessage
        )
        editionResolver.resolve(DefaultEdition.getDefaultEdition).toTry
    }

  /** Whether the current project's edition fails to resolve: the edition the
    * project names (or the raw edition's parent) and why, or `None` if it
    * resolves.
    */
  def currentProjectEditionFailure(): Option[(String, String)] =
    resolveEdition(EditionReference.CurrentProjectEdition) match {
      case Success(_) => None
      case Failure(error) =>
        val name = getCurrentProjectConfig.toOption
          .flatMap(_.edition)
          .flatMap(_.parent)
          .getOrElse("")
        Some((name, error.getMessage))
    }
}
