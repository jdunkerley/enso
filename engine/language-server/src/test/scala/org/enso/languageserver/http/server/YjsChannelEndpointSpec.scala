package org.enso.languageserver.http.server

import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.ws.BinaryMessage
import akka.http.scaladsl.testkit.{ScalatestRouteTest, WSProbe}
import akka.util.ByteString
import org.enso.ydoc.api.YjsChannel
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.nio.ByteBuffer
import java.util.concurrent.{LinkedBlockingQueue, TimeUnit}

class YjsChannelEndpointSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest {

  private def endpoint(token: Option[String]) = {
    val connected = YjsChannelEndpoint.Kinds
      .map(_ -> new LinkedBlockingQueue[YjsChannel]())
      .toMap
    val servers: Map[String, YjsChannel.Server] =
      connected.map { case (kind, queue) =>
        val server: YjsChannel.Server = (c: YjsChannel) => { queue.add(c); () }
        kind -> server
      }
    (new YjsChannelEndpoint(token, () => servers), connected)
  }

  private def poll[A <: AnyRef](q: LinkedBlockingQueue[A]): A = {
    val a = q.poll(5, TimeUnit.SECONDS)
    a should not be null
    a
  }

  "YjsChannelEndpoint" should {
    "hand each kind's socket to its server, text both ways" in {
      val (e, connected) = endpoint(Some("t0k"))
      for (kind <- Seq("json", "vis-control")) {
        val ws = WSProbe()
        WS(s"/channel/$kind?token=t0k", ws.flow) ~> e.route ~> check {
          isWebSocketUpgrade shouldBe true
          val channel  = poll(connected(kind))
          val received = new LinkedBlockingQueue[Object]()
          ws.sendMessage("before subscribe")
          channel.subscribe(m => { received.add(m); () })
          poll(received) shouldBe "before subscribe"
          channel.send("to ydoc")
          ws.expectMessage("to ydoc")
          ws.sendCompletion()
        }
      }
    }

    "carry binary frames as ByteBuffers" in {
      val (e, connected) = endpoint(Some("t0k"))
      val ws             = WSProbe()
      WS("/channel/binary?token=t0k", ws.flow) ~> e.route ~> check {
        val channel  = poll(connected("binary"))
        val received = new LinkedBlockingQueue[Object]()
        channel.subscribe(m => { received.add(m); () })
        ws.sendMessage(BinaryMessage(ByteString(1, 2, 3)))
        val got   = poll(received).asInstanceOf[ByteBuffer]
        val bytes = new Array[Byte](got.remaining())
        got.get(bytes)
        bytes.toSeq shouldBe Seq[Byte](1, 2, 3)
        channel.send(ByteBuffer.wrap(Array[Byte](4, 5)))
        ws.expectMessage(ByteString(4, 5))
        ws.sendCompletion()
      }
    }

    "refuse to send anything but a String or a ByteBuffer" in {
      val (e, connected) = endpoint(Some("t0k"))
      val ws             = WSProbe()
      WS("/channel/json?token=t0k", ws.flow) ~> e.route ~> check {
        val channel = poll(connected("json"))
        an[IllegalArgumentException] should be thrownBy channel.send(
          Integer.valueOf(1)
        )
        ws.sendCompletion()
      }
    }

    "run onClose once when the socket closes" in {
      val (e, connected) = endpoint(Some("t0k"))
      val ws             = WSProbe()
      WS("/channel/vis-data?token=t0k", ws.flow) ~> e.route ~> check {
        val channel = poll(connected("vis-data"))
        val closes  = new LinkedBlockingQueue[String]()
        channel.onClose(() => closes.add("closed"))
        ws.sendCompletion()
        poll(closes) shouldBe "closed"
        closes.poll(500, TimeUnit.MILLISECONDS) shouldBe null
        val late = new LinkedBlockingQueue[String]()
        channel.onClose(() => late.add("late"))
        late.poll(0, TimeUnit.MILLISECONDS) shouldBe "late"
      }
    }

    "refuse a socket without the token, with a wrong one, or when none is configured" in {
      val (e, _) = endpoint(Some("t0k"))
      for (query <- Seq("", "?token=nope", "?token=")) {
        WS(s"/channel/json$query", WSProbe().flow) ~> e.route ~> check {
          status shouldBe StatusCodes.Forbidden
        }
      }
      val (open, _) = endpoint(None)
      WS(
        "/channel/json?token=anything",
        WSProbe().flow
      ) ~> open.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      WS("/channel/json", WSProbe().flow) ~> open.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "accept two concurrent json sockets with the same token and keep them apart" in {
      // A session opens a proxy channel for the GUI and a backend channel for
      // the ydoc server, both of kind json.
      val (e, connected) = endpoint(Some("t0k"))
      val proxyWs        = WSProbe()
      val backendWs      = WSProbe()
      WS("/channel/json?token=t0k", proxyWs.flow) ~> e.route ~> check {
        val proxy = poll(connected("json"))
        WS("/channel/json?token=t0k", backendWs.flow) ~> e.route ~> check {
          val backend = poll(connected("json"))
          (proxy eq backend) shouldBe false
          val proxyIn   = new LinkedBlockingQueue[Object]()
          val backendIn = new LinkedBlockingQueue[Object]()
          proxy.subscribe(m => { proxyIn.add(m); () })
          backend.subscribe(m => { backendIn.add(m); () })

          proxyWs.sendMessage("from proxy")
          backendWs.sendMessage("from backend")
          poll(proxyIn) shouldBe "from proxy"
          poll(backendIn) shouldBe "from backend"
          proxy.send("to proxy")
          backend.send("to backend")
          proxyWs.expectMessage("to proxy")
          backendWs.expectMessage("to backend")

          // Closing one socket ends only its channel.
          val closes = new LinkedBlockingQueue[String]()
          proxy.onClose(() => closes.add("proxy"))
          backend.onClose(() => closes.add("backend"))
          backendWs.sendCompletion()
          poll(closes) shouldBe "backend"
          closes.poll(300, TimeUnit.MILLISECONDS) shouldBe null
          proxyWs.sendMessage("still open")
          poll(proxyIn) shouldBe "still open"
          proxyWs.sendCompletion()
        }
      }
    }

    "answer 404 for an unknown kind" in {
      val (e, _) = endpoint(Some("t0k"))
      WS("/channel/other?token=t0k", WSProbe().flow) ~> e.route ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
