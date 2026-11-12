package org.enso.languageserver.http.server

import akka.NotUsed
import akka.actor.{ActorRef, ActorSystem}
import akka.http.scaladsl.model.{AttributeKeys, HttpRequest, StatusCodes}
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
import scala.util.control.NonFatal

/** The Language Server's end of the ydoc server's four channels, as WebSockets
  * on the RPC port: `/channel/{json,binary,vis-control,vis-data}?token=<t>`.
  * Each connection becomes one [[YjsChannel]] handed to the channel kind's
  * `Server.onConnect` callbacks.
  * See Note [The Channel Socket] below.
  *
  * @param token the token a client must present, if the engine has one
  * @param servers the callbacks of each channel kind, looked up per connection
  * @param outgoingBufferSize the capacity of a socket's outgoing buffer
  * @param maxPendingMessages how many inbound messages a channel keeps for a
  *                           handler that has not subscribed yet; the oldest
  *                           are dropped beyond it
  */
final class YjsChannelEndpoint(
  token: Option[String],
  servers: () => Map[String, YjsChannel.Server],
  outgoingBufferSize: Int = 10000,
  maxPendingMessages: Int = 1024
)(implicit system: ActorSystem)
    extends Endpoint
    with LazyLogging {
  import system.dispatcher

  // Note [The Channel Socket]
  // =========================
  // Any loopback client can reach the RPC port, but only the ydoc host may
  // drive these channels: the shim gives the engine and its ydoc host the same
  // random token (`LANGUAGE_SERVER_CHANNEL_TOKEN`), compared here in constant
  // time and never logged. An engine started without one (or with a blank one)
  // refuses every channel socket. Three more refusals, all `403` and all before
  // the token or the kind is looked at: a peer that is not on loopback (the
  // token travels in a cleartext query string, so a wildcard `--interface` must
  // not expose it; the peer is the connection's own remote-address
  // attribute, never `X-Forwarded-For`, which the client controls, so an absent
  // header refuses too), and a handshake from a web page: an `Origin` header
  // (browsers always send one, the Node ydoc host never does) or a
  // `Sec-Fetch-Site` header (Note [The RPC Port Refuses Web Pages]). Text
  // frames carry strings and binary frames `ByteBuffer`s, as the in-process
  // channels do.

  private val expectedToken: Option[String] = token.filter(_.nonEmpty)

  override def route: Route =
    path("channel" / Segment) { kind =>
      (extractRequest & parameter("token".optional)) { (request, presented) =>
        refusal(request, presented) match {
          case Some(reason) =>
            // Never the query string: it holds the token.
            logger.debug(
              s"Refused a channel socket on ${request.uri.path}: $reason"
            )
            complete(StatusCodes.Forbidden)
          case None =>
            servers().get(kind) match {
              case None => complete(StatusCodes.NotFound)
              case Some(server) =>
                handleWebSocketMessages(connect(kind, server))
            }
        }
      }
    }

  private def refusal(
    request: HttpRequest,
    presented: Option[String]
  ): Option[String] =
    if (!fromLoopback(request)) Some("the peer is not on loopback")
    else
      BrowserPageGuard
        .browserPage(request)
        .orElse(
          Option.when(!authorised(presented))("a missing or wrong token")
        )

  private def fromLoopback(request: HttpRequest): Boolean =
    request
      .attribute(AttributeKeys.remoteAddress)
      .flatMap(_.toIP)
      .exists(_.ip.isLoopbackAddress)

  private def authorised(presented: Option[String]): Boolean =
    (expectedToken, presented) match {
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
    val channel =
      new YjsChannelEndpoint.WebSocketYjsChannel(kind, maxPendingMessages)
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
          try server.onConnect(channel)
          catch {
            case NonFatal(e) =>
              logger.error(s"Channel $kind failed to connect", e)
              channel.socketClosed()
              throw e
          }
          NotUsed
        }
    Flow.fromSinkAndSourceCoupled(incoming, outgoing)
  }
}

object YjsChannelEndpoint {
  val Kinds: Seq[String] = Seq("json", "binary", "vis-control", "vis-data")

  /** One channel socket as a [[YjsChannel]]. */
  final class WebSocketYjsChannel(kind: String, maxPending: Int = 1024)
      extends YjsChannel
      with LazyLogging {
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

    // Delivery happens under the lock, so the backlog reaches a new handler
    // in order, before any later frame, and never concurrently with one. The
    // handlers only hand messages on (to actors or a queue), and the lock is
    // reentrant, so a handler may `send` from inside.
    override def subscribe(messageHandler: Consumer[Object]): Unit =
      lock.synchronized {
        handler = Some(messageHandler)
        while (pending.nonEmpty) messageHandler.accept(pending.dequeue())
      }

    override def onClose(closeHandler: Runnable): Unit = {
      val runNow = lock.synchronized {
        if (!closed) closeHandlers += closeHandler
        closed
      }
      if (runNow) closeHandler.run()
    }

    private[server] def deliver(message: Object): Unit = lock.synchronized {
      handler match {
        case Some(h) => h.accept(message)
        case None =>
          if (pending.size >= maxPending) {
            pending.dequeue()
            logger.debug(
              s"Channel $kind has no subscriber and $maxPending messages waiting: dropping the oldest"
            )
          }
          pending.enqueue(message)
      }
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
