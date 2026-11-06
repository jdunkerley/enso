package org.enso.languageserver.monitoring

import akka.actor.ActorRef
import akka.http.scaladsl.model.headers.{HttpOrigin, Origin, RawHeader}
import akka.http.scaladsl.model.{
  ContentTypes,
  HttpEntity,
  HttpRequest,
  StatusCodes
}
import akka.http.scaladsl.testkit.{RouteTestTimeout, ScalatestRouteTest}
import akka.testkit.TestActor.AutoPilot
import akka.testkit.TestProbe
import org.enso.languageserver.event.InitializedEvent
import org.enso.polyglot.runtime.Runtime.Api
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.duration._

/** The rename route refuses web pages (#613). See Note [The RPC Port Refuses
  * Web Pages].
  */
class RenameProjectEndpointSpec
    extends AnyWordSpec
    with Matchers
    with ScalatestRouteTest {

  implicit val timeout: RouteTestTimeout = RouteTestTimeout(25.seconds)

  private val body =
    """{"namespace":"local","oldName":"Old_Name","newName":"New_Name"}"""

  /** The endpoint, and the runtime it asks, which renames successfully. */
  private def endpoint(): (RenameProjectEndpoint, TestProbe) = {
    val runtime = TestProbe()
    runtime.setAutoPilot(new AutoPilot {
      def run(sender: ActorRef, msg: Any): AutoPilot = msg match {
        case Api.Request(id, _: Api.RenameProject) =>
          sender ! Api.Response(
            id,
            Api.ProjectRenamed("Old_Name", "New_Name", "New Name")
          )
          keepRunning
        case _ => keepRunning
      }
    })
    (RenameProjectEndpoint(5.seconds, runtime.ref, system), runtime)
  }

  /** The route answers only once the Language Server is initialised. */
  private def initialise(): Unit = {
    system.actorOf(ReadinessMonitor.props())
    val deadline = 10.seconds.fromNow
    while (!ReadinessMonitor.isReady && deadline.hasTimeLeft()) {
      system.eventStream.publish(InitializedEvent.InitializationFinished)
      Thread.sleep(50)
    }
    ReadinessMonitor.isReady shouldBe true
  }

  /** A cross-site form `POST`: `text/plain`, so the browser sends no preflight. */
  private def formPost(headers: RawHeader*): HttpRequest =
    Post(
      "/refactoring/renameProject",
      HttpEntity(ContentTypes.`text/plain(UTF-8)`, body)
    ).withHeaders(headers.toList)

  "RenameProjectEndpoint" should {
    "rename for a caller without Origin, as the shim's fetch sends it" in {
      initialise()
      val (e, runtime) = endpoint()
      // Node's `fetch` sends `Sec-Fetch-Mode: cors`, but no `Origin` and no
      // `Sec-Fetch-Site`.
      Post(
        "/refactoring/renameProject",
        HttpEntity(ContentTypes.`application/json`, body)
      ).withHeaders(RawHeader("Sec-Fetch-Mode", "cors")) ~> e.route ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String] shouldBe """{"status":"success"}"""
      }
      runtime.expectMsgPF() {
        case Api.Request(
              _,
              Api.RenameProject("local", "Old_Name", "New_Name")
            ) =>
      }
    }

    "refuse a cross-site POST before it reaches the runtime" in {
      initialise()
      val (e, runtime) = endpoint()
      val request = formPost().addHeader(
        Origin(HttpOrigin("https://evil.example"))
      )
      request ~> e.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      runtime.expectNoMessage(200.millis)
    }

    "refuse an opaque Origin" in {
      initialise()
      val (e, runtime) = endpoint()
      formPost(RawHeader("Origin", "null")) ~> e.route ~> check {
        status shouldBe StatusCodes.Forbidden
      }
      runtime.expectNoMessage(200.millis)
    }

    "refuse a request a web page made, by Sec-Fetch-Site" in {
      initialise()
      val (e, runtime) = endpoint()
      for (site <- Seq("cross-site", "same-site", "same-origin")) {
        formPost(RawHeader("Sec-Fetch-Site", site)) ~> e.route ~> check {
          withClue(site)(status shouldBe StatusCodes.Forbidden)
        }
      }
      runtime.expectNoMessage(200.millis)
    }
  }
}
