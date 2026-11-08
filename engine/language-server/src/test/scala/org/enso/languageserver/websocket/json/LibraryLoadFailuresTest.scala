package org.enso.languageserver.websocket.json

import io.circe.literal._
import org.enso.editions.Editions
import org.enso.polyglot.runtime.Runtime.Api
import org.enso.testkit.ReportLogsOnFailure
import org.scalatest.OptionValues

import scala.concurrent.duration._

class LibraryLoadFailuresTest
    extends BaseServerTest
    with ReportLogsOnFailure
    with OptionValues {

  private val defaultTimeout = 30.seconds

  private def listLoadFailures(client: WsTestClient, id: Int): Unit =
    client.send(json"""
        { "jsonrpc": "2.0",
          "method": "library/listLoadFailures",
          "id": $id
        }
        """)

  "library/listLoadFailures" should {
    "list nothing while every library has loaded" in {
      val client = getInitialisedWsClient()
      listLoadFailures(client, 0)
      client.expectJson(
        json"""
          { "jsonrpc": "2.0",
            "id": 0,
            "result": { "failures": [] }
          }
          """,
        timeout = defaultTimeout
      )
    }

    "notify of and list the libraries the runtime could not load" in {
      val client = getInitialisedWsClient()
      // A round trip, so that the controller has subscribed to the events.
      listLoadFailures(client, 0)
      client.expectJson(
        json"""
          { "jsonrpc": "2.0", "id": 0, "result": { "failures": [] } }
          """,
        timeout = defaultTimeout
      )

      system.eventStream.publish(
        Api.LibraryLoadFailed(
          "Standard",
          "Table",
          Some("0.0.0-dev"),
          Api.LibraryLoadFailed.DownloadFailed,
          "HTTP 502"
        )
      )
      client.expectJson(
        json"""
          { "jsonrpc": "2.0",
            "method": "library/loadFailed",
            "params": {
              "library": "Standard.Table",
              "version": "0.0.0-dev",
              "kind": "DownloadFailed",
              "message": "HTTP 502"
            }
          }
          """,
        timeout = defaultTimeout
      )
      system.eventStream.publish(
        Api.LibraryLoadFailed(
          "Foo",
          "Bar",
          None,
          Api.LibraryLoadFailed.NotInEdition,
          "not defined"
        )
      )
      client.expectSomeJson(timeout = defaultTimeout)

      // A client that connects later gets them from the listing.
      val late = getInitialisedWsClient()
      listLoadFailures(late, 1)
      late.expectJson(
        json"""
          { "jsonrpc": "2.0",
            "id": 1,
            "result": {
              "failures": [
                {
                  "library": "Standard.Table",
                  "version": "0.0.0-dev",
                  "kind": "DownloadFailed",
                  "message": "HTTP 502"
                },
                {
                  "library": "Foo.Bar",
                  "version": null,
                  "kind": "NotInEdition",
                  "message": "not defined"
                }
              ]
            }
          }
          """,
        timeout = defaultTimeout
      )
    }
  }
}

/** A project whose edition is not installed: the listing says so, and the
  * listings that need the edition fall back to the default one.
  */
class LibraryLoadFailuresMissingEditionTest
    extends BaseServerTest
    with ReportLogsOnFailure
    with OptionValues {

  private val defaultTimeout = 30.seconds

  override protected def customEdition: Option[Editions.RawEdition] =
    Some(Editions.Raw.Edition(parent = Some("no-such-edition")))

  "library/listLoadFailures" should {
    "report the missing edition" in {
      val client = getInitialisedWsClient()
      client.send(json"""
          { "jsonrpc": "2.0",
            "method": "library/listLoadFailures",
            "id": 0
          }
          """)
      val response = client.expectSomeJson(timeout = defaultTimeout)
      val failures = response.hcursor
        .downField("result")
        .downField("failures")
        .values
        .value
        .toSeq
      failures should have size 1
      val failure = failures.head.hcursor
      failure.downField("library").focus.value.isNull shouldBe true
      failure.get[String]("version") shouldBe Right("no-such-edition")
      failure.get[String]("kind") shouldBe Right("EditionNotFound")
    }
  }

  "library/listPublicTypes" should {
    "answer from the default edition" in {
      val client = getInitialisedWsClient()
      client.send(json"""
          { "jsonrpc": "2.0",
            "method": "library/listPublicTypes",
            "id": 0
          }
          """)
      val response = client.expectSomeJson(timeout = defaultTimeout)
      response.hcursor
        .downField("result")
        .downField("publicTypes")
        .focus
        .value
        .isArray shouldBe true
    }
  }
}
