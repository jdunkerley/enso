package org.enso.languageserver.websocket.json

import io.circe.Json
import io.circe.literal._
import org.enso.editions.{Editions, LibraryName}
import org.enso.polyglot.runtime.Runtime.Api
import org.enso.semver.SemVer
import org.enso.testkit.ReportLogsOnFailure
import org.enso.version.BuildVersion
import org.scalatest.OptionValues

import scala.concurrent.duration._

/** Shared helpers of the `editions/checkSwitch` tests. */
trait CheckSwitchHelpers { self: BaseServerTest =>
  val defaultTimeout: FiniteDuration = 30.seconds

  def checkSwitch(client: WsTestClient): Json = {
    client.send(json"""
        { "jsonrpc": "2.0",
          "method": "editions/checkSwitch",
          "id": 0,
          "params": {}
        }
        """)
    val response = client.expectSomeJson(timeout = defaultTimeout)
    response.hcursor.downField("result").focus.getOrElse(
      throw new AssertionError(s"No result in $response")
    )
  }
}

class EditionsCheckSwitchTest
    extends BaseServerTest
    with CheckSwitchHelpers
    with ReportLogsOnFailure
    with OptionValues {

  "editions/checkSwitch" should {
    "say that a project on the bundled edition resolves" in {
      val client = getInitialisedWsClient()
      checkSwitch(client) shouldEqual json"""
        { "current": ${BuildVersion.currentEdition},
          "target": ${BuildVersion.currentEdition},
          "resolves": true,
          "changes": [],
          "stillMissing": []
        }
        """
    }

    "list a failed library that the edition does not define as missing" in {
      val client = getInitialisedWsClient()
      // A round trip, so that the collector has subscribed to the events.
      checkSwitch(client)
      system.eventStream.publish(
        Api.LibraryLoadFailed(
          "Foo",
          "Bar",
          None,
          Api.LibraryLoadFailed.NotInEdition,
          "not defined"
        )
      )
      client.expectSomeJson(timeout = defaultTimeout) // library/loadFailed
      val result = checkSwitch(client)
      result.hcursor.get[Boolean]("resolves") shouldBe Right(false)
      result.hcursor.get[Seq[String]]("stillMissing") shouldBe Right(
        Seq("Foo.Bar")
      )
    }
  }
}

/** A project whose edition is not installed: the bundled edition fixes it. */
class EditionsCheckSwitchMissingEditionTest
    extends BaseServerTest
    with CheckSwitchHelpers
    with ReportLogsOnFailure {

  override protected def customEdition: Option[Editions.RawEdition] =
    Some(Editions.Raw.Edition(parent = Some("no-such-edition")))

  "editions/checkSwitch" should {
    "offer the bundled edition, with the versions it brings" in {
      val client = getInitialisedWsClient()
      checkSwitch(client) shouldEqual json"""
        { "current": "no-such-edition",
          "target": ${BuildVersion.currentEdition},
          "resolves": true,
          "changes": [
            { "library": "Standard.Base",
              "from": null,
              "to": ${BuildVersion.currentEdition}
            }
          ],
          "stillMissing": []
        }
        """
    }
  }
}

/** A project that pins `Standard.Base` itself: switching the parent keeps the
  * pin, so it does not help.
  */
class EditionsCheckSwitchPinnedLibraryTest
    extends BaseServerTest
    with CheckSwitchHelpers
    with ReportLogsOnFailure {

  override protected def customEdition: Option[Editions.RawEdition] =
    Some(
      Editions.Raw.Edition.make(
        parent       = Some("no-such-edition"),
        repositories = Seq(Editions.Repository("pinned", "http://localhost:1/")),
        libraries = Seq(
          Editions.Raw.PublishedLibrary(
            LibraryName("Standard", "Base"),
            SemVer.of(9, 9, 9),
            "pinned"
          )
        )
      )
    )

  "editions/checkSwitch" should {
    "keep the project's own library versions" in {
      val client = getInitialisedWsClient()
      val result = checkSwitch(client)
      result.hcursor.get[Boolean]("resolves") shouldBe Right(false)
      result.hcursor.get[Seq[String]]("stillMissing") shouldBe Right(
        Seq("Standard.Base")
      )
    }
  }
}
