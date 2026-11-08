package org.enso.languageserver.libraries.handler

import akka.actor.{Actor, ActorRef, Props, Status}
import akka.pattern.{ask, pipe}
import akka.util.Timeout
import com.typesafe.scalalogging.LazyLogging
import org.enso.editions.{DefaultEdition, Editions, LibraryName, LibraryVersion}
import org.enso.jsonrpc.{Id, Request, ResponseError, ResponseResult}
import org.enso.languageserver.filemanager.FileManagerApi.FileSystemError
import org.enso.languageserver.libraries.LibraryApi._
import org.enso.languageserver.libraries.{
  BlockingOperation,
  EditionReferenceResolver,
  LibraryLoadFailures
}
import org.enso.languageserver.util.UnhandledLogging
import org.enso.librarymanager.LibraryResolver
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache
import org.enso.version.BuildVersion

import scala.concurrent.duration._
import scala.util.{Failure, Success}

/** A request handler for the `editions/checkSwitch` endpoint: whether
  * switching the project's parent edition to another one (the bundled edition
  * by default) would let it load the libraries that failed, and
  * `Standard.Base`, without a download. Nothing is written.
  *
  * Note [Checking An Edition Switch].
  */
class EditionsCheckSwitchHandler(
  editionReferenceResolver: EditionReferenceResolver,
  localLibraryProvider: LocalLibraryProvider,
  publishedLibraryCache: PublishedLibraryCache,
  loadFailures: ActorRef
) extends Actor
    with LazyLogging
    with UnhandledLogging {
  override def receive: Receive = requestStage

  import context.dispatcher

  private def requestStage: Receive = {
    case Request(EditionsCheckSwitch, id, EditionsCheckSwitch.Params(edition)) =>
      implicit val timeout: Timeout = Timeout(10.seconds)
      val target = edition.getOrElse(BuildVersion.currentEdition)
      (loadFailures ? LibraryLoadFailures.GetFailures)
        .mapTo[LibraryLoadFailures.Failures]
        .flatMap { failures =>
          BlockingOperation.run {
            check(
              target,
              failures.failures.map(f => LibraryName(f.namespace, f.name))
            )
          }
        } pipeTo self

      context.become(responseStage(id, sender()))
  }

  /* Note [Checking An Edition Switch]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * The switch is checked on the edition `editions/setParentEdition` would
   * write: the project's raw edition with only its parent replaced, so its own
   * `libraries` overrides stay, and a project that pins a library itself is
   * not reported as fixed by the switch. The local-only IDE has no library
   * repository it can reach, so a library counts as resolved only if it is on
   * disk already, under the rule `InstalledLibraries.find` applies (cached or
   * bundled at the edition's version, or local when the project prefers local
   * libraries). The libraries checked are the ones that failed to load, and
   * `Standard.Base` always, since a project needs it whatever it imports.
   */
  private def check(
    target: String,
    failed: Seq[LibraryName]
  ): EditionsCheckSwitch.Result = {
    val config = editionReferenceResolver.getCurrentProjectConfig.get
    val raw     = config.edition.getOrElse(DefaultEdition.getDefaultEdition)
    val names   = (failed :+ LibraryName("Standard", "Base")).distinct
    val switched = raw.copy(parent = Some(target))
    val preferLocal = config.preferLocalLibraries
    val resolver    = LibraryResolver(localLibraryProvider)
    def versionIn(edition: Editions.ResolvedEdition)(name: LibraryName) =
      resolver
        .resolveLibraryVersion(name, edition, preferLocal)
        .toOption
    def isInstalled(name: LibraryName, version: LibraryVersion) =
      version match {
        case LibraryVersion.Local =>
          localLibraryProvider.findLibrary(name).isDefined
        case LibraryVersion.Published(semver, _) =>
          publishedLibraryCache.findCachedLibrary(name, semver).isDefined
      }
    val before = editionReferenceResolver.resolveRawEdition(raw).toOption
    editionReferenceResolver.resolveRawEdition(switched) match {
      case Failure(error) =>
        logger.warn(
          "The edition [{}] does not resolve: {}",
          target,
          error.getMessage
        )
        EditionsCheckSwitch.Result(
          current      = raw.parent,
          target       = target,
          resolves     = false,
          changes      = Seq(),
          stillMissing = names.map(_.toString)
        )
      case Success(after) =>
        val stillMissing = names.filterNot { name =>
          versionIn(after)(name).exists(isInstalled(name, _))
        }
        val changes = names.flatMap { name =>
          val from = before.flatMap(versionIn(_)(name)).map(showVersion)
          versionIn(after)(name).map(showVersion).collect {
            case to if !from.contains(to) =>
              EditionsCheckSwitch.VersionChange(name.toString, from, to)
          }
        }
        EditionsCheckSwitch.Result(
          current      = raw.parent,
          target       = target,
          resolves     = stillMissing.isEmpty,
          changes      = changes,
          stillMissing = stillMissing.map(_.toString)
        )
    }
  }

  private def showVersion(version: LibraryVersion): String = version match {
    case LibraryVersion.Local                => "local"
    case LibraryVersion.Published(semver, _) => semver.toString
  }

  private def responseStage(id: Id, replyTo: ActorRef): Receive = {
    case result: EditionsCheckSwitch.Result =>
      replyTo ! ResponseResult(EditionsCheckSwitch, id, result)
      context.stop(self)

    case Status.Failure(exception) =>
      replyTo ! ResponseError(Some(id), FileSystemError(exception.getMessage))
      context.stop(self)
  }
}

object EditionsCheckSwitchHandler {

  /** Creates a configuration object to create [[EditionsCheckSwitchHandler]]. */
  def props(
    editionReferenceResolver: EditionReferenceResolver,
    localLibraryProvider: LocalLibraryProvider,
    publishedLibraryCache: PublishedLibraryCache,
    loadFailures: ActorRef
  ): Props = Props(
    new EditionsCheckSwitchHandler(
      editionReferenceResolver,
      localLibraryProvider,
      publishedLibraryCache,
      loadFailures
    )
  )
}
