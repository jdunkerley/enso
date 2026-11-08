package org.enso.languageserver.monitoring

import akka.actor.ActorRef
import akka.http.scaladsl.model.StatusCodes
import akka.http.scaladsl.model.headers.{HttpOrigin, Origin, RawHeader}
import akka.http.scaladsl.server.Directives
import akka.http.scaladsl.testkit.{RouteTestTimeout, ScalatestRouteTest}
import org.enso.languageserver.TestClock
import org.enso.testkit.{FlakySpec, ReportLogsOnFailure}
import org.scalatest.flatspec.AnyFlatSpecLike
import org.scalatest.matchers.should.Matchers

import scala.concurrent.duration._

class IdlenessEndpointSpec
    extends AnyFlatSpecLike
    with Matchers
    with FlakySpec
    with ScalatestRouteTest
    with Directives
    with ReportLogsOnFailure {

  implicit val timeout: RouteTestTimeout = RouteTestTimeout(25.seconds)

  "An idleness probe" should "reply with server idle time" in withEndpoint {
    (_, _, endpoint) =>
      Get("/_idle") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
        responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
      }
  }

  it should "count idle time" in withEndpoint { (clock, _, endpoint) =>
    Get("/_idle") ~> endpoint.route ~> check {
      status shouldEqual StatusCodes.OK
      responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
    }

    val idleTimeSeconds = 1L
    clock.moveTimeForward(idleTimeSeconds)
    Get("/_idle") ~> endpoint.route ~> check {
      status shouldEqual StatusCodes.OK
      responseAs[String] shouldEqual s"""{"idle_time_sec":$idleTimeSeconds}"""
    }
  }

  it should "reset idle time with internal message" in withEndpoint {
    (clock, monitor, endpoint) =>
      Get("/_idle") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
        responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
      }

      val idleTimeSeconds = 1L
      clock.moveTimeForward(idleTimeSeconds)
      Get("/_idle") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
        responseAs[String] shouldEqual s"""{"idle_time_sec":$idleTimeSeconds}"""
      }

      monitor ! MonitoringProtocol.ResetIdleTimeCommand
      Get("/_idle") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
        responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
      }
  }

  it should "reset idle time with endpoint" in withEndpoint {
    (clock, _, endpoint) =>
      Get("/_idle") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
        responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
      }

      val idleTimeSeconds = 1L
      clock.moveTimeForward(idleTimeSeconds)
      Get("/_idle") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
        responseAs[String] shouldEqual s"""{"idle_time_sec":$idleTimeSeconds}"""
      }

      Post("/_idle/reset") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
      }
      Get("/_idle") ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
        responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
      }
  }

  it should "refuse a reset from a web page (#613)" in withEndpoint {
    (clock, _, endpoint) =>
      idleFor(clock, endpoint, 1L)
      Post("/_idle/reset").addHeader(
        Origin(HttpOrigin("https://evil.example"))
      ) ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.Forbidden
      }
      Post("/_idle/reset").addHeader(
        RawHeader("Sec-Fetch-Site", "cross-site")
      ) ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.Forbidden
      }
      Get("/_idle") ~> endpoint.route ~> check {
        responseAs[String] shouldEqual s"""{"idle_time_sec":1}"""
      }
  }

  it should "reset for a caller without Origin, as Node's fetch sends it" in withEndpoint {
    (clock, _, endpoint) =>
      idleFor(clock, endpoint, 1L)
      Post("/_idle/reset").addHeader(
        RawHeader("Sec-Fetch-Mode", "cors")
      ) ~> endpoint.route ~> check {
        status shouldEqual StatusCodes.OK
      }
      Get("/_idle") ~> endpoint.route ~> check {
        responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
      }
  }

  /** Let the monitor start, then move its clock on by `seconds`. */
  private def idleFor(
    clock: TestClock,
    endpoint: IdlenessEndpoint,
    seconds: Long
  ): Unit = {
    Get("/_idle") ~> endpoint.route ~> check {
      responseAs[String] shouldEqual s"""{"idle_time_sec":0}"""
    }
    clock.moveTimeForward(seconds)
    Get("/_idle") ~> endpoint.route ~> check {
      responseAs[String] shouldEqual s"""{"idle_time_sec":$seconds}"""
    }
  }

  def withEndpoint(
    test: (TestClock, ActorRef, IdlenessEndpoint) => Any
  ): Unit = {
    val clock           = TestClock()
    val idlenessMonitor = system.actorOf(IdlenessMonitor.props(clock))
    val endpoint        = new IdlenessEndpoint(idlenessMonitor)

    test(clock, idlenessMonitor, endpoint)
  }

}
