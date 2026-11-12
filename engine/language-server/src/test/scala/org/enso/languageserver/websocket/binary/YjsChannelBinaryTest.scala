package org.enso.languageserver.websocket.binary

import akka.http.scaladsl.Http
import com.google.flatbuffers.FlatBufferBuilder
import akka.http.scaladsl.settings.ServerSettings
import org.enso.languageserver.http.server.{
  BinaryYdocServer,
  YjsChannelEndpoint
}
import org.enso.languageserver.protocol.binary.{
  InboundMessageDecoder,
  InboundPayload,
  OutboundMessage,
  OutboundPayload
}
import org.enso.languageserver.util.binary.{BinaryDecoder, BinaryEncoder}
import org.enso.languageserver.websocket.binary.factory.{
  InboundMessageFactory,
  SessionInitFactory
}
import org.enso.ydoc.api.YjsChannel

import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration._

/** The real binary-protocol handlers behind the Language Server's channel
  * socket, as the Node ydoc host reaches them: a binary frame must decode and
  * be answered.
  */
class YjsChannelBinaryTest extends BaseBinaryServerTest {

  implicit private val decoder: BinaryDecoder[OutboundMessage] =
    OutboundMessageDecoder

  private def bindEndpoint(): Http.ServerBinding = {
    val callbacks = new BinaryYdocServer.BinaryServerCallbacks(
      InboundMessageDecoder,
      BinaryEncoder.empty,
      connectionControllerFactory,
      Nil,
      system
    )
    val endpoint = new YjsChannelEndpoint(
      Some("s3cret"),
      () => Map[String, YjsChannel.Server]("binary" -> callbacks)
    )(system)
    Await.result(
      Http()
        .newServerAt(interface, 0)
        .withSettings(ServerSettings(system).withRemoteAddressAttribute(true))
        .bind(endpoint.route),
      5.seconds
    )
  }

  "The binary channel socket" must {

    "answer an initSession command" in {
      val binding = bindEndpoint()
      try {
        val client = new WsTestClient(
          s"ws://$interface:${binding.localAddress.getPort}/channel/binary?token=s3cret"
        )
        val requestId        = UUID.randomUUID()
        implicit val builder = new FlatBufferBuilder(1024)
        val cmd              = SessionInitFactory.create(UUID.randomUUID())
        builder.finish(
          InboundMessageFactory.create(
            requestId,
            None,
            InboundPayload.INIT_SESSION_CMD,
            cmd
          )
        )
        client.send(builder.dataBuffer())
        val Right(msg) = client.receiveMessage[OutboundMessage]()
        msg.payloadType() shouldBe OutboundPayload.SUCCESS
        msg.correlationId().leastSigBits() shouldBe
        requestId.getLeastSignificantBits
        msg.correlationId().mostSigBits() shouldBe
        requestId.getMostSignificantBits
      } finally {
        val _ = Await.result(binding.unbind(), 5.seconds)
      }
    }
  }
}
