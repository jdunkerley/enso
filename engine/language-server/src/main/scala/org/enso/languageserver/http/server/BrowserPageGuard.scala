package org.enso.languageserver.http.server

import akka.http.scaladsl.model.{HttpRequest, StatusCodes}
import akka.http.scaladsl.server.{Directive, Directive0}
import akka.http.scaladsl.server.Directives._
import com.typesafe.scalalogging.LazyLogging

/** Refuses requests that a web page in the user's browser sends to the RPC
  * port. See Note [The RPC Port Refuses Web Pages].
  */
object BrowserPageGuard extends LazyLogging {

  // Note [The RPC Port Refuses Web Pages]
  // =====================================
  // The RPC port binds to loopback, but a web page in the user's own browser
  // can still send requests to it. A cross-site `text/plain` form `POST` is a
  // "simple" request: the browser sends it without a CORS preflight, and the
  // route acts on it even though the page cannot read the answer. So the
  // routes that change state (`/refactoring/renameProject`, `/_idle/reset`)
  // and the `/channel/*` sockets answer `403` to a request that
  //
  // - carries an `Origin` header (a browser sends one on every `POST` and on
  //   every WebSocket handshake, and a page cannot remove or forge it), or
  // - carries `Sec-Fetch-Site` with any value but `none` (`cross-site`,
  //   `same-site`, `same-origin`: a page made the request; `none` is the user
  //   typing a URL, which cannot `POST`).
  //
  // Their legitimate callers are Node processes (the project manager shim's
  // `fetch`, the ydoc host's `ws`), which send neither header. Node's `fetch`
  // does send `Sec-Fetch-Mode: cors`, which is therefore not looked at.

  /** Why `request` looks like it came from a web page, or `None`. */
  def browserPage(request: HttpRequest): Option[String] =
    if (request.headers.exists(_.is("origin"))) Some("an Origin header")
    else
      request.headers
        .find(_.is("sec-fetch-site"))
        .map(_.value.trim)
        .filterNot(_.equalsIgnoreCase("none"))
        .map(site => s"Sec-Fetch-Site: $site")

  /** Completes with `403` a request from a web page, and passes the rest on.
    *
    * A `def`, not a `val`: this object used to be initialised while the native image
    * was built, and a `Directive` held in a field would have landed in the image heap,
    * which Native Image refused for Akka HTTP's classes. (Kept a `def`: no reason to change.)
    */
  def refuseBrowserPages: Directive0 =
    Directive { inner =>
      extractRequest { request =>
        browserPage(request) match {
          case Some(reason) =>
            // Never the query string: a channel socket's holds its token.
            logger.debug(
              s"Refused a request to ${request.uri.path} from a web page: $reason"
            )
            complete(StatusCodes.Forbidden)
          case None => inner(())
        }
      }
    }
}
