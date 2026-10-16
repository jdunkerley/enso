package org.enso.languageserver.text

import akka.actor.{Actor, ActorRef, Props, Terminated}
import com.typesafe.scalalogging.LazyLogging
import org.enso.languageserver.boot.TimingsConfig
import org.enso.languageserver.capability.CapabilityProtocol.{
  AcquireCapability,
  CapabilityAcquisitionBadRequest,
  CapabilityReleaseBadRequest,
  ReleaseCapability
}
import org.enso.languageserver.data.{CanEdit, CapabilityRegistration}
import org.enso.languageserver.filemanager.{
  ContentRootManager,
  FileEvent,
  FileEventKinds,
  Path
}
import org.enso.languageserver.monitoring.MonitoringProtocol.{Ping, Pong}
import org.enso.languageserver.util.UnhandledLogging
import org.enso.languageserver.text.TextProtocol.{
  ApplyEdit,
  ApplyExpressionValue,
  CloseFile,
  FileNotOpened,
  OpenBuffer,
  OpenFile,
  ReadCollaborativeBuffer,
  ReadCollaborativeBufferResult,
  SaveFile
}
import org.enso.logger.masking.MaskedPath
import org.enso.polyglot.runtime.Runtime.Api
import org.enso.text.ContentBasedVersioning

import java.util.UUID

/** An actor that routes request regarding text editing to the right buffer.
  * It creates a buffer actor, if a buffer doesn't exists.
  *
  * == Implementation ==
  *
  *   - 1  - Singleton
  *   - *C - Created per client.
  *   - *P - Created per file path.
  *   - *H - Request is forwarded to intermediate handler. Created per request.
  *
  * {{{
  *
  *                   *C                            1
  *  +------------------+   *H    +------------------+
  *  | ClientController +----+--->+  BufferRegistry  |
  *  +------------------+    ^    +---------+--------+
  *                          |              |
  *                          |              |
  *                    1     |              v       *P
  *  +------------------+    |   +----------+----------+
  *  | RuntimeConnector +<---+---+ CollaborativeBuffer |
  *  +------------------+        +----------+----------+
  *                                         ^
  *                                         |
  *                                         v     1
  *                                  +------+------+
  *                                  | FileManager |
  *                                  +-------------+
  *
  * }}}
  *
  * @param fileManager a file manager
  * @param runtimeConnector a gateway to the runtime
  * @param contentRootManager the content root manager
  * @param timingsConfig a config with timeout/delay values
  */
class BufferRegistry(
  fileManager: ActorRef,
  runtimeConnector: ActorRef,
  contentRootManager: ContentRootManager,
  timingsConfig: TimingsConfig
)(implicit
  versionCalculator: ContentBasedVersioning
) extends Actor
    with LazyLogging
    with UnhandledLogging {

  import context.dispatcher

  override def preStart(): Unit = {
    super.preStart()

    context.system.eventStream.subscribe(self, classOf[FileEvent])
    context.system.eventStream.subscribe(self, classOf[Api.FileEdit])
  }

  override def receive: Receive = running(Map.empty)

  private def running(registry: Map[Path, ActorRef]): Receive = {
    case Ping =>
      sender() ! Pong

    case msg @ OpenFile(_, path) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        val bufferRef =
          context.actorOf(
            CollaborativeBuffer.props(
              path,
              fileManager,
              runtimeConnector,
              timingsConfig = timingsConfig
            ),
            s"collaborative-buffer-${UUID.randomUUID()}"
          )
        context.watch(bufferRef)
        bufferRef.forward(msg)
        context.become(running(registry + (path -> bufferRef)))
      }

    case msg @ OpenBuffer(_, path) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        val bufferRef =
          context.actorOf(
            CollaborativeBuffer.props(
              path,
              fileManager,
              runtimeConnector,
              timingsConfig = timingsConfig
            )
          )
        context.watch(bufferRef)
        bufferRef.forward(msg)
        context.become(running(registry + (path -> bufferRef)))
      }

    case msg @ ReadCollaborativeBuffer(path) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        sender() ! ReadCollaborativeBufferResult(None)
      }

    case Terminated(bufferRef) =>
      context.become(running(registry.filter(_._2 != bufferRef)))

    case msg @ CloseFile(_, path) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        sender() ! FileNotOpened
      }

    case msg @ AcquireCapability(_, CapabilityRegistration(CanEdit(path))) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        sender() ! CapabilityAcquisitionBadRequest
      }

    case msg @ ReleaseCapability(_, CapabilityRegistration(CanEdit(path))) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        sender() ! CapabilityReleaseBadRequest
      }

    case msg @ ApplyEdit(_, FileEdit(path, _, _, _), _, _) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        sender() ! FileNotOpened
      }

    case msg @ ApplyExpressionValue(_, _, path, _, _, _) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        sender() ! FileNotOpened
      }

    case msg @ SaveFile(_, path, _) =>
      if (registry.contains(path)) {
        registry(path).forward(msg)
      } else {
        sender() ! FileNotOpened
      }

    case msg @ FileEvent(path, kind, _) =>
      if (kind == FileEventKinds.Added || kind == FileEventKinds.Modified) {
        registry.get(path).foreach { buffer =>
          buffer ! msg
        }
      }

    case msg: Api.FileEdit =>
      contentRootManager
        .findRelativePath(msg.path)
        .foreach {
          case Some(path) =>
            registry.get(path).foreach { buffer =>
              buffer ! ApplyEdit(
                None,
                FileEdit(
                  path,
                  msg.edits.toList,
                  msg.oldVersion,
                  msg.newVersion
                ),
                execute = true,
                None
              )
            }
          case None =>
            logger.error(
              "Failed to resolve path [{}].",
              MaskedPath(msg.path.toPath)
            )
        }
  }

}

object BufferRegistry {

  /** Creates a configuration object used to create a [[BufferRegistry]]
    *
    * @param fileManager a file manager actor
    * @param runtimeConnector a gateway to the runtime
    * @param contentRootManager the content root manager
    * @param timingsConfig a config with timout/delay values
    * @return a configuration object
    */
  def props(
    fileManager: ActorRef,
    runtimeConnector: ActorRef,
    contentRootManager: ContentRootManager,
    timingsConfig: TimingsConfig
  )(implicit
    versionCalculator: ContentBasedVersioning
  ): Props =
    Props(
      new BufferRegistry(
        fileManager,
        runtimeConnector,
        contentRootManager,
        timingsConfig
      )
    )

}
