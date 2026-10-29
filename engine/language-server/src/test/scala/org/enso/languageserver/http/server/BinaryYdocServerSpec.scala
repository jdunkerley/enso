package org.enso.languageserver.http.server

import akka.actor.{ActorRef, ActorSystem}
import akka.testkit.{TestKit, TestProbe}
import org.enso.languageserver.http.server.BinaryWebSocketControlProtocol.{
  ConnectionClosed,
  OutboundStreamEstablished
}
import org.enso.languageserver.util.binary.{
  BinaryDecoder,
  BinaryEncoder,
  DecodingFailure
}
import org.enso.ydoc.api.YjsChannel
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpecLike

import java.nio.ByteBuffer
import java.util.function.Consumer

import scala.concurrent.duration._

class BinaryYdocServerSpec
    extends TestKit(ActorSystem("BinaryYdocServerSpec"))
    with AnyWordSpecLike
    with Matchers
    with BeforeAndAfterAll {

  override def afterAll(): Unit = {
    TestKit.shutdownActorSystem(system, verifySystemShutdown = true)
    super.afterAll()
  }

  /** Hands out `controller` as the connection controller of every session. */
  final class ProbeControllerFactory(controller: TestProbe)
      extends ConnectionControllerFactory {
    override def createController(): ActorRef = controller.ref
  }

  /** Records what the server registers on it, and closes it the way the Ydoc
    * server does.
    */
  final class FakeChannel extends YjsChannel {
    @volatile var closeHandlers: List[Runnable] = Nil

    override def send(message: Object): Unit                = ()
    override def subscribe(handler: Consumer[Object]): Unit = ()
    override def onClose(handler: Runnable): Unit =
      closeHandlers ::= handler

    def close(): Unit = closeHandlers.foreach(_.run())
  }

  private def connect(): (TestProbe, FakeChannel, ActorRef) = {
    val controller = TestProbe()
    val decoder = new BinaryDecoder[ByteBuffer] {
      override def decode(
        bytes: ByteBuffer
      ): Either[DecodingFailure, ByteBuffer] = Right(bytes)
    }
    // The polyglot context is only used to convert inbound messages.
    val callbacks =
      new BinaryYdocServer.BinaryServerCallbacks[ByteBuffer, ByteBuffer](
        decoder,
        BinaryEncoder.empty,
        new ProbeControllerFactory(controller),
        List.empty,
        null,
        system
      )
    val channel = new FakeChannel
    callbacks.onConnect(channel)
    val established = controller.expectMsgType[OutboundStreamEstablished]
    (controller, channel, established.outboundChannel)
  }

  "BinaryYdocServer" should {

    "end the session when its channel closes" in {
      val (controller, channel, outgoing) = connect()
      val watcher                         = TestProbe()
      watcher.watch(outgoing)

      channel.close()

      controller.expectMsg(ConnectionClosed)
      watcher.expectTerminated(outgoing)
    }

    "end the session only once when its channel reports closing twice" in {
      val (controller, channel, _) = connect()

      channel.close()
      channel.close()

      controller.expectMsg(ConnectionClosed)
      controller.expectNoMessage(200.millis)
    }

    "keep the session while its channel is open" in {
      val (controller, _, outgoing) = connect()
      val watcher                   = TestProbe()
      watcher.watch(outgoing)

      controller.expectNoMessage(200.millis)
      watcher.expectNoMessage(200.millis)
    }
  }
}
