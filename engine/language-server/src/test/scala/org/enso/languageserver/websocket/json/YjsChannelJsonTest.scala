package org.enso.languageserver.websocket.json

import akka.http.scaladsl.Http
import akka.http.scaladsl.settings.ServerSettings
import io.circe.literal._
import io.circe.parser.parse
import org.enso.jsonrpc.{ClientControllerFactory, YdocJsonRpcServer}
import org.enso.languageserver.http.server.YjsChannelEndpoint
import org.enso.languageserver.protocol.json.JsonRpcProtocolFactory
import org.enso.ydoc.api.YjsChannel

import java.util.UUID
import scala.concurrent.Await
import scala.concurrent.duration._

/** The real JSON-RPC handlers behind the Language Server's channel socket, as
  * the Node ydoc host reaches them: `session/initProtocolConnection` over
  * `/channel/json` is answered by the same controller a direct client gets.
  */
class YjsChannelJsonTest extends BaseServerTest {

  // One factory for the server the base class starts and the one here.
  private lazy val factory: ClientControllerFactory =
    super.clientControllerFactory()
  override def clientControllerFactory(): ClientControllerFactory = factory

  "The json channel socket" must {

    "answer session/initProtocolConnection" in {
      initPackage
      val protocol = new JsonRpcProtocolFactory
      protocol.init()
      val callbacks = new YdocJsonRpcServer.ServerCallbacks(
        protocol,
        factory,
        Nil,
        system
      )
      val endpoint = new YjsChannelEndpoint(
        Some("s3cret"),
        () => Map[String, YjsChannel.Server]("json" -> callbacks)
      )(system)
      val binding = Await.result(
        Http()
          .newServerAt(interface, 0)
          .withSettings(ServerSettings(system).withRemoteAddressAttribute(true))
          .bind(endpoint.route),
        5.seconds
      )
      try {
        val client = new WsTestClient(
          s"ws://$interface:${binding.localAddress.getPort}/channel/json?token=s3cret"
        )
        val clientId = UUID.randomUUID()
        client.send(json"""
          { "jsonrpc": "2.0",
            "method": "session/initProtocolConnection",
            "id": 1,
            "params": { "clientId": $clientId }
          }
          """)
        val response =
          parse(client.expectMessage()).rightValue.asObject.value
        response("id") shouldEqual Some(json"1")
        val result = response("result").value.asObject.value
        result("contentRoots").value.asArray.value should contain(
          json"""{ "id" : $testContentRootId, "type" : "Project" }"""
        )
      } finally {
        val _ = Await.result(binding.unbind(), 5.seconds)
      }
    }
  }
}
