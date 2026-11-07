package org.enso.languageserver.http.server

import akka.http.scaladsl.model.{AttributeKeys, RemoteAddress, StatusCodes}
import akka.http.scaladsl.model.headers.{
  `X-Forwarded-For`,
  HttpOrigin,
  Origin,
  RawHeader
}
import akka.stream.scaladsl.{Flow, Sink, Source}
import akka.http.scaladsl.model.ws.Message
import akka.http.scaladsl.model.ws.BinaryMessage
import akka.http.scaladsl.testkit.{ScalatestRouteTest, WSProbe}
import akka.util.ByteString
import org.enso.ydoc.api.YjsChannel
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.net.InetAddress
import java.nio.ByteBuffer
import java.util.concurrent.{LinkedBlockingQueue, TimeUnit}

class YjsChannelEndpointSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest {

  private def peer(host: String): RemoteAddress =
    RemoteAddress(InetAddress.getByName(host), Some(40000))

  /** A handshake as the HTTP server sees it from a loopback peer. */
  private def loopbackWS(uri: String, flow: Flow[Message, Message, Any]) =
    WS(uri, flow).addAttribute(AttributeKeys.remoteAddress, peer("127.0.0.1"))

  private def endpoint(
    token: Option[String],
    outgoingBufferSize: Int                    = 10000,
    maxPending: Int                            = 1024,
    onConnect: Map[String, YjsChannel => Unit] = Map.empty
  ) = {
    val connected = YjsChannelEndpoint.Kinds
      .map(_ -> new LinkedBlockingQueue[YjsChannel]())
      .toMap
    val servers: Map[String, YjsChannel.Server] =
      connected.map { case (kind, queue) =>
        val server: YjsChannel.Server = (c: YjsChannel) => {
          onConnect.get(kind).foreach(_(c))
          queue.add(c)
          ()
        }
        kind -> server
      }
    (
      new YjsChannelEndpoint(
        token,
        () => servers,
        outgoingBufferSize,
        maxPending
      ),
      connected
    )
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
        loopbackWS(s"/channel/$kind?token=t0k", ws.flow) ~> e.route ~> check {
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
      loopbackWS("/channel/binary?token=t0k", ws.flow) ~> e.route ~> check {
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
      loopbackWS("/channel/json?token=t0k", ws.flow) ~> e.route ~> check {
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
      loopbackWS("/channel/vis-data?token=t0k", ws.flow) ~> e.route ~> check {
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
        loopbackWS(s"/channel/json$query", WSProbe().flow) ~> e.route ~> check {
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
      loopbackWS("/channel/json", WSProbe().flow) ~> open.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
    }

    "accept two concurrent json sockets with the same token and keep them apart" in {
      // A session opens a proxy channel for the GUI and a backend channel for
      // the ydoc server, both of kind json.
      val (e, connected) = endpoint(Some("t0k"))
      val proxyWs        = WSProbe()
      val backendWs      = WSProbe()
      loopbackWS("/channel/json?token=t0k", proxyWs.flow) ~> e.route ~> check {
        val proxy = poll(connected("json"))
        loopbackWS(
          "/channel/json?token=t0k",
          backendWs.flow
        ) ~> e.route ~> check {
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

    "refuse a peer that is not on loopback, however it presents itself" in {
      val (e, connected) = endpoint(Some("t0k"))
      val uri            = "/channel/json?token=t0k"
      WS(uri, WSProbe().flow).addAttribute(
        AttributeKeys.remoteAddress,
        peer("192.0.2.7")
      ) ~> e.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      // The client controls X-Forwarded-For; only the connection's own
      // address counts.
      WS(uri, WSProbe().flow)
        .addAttribute(AttributeKeys.remoteAddress, peer("192.0.2.7"))
        .addHeader(
          `X-Forwarded-For`(RemoteAddress(InetAddress.getByName("127.0.0.1")))
        ) ~> e.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      // No address at all: refuse.
      WS(uri, WSProbe().flow) ~> e.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      connected("json").isEmpty shouldBe true
    }

    "refuse a handshake that carries an Origin header" in {
      val (e, connected) = endpoint(Some("t0k"))
      loopbackWS("/channel/json?token=t0k", WSProbe().flow)
        .addHeader(
          Origin(HttpOrigin("http://localhost:5173"))
        ) ~> e.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      connected("json").isEmpty shouldBe true
    }

    "refuse a handshake that a web page made, by Sec-Fetch-Site (#613)" in {
      val (e, connected) = endpoint(Some("t0k"))
      loopbackWS("/channel/json?token=t0k", WSProbe().flow)
        .addHeader(
          RawHeader("Sec-Fetch-Site", "cross-site")
        ) ~> e.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      connected("json").isEmpty shouldBe true
    }

    "treat a blank configured token as none" in {
      val (e, _) = endpoint(Some(""))
      for (query <- Seq("", "?token=")) {
        loopbackWS(s"/channel/json$query", WSProbe().flow) ~> e.route ~> check {
          status shouldBe StatusCodes.Forbidden
        }
      }
    }

    "keep a bounded, ordered backlog for a handler that subscribes late" in {
      val (e, connected) = endpoint(Some("t0k"), maxPending = 3)
      val ws             = WSProbe()
      loopbackWS("/channel/vis-data?token=t0k", ws.flow) ~> e.route ~> check {
        val channel = poll(connected("vis-data"))
        for (i <- 1 to 5) ws.sendMessage(s"m$i")
        // Let the frames reach the channel before subscribing.
        Thread.sleep(500)
        val received = new LinkedBlockingQueue[Object]()
        channel.subscribe(m => { received.add(m); () })
        Seq(poll(received), poll(received), poll(received)) shouldBe
        Seq("m3", "m4", "m5")
        ws.sendMessage("live")
        poll(received) shouldBe "live"
        received.poll(200, TimeUnit.MILLISECONDS) shouldBe null
        ws.sendCompletion()
      }
    }

    "close the channel when its outgoing buffer overflows" in {
      val (e, connected) = endpoint(Some("t0k"), outgoingBufferSize = 1)
      val ws             = WSProbe()
      loopbackWS("/channel/json?token=t0k", ws.flow) ~> e.route ~> check {
        val channel = poll(connected("json"))
        val closes  = new LinkedBlockingQueue[String]()
        channel.onClose(() => closes.add("closed"))
        // The probe does not ask for frames, so the buffer fills.
        for (i <- 1 to 50) channel.send(s"out$i")
        poll(closes) shouldBe "closed"
      }
    }

    "close the channel when the client's stream fails" in {
      val (e, connected) = endpoint(Some("t0k"))
      val failing: Flow[Message, Message, Any] =
        Flow.fromSinkAndSource(
          Sink.ignore,
          Source.failed[Message](new RuntimeException("boom"))
        )
      loopbackWS("/channel/json?token=t0k", failing) ~> e.route ~> check {
        val channel = poll(connected("json"))
        val closes  = new LinkedBlockingQueue[String]()
        channel.onClose(() => closes.add("closed"))
        poll(closes) shouldBe "closed"
        closes.poll(300, TimeUnit.MILLISECONDS) shouldBe null
      }
    }

    "run the close handlers of a server whose onConnect throws" in {
      val closes = new LinkedBlockingQueue[String]()
      val (e, _) = endpoint(
        Some("t0k"),
        onConnect = Map("json" -> { c =>
          c.onClose(() => closes.add("closed"))
          throw new IllegalStateException("no")
        })
      )
      loopbackWS(
        "/channel/json?token=t0k",
        WSProbe().flow
      ) ~> e.route ~> check {
        poll(closes) shouldBe "closed"
      }
    }

    "answer 404 for an unknown kind" in {
      val (e, _) = endpoint(Some("t0k"))
      loopbackWS(
        "/channel/other?token=t0k",
        WSProbe().flow
      ) ~> e.route ~> check {
        status shouldBe StatusCodes.NotFound
      }
    }
  }
}
