package org.enso.languageserver.libraries.handler

import akka.actor.{Actor, ActorRef, Props, Status}
import akka.pattern.pipe
import com.typesafe.scalalogging.LazyLogging
import org.enso.jsonrpc.{Id, Request, ResponseError, ResponseResult}
import org.enso.languageserver.libraries.LibraryApi._
import org.enso.languageserver.libraries.{
  BlockingOperation,
  EditionReference,
  EditionReferenceResolver,
  LibraryPublicType,
  LocalLibraryManagerFailureMapper
}
import org.enso.languageserver.util.UnhandledLogging
import org.enso.librarymanager.local.LocalLibraryProvider
import org.enso.librarymanager.published.PublishedLibraryCache

/** A request handler for the `library/listPublicTypes` endpoint: the types the
  * current project's installed libraries declare (`public-types:`).
  */
class LibraryListPublicTypesHandler(
  editionReferenceResolver: EditionReferenceResolver,
  localLibraryProvider: LocalLibraryProvider,
  publishedLibraryCache: PublishedLibraryCache
) extends Actor
    with LazyLogging
    with UnhandledLogging {
  override def receive: Receive = requestStage

  private case class Result(publicTypes: Seq[LibraryPublicType])

  import context.dispatcher

  private def requestStage: Receive = {
    case Request(LibraryListPublicTypes, id, _) =>
      BlockingOperation
        .run {
          val edition = editionReferenceResolver
            .resolveEdition(EditionReference.CurrentProjectEdition)
            .get
          val preferLocal =
            editionReferenceResolver.getCurrentProjectConfig.get.preferLocalLibraries
          LibraryPublicType.list(
            edition,
            preferLocal,
            localLibraryProvider,
            publishedLibraryCache
          )
        }
        .map(Result) pipeTo self

      context.become(responseStage(id, sender()))
  }

  private def responseStage(id: Id, replyTo: ActorRef): Receive = {
    case Result(publicTypes) =>
      replyTo ! ResponseResult(
        LibraryListPublicTypes,
        id,
        LibraryListPublicTypes.Result(publicTypes)
      )
      context.stop(self)

    case Status.Failure(exception) =>
      replyTo ! ResponseError(
        Some(id),
        LocalLibraryManagerFailureMapper.mapException(exception)
      )
      context.stop(self)
  }
}

object LibraryListPublicTypesHandler {

  /** Creates a configuration object to create
    * [[LibraryListPublicTypesHandler]].
    */
  def props(
    editionReferenceResolver: EditionReferenceResolver,
    localLibraryProvider: LocalLibraryProvider,
    publishedLibraryCache: PublishedLibraryCache
  ): Props = Props(
    new LibraryListPublicTypesHandler(
      editionReferenceResolver,
      localLibraryProvider,
      publishedLibraryCache
    )
  )
}
