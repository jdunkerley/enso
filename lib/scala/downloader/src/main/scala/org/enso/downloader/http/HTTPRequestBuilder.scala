package org.enso.downloader.http

import java.net.URI
import java.net.http.HttpRequest
import java.nio.file.Path
import java.time.Duration
import java.util.{UUID}
import scala.jdk.CollectionConverters._

/** A simple immutable builder for HTTP requests.
  *
  * It contains very limited functionality that is needed by the APIs used for
  * downloads and uploads (the version managers, the edition updater, the library uploader). It
  * can be easily extended if necessary.
  */
case class HTTPRequestBuilder private (
  uri: URI,
  headers: Vector[(String, String)],
  internalBuilder: HttpRequest.Builder,
  responseTimeout: Duration
) {

  /** Builds a GET request with the specified settings.
    *
    * It fails if no response arrives within the response timeout (Note [A
    * Download Waits For An Answer Only So Long] in [[HTTPDownload]]).
    */
  def GET: HTTPRequest = {
    HTTPRequest(
      withHeaders().GET().timeout(responseTimeout).build()
    )
  }

  /** Sets how long a GET request waits for the response to start; the default
    * is [[HTTPRequestBuilder.DefaultResponseTimeout]].
    */
  def withResponseTimeout(timeout: Duration): HTTPRequestBuilder =
    copy(responseTimeout = timeout)

  /** Adds an additional header that will be included in the request.
    *
    * @param name name of the header
    * @param value the header value
    */
  def addHeader(name: String, value: String): HTTPRequestBuilder =
    copy(headers = headers.appended((name, value)))

  /** Adds multipart form data into `Content-Type: multipart/form-data`
    * @param data
    * @return
    */
  def postFiles(files: Seq[Path]): HTTPRequestBuilder = {
    val boundary = UUID.randomUUID().toString.replace("-", "")
    val bodyPublisher =
      FilesMultipartBodyPublisher.ofMimeMultipartData(files.asJava, boundary)
    internalBuilder.setHeader(
      "Content-Type",
      "multipart/form-data; boundary=" + boundary
    )
    copy(
      internalBuilder = internalBuilder.POST(bodyPublisher)
    )
  }

  def build(): HTTPRequest =
    HTTPRequest(withHeaders().build())

  /** A copy of the underlying builder with the added headers, so building does
    * not change this builder (and building twice does not repeat the headers).
    */
  private def withHeaders(): HttpRequest.Builder = {
    val builder = internalBuilder.copy()
    headers.foreach { case (name, value) =>
      builder.header(name, value)
    }
    builder
  }
}

object HTTPRequestBuilder {

  /** How long a GET request waits for the server to start answering (the
    * response headers; the body may take longer).
    */
  val DefaultResponseTimeout: Duration = Duration.ofSeconds(30)

  /** Creates a request builder that will send the request for the given URI.
    */
  def fromURI(uri: URI): HTTPRequestBuilder = {
    new HTTPRequestBuilder(
      uri,
      Vector.empty,
      HttpRequest.newBuilder(uri),
      DefaultResponseTimeout
    )
  }

  /** Tries to parse the URI provided as a [[String]] and returns a request
    * builder that will send the request to the given `uri`.
    */
  def fromURIString(uri: String): HTTPRequestBuilder =
    fromURI(URIBuilder.fromUri(uri).build())
}
