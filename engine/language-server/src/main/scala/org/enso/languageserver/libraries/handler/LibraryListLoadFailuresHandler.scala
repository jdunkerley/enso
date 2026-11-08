package org.enso.languageserver.libraries.handler

import akka.actor.{Actor, ActorRef, Props, Status}
import akka.pattern.{ask, pipe}
import akka.util.Timeout
import com.typesafe.scalalogging.LazyLogging
import org.enso.jsonrpc.{Id, Request, ResponseError, ResponseResult}
import org.enso.languageserver.filemanager.FileManagerApi.FileSystemError
import org.enso.languageserver.libraries.LibraryApi._
import org.enso.languageserver.libraries.{
  BlockingOperation,
  EditionReferenceResolver,
  LibraryLoadFailures
}
import org.enso.languageserver.util.UnhandledLogging

import scala.concurrent.Future
import scala.concurrent.duration._

/** A request handler for the `library/listLoadFailures` endpoint: the
  * libraries the runtime could not load so far, and, first, whether the
  * project's edition itself could not be resolved.
  *
  * @param editionReferenceResolver resolves the project's edition
  * @param loadFailures the [[LibraryLoadFailures]] collector
  */
class LibraryListLoadFailuresHandler(
  editionReferenceResolver: EditionReferenceResolver,
  loadFailures: ActorRef
) extends Actor
    with LazyLogging
    with UnhandledLogging {
  override def receive: Receive = requestStage

  import context.dispatcher

  private case class Result(
    failures: Seq[LibraryLoadFailures.LibraryLoadFailure]
  )

  private def requestStage: Receive = {
    case Request(LibraryListLoadFailures, id, _) =>
      implicit val timeout: Timeout = Timeout(10.seconds)
      val edition = BlockingOperation.run {
        editionReferenceResolver.currentProjectEditionFailure().map {
          case (name, message) =>
            LibraryLoadFailures.LibraryLoadFailure(
              library = None,
              version = Some(name),
              kind    = LibraryLoadFailures.EditionNotFound,
              message = message
            )
        }
      }
      val libraries = (loadFailures ? LibraryLoadFailures.GetFailures)
        .mapTo[LibraryLoadFailures.Failures]
      Future
        .sequence(
          Seq(
            edition.map(_.toSeq),
            libraries.map(_.failures.map(LibraryLoadFailures.toJson))
          )
        )
        .map(parts => Result(parts.flatten)) pipeTo self

      context.become(responseStage(id, sender()))
  }

  private def responseStage(id: Id, replyTo: ActorRef): Receive = {
    case Result(failures) =>
      replyTo ! ResponseResult(
        LibraryListLoadFailures,
        id,
        LibraryListLoadFailures.Result(failures)
      )
      context.stop(self)

    case Status.Failure(exception) =>
      replyTo ! ResponseError(Some(id), FileSystemError(exception.getMessage))
      context.stop(self)
  }
}

object LibraryListLoadFailuresHandler {

  /** Creates a configuration object to create
    * [[LibraryListLoadFailuresHandler]].
    */
  def props(
    editionReferenceResolver: EditionReferenceResolver,
    loadFailures: ActorRef
  ): Props = Props(
    new LibraryListLoadFailuresHandler(editionReferenceResolver, loadFailures)
  )
}
