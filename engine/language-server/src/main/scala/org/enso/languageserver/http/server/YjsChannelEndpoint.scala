package org.enso.languageserver.http.server

import akka.NotUsed
import akka.actor.{ActorRef, ActorSystem}
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.ws.{BinaryMessage, Message, TextMessage}
import akka.http.scaladsl.server.Directives._
import akka.http.scaladsl.server.Route
import akka.stream.OverflowStrategy
import akka.stream.scaladsl.{Flow, Sink, Source}
import akka.util.ByteString
import com.typesafe.scalalogging.LazyLogging
import org.enso.jsonrpc.Endpoint
import org.enso.ydoc.api.YjsChannel

import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.function.Consumer
import scala.collection.mutable
import scala.concurrent.duration._

/** The Language Server's end of the ydoc server's four channels, as WebSockets
  * on the RPC port: `/channel/{json,binary,vis-control,vis-data}?token=<t>`.
  * Each connection becomes one [[YjsChannel]] handed to the same
  * `Server.onConnect` callbacks the engine-hosted ydoc server calls in-process.
  * See Note [The Channel Socket] below.
  *
  * @param token the token a client must present, if the engine has one
  * @param servers the callbacks of each channel kind, looked up per connection
  * @param outgoingBufferSize the capacity of a socket's outgoing buffer
  */
final class YjsChannelEndpoint(
  token: Option[String],
  servers: () => Map[String, YjsChannel.Server],
  outgoingBufferSize: Int = 10000
)(implicit system: ActorSystem)
    extends Endpoint
    with LazyLogging {
  import system.dispatcher

  // Note [The Channel Socket]
  // =========================
  // Any loopback client can reach the RPC port, but only the ydoc host may
  // drive these channels: the shim gives the engine and its ydoc host the same
  // random token (`LANGUAGE_SERVER_CHANNEL_TOKEN`), compared here in constant
  // time and never logged. An engine started without one refuses every channel
  // socket. Text frames carry strings and binary frames `ByteBuffer`s, as the
  // in-process channels do.

  override def route: Route =
    path("channel" / Segment) { kind =>
      parameter("token".optional) { presented =>
        if (!authorised(presented)) complete(StatusCodes.Forbidden)
        else
          servers().get(kind) match {
            case None => complete(StatusCodes.NotFound)
            case Some(server) =>
              handleWebSocketMessages(connect(kind, server))
          }
      }
    }

  private def authorised(presented: Option[String]): Boolean =
    (token, presented) match {
      case (Some(expected), Some(actual)) =>
        MessageDigest.isEqual(
          expected.getBytes(StandardCharsets.UTF_8),
          actual.getBytes(StandardCharsets.UTF_8)
        )
      case _ => false
    }

  private def connect(
    kind: String,
    server: YjsChannel.Server
  ): Flow[Message, Message, NotUsed] = {
    val channel = new YjsChannelEndpoint.WebSocketYjsChannel(kind)
    val incoming: Sink[Message, NotUsed] =
      Flow[Message]
        .mapAsync(1) {
          case t: TextMessage =>
            t.toStrict(10.seconds).map(m => m.text: Object)
          case b: BinaryMessage =>
            b.toStrict(10.seconds).map(m => m.data.toByteBuffer: Object)
        }
        .watchTermination() { (_, done) =>
          done.onComplete(_ => channel.socketClosed())
          NotUsed
        }
        .to(Sink.foreach(channel.deliver))
    val outgoing: Source[Message, NotUsed] =
      Source
        .actorRef[Message](
          PartialFunction.empty,
          PartialFunction.empty,
          outgoingBufferSize,
          OverflowStrategy.fail
        )
        .mapMaterializedValue { out =>
          channel.attach(out)
          server.onConnect(channel)
          NotUsed
        }
    Flow.fromSinkAndSourceCoupled(incoming, outgoing)
  }
}

object YjsChannelEndpoint {
  val Kinds: Seq[String] = Seq("json", "binary", "vis-control", "vis-data")

  /** One channel socket as a [[YjsChannel]]. */
  final class WebSocketYjsChannel(kind: String) extends YjsChannel {
    private val lock                              = new Object
    private var out: Option[ActorRef]             = None
    private var handler: Option[Consumer[Object]] = None
    private val pending                           = mutable.Queue[Object]()
    private val closeHandlers                     = mutable.Buffer[Runnable]()
    private var closed                            = false

    private[server] def attach(ref: ActorRef): Unit =
      lock.synchronized { out = Some(ref) }

    override def send(message: Object): Unit = {
      val frame: Message = message match {
        case s: String => TextMessage.Strict(s)
        case b: ByteBuffer =>
          BinaryMessage.Strict(ByteString.fromByteBuffer(b.duplicate()))
        case other =>
          throw new IllegalArgumentException(
            s"Channel $kind sends a String or a ByteBuffer, not ${other.getClass.getName}"
          )
      }
      lock.synchronized(out).foreach(_ ! frame)
    }

    override def subscribe(messageHandler: Consumer[Object]): Unit = {
      val backlog = lock.synchronized {
        handler = Some(messageHandler)
        val b = pending.toList
        pending.clear()
        b
      }
      backlog.foreach(messageHandler.accept)
    }

    override def onClose(closeHandler: Runnable): Unit = {
      val runNow = lock.synchronized {
        if (!closed) closeHandlers += closeHandler
        closed
      }
      if (runNow) closeHandler.run()
    }

    private[server] def deliver(message: Object): Unit = {
      val target = lock.synchronized {
        if (handler.isEmpty) pending.enqueue(message)
        handler
      }
      target.foreach(_.accept(message))
    }

    private[server] def socketClosed(): Unit = {
      val toRun = lock.synchronized {
        if (closed) Nil
        else {
          closed = true
          val h = closeHandlers.toList
          closeHandlers.clear()
          h
        }
      }
      toRun.foreach(_.run())
    }
  }
}
