package org.enso.jsonrpc

import akka.actor.{ActorRef, ActorSystem}
import akka.testkit.{TestKit, TestProbe}
import org.enso.ydoc.api.YjsChannel
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpecLike

import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.function.Consumer

import scala.concurrent.duration._

class YdocJsonRpcServerSpec
    extends TestKit(ActorSystem("YdocJsonRpcServerSpec"))
    with AnyWordSpecLike
    with Matchers
    with BeforeAndAfterAll {

  override def afterAll(): Unit = {
    TestKit.shutdownActorSystem(system, verifySystemShutdown = true)
    super.afterAll()
  }

  object EmptyProtocolFactory extends ProtocolFactory {
    private val protocol: Protocol        = Protocol.empty.finalized()
    override def getProtocol(): Protocol  = protocol
    override def init(): Unit             = ()
    override def onMissingMethod(): Error = Errors.MethodNotFound
  }

  /** Hands out `controller` as the client controller of every session. */
  final class ProbeControllerFactory(controller: TestProbe)
      extends ClientControllerFactory {
    override def createClientController(clientId: UUID): ActorRef =
      controller.ref
    override def shutdown(): Unit = ()
  }

  /** Stands in for the Ydoc server's end of a channel: records what the
    * server registers on it, and closes it the way the Ydoc server does.
    */
  final class FakeChannel extends YjsChannel {
    val sent: ConcurrentLinkedQueue[Object]        = new ConcurrentLinkedQueue()
    @volatile var messageHandler: Consumer[Object] = _
    @volatile var closeHandlers: List[Runnable]    = Nil

    override def send(message: Object): Unit = sent.add(message)
    override def subscribe(handler: Consumer[Object]): Unit =
      messageHandler = handler
    override def onClose(handler: Runnable): Unit =
      closeHandlers ::= handler

    def receive(message: String): Unit = messageHandler.accept(message)
    def close(): Unit                  = closeHandlers.foreach(_.run())
  }

  private def connect(): (TestProbe, FakeChannel, ActorRef) = {
    val controller = TestProbe()
    val callbacks = new YdocJsonRpcServer.ServerCallbacks(
      EmptyProtocolFactory,
      new ProbeControllerFactory(controller),
      List.empty,
      system
    )
    val channel = new FakeChannel
    callbacks.onConnect(channel)
    val webConnect = controller.expectMsgType[JsonRpcServer.WebConnect]
    (controller, channel, webConnect.webActor)
  }

  "YdocJsonRpcServer" should {

    "end the session when its channel closes" in {
      val (controller, channel, messageHandler) = connect()
      val watcher                               = TestProbe()
      watcher.watch(messageHandler)

      channel.close()

      controller.expectMsg(MessageHandler.Disconnected())
      watcher.expectTerminated(messageHandler)
    }

    "end the session only once when its channel reports closing twice" in {
      val (controller, channel, _) = connect()

      channel.close()
      channel.close()

      controller.expectMsg(MessageHandler.Disconnected())
      controller.expectNoMessage(200.millis)
    }

    "keep the session while its channel is open" in {
      val (controller, channel, _) = connect()

      channel.receive("""{"jsonrpc": "2.0", "id": 1, "method": "unknown"}""")

      controller.expectNoMessage(200.millis)
      awaitCond(!channel.sent.isEmpty)
      channel.sent.peek().toString should include("Method not found")
    }
  }
}
