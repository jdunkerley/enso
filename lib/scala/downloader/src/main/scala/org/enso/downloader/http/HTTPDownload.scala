package org.enso.downloader.http

import com.typesafe.scalalogging.Logger
import org.enso.cli.task.{
  ProgressUnit,
  TaskProgress,
  TaskProgressImplementation
}

import java.net.URI
import java.net.http.{
  HttpClient,
  HttpConnectTimeoutException,
  HttpHeaders,
  HttpResponse,
  HttpTimeoutException
}
import java.nio.charset.{Charset, StandardCharsets}
import java.nio.file.{Files, Path}
import java.time.Duration
import java.util.concurrent.{
  CompletableFuture,
  CompletionException,
  ConcurrentHashMap,
  Executors
}
import scala.util.{Failure, Success}

/** Contains utility functions for fetching data using the HTTP(S) protocol. */
object HTTPDownload {
  private val logger = Logger[HTTPDownload.type]

  /** Determines how many redirects are taken until an error is thrown. */
  val maximumRedirects: Int = 20

  /* Note [A Download Waits For An Answer Only So Long]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * `HttpClient` waits forever by default, both to connect and for an answer.
   * A library repository that accepts the connection and never answers then
   * blocks the import that resolves the library, so the project's first
   * execution never ends: the Language Server reports neither the failure nor
   * completion, and the IDE says "Initializing the project" for good (#600).
   * So the client gives up connecting after [[ConnectTimeout]], and a GET
   * request gives up waiting for the response to start after its response
   * timeout ([[HTTPRequestBuilder.DefaultResponseTimeout]]). The failure then
   * reaches the user like any other failed download: the import's error names
   * the library and says the server did not respond. The response timeout
   * covers only the wait for the response headers, so a large download whose
   * body takes longer is not cut short. A POST (a library upload) has none,
   * since its answer comes only after the whole body is sent.
   *
   * The JDK's request timeout does not cover the body either, so a server that
   * sends the headers and then goes quiet would still hang the download for
   * good (#637). So the body has an idle timeout, [[BodyIdleTimeout]]: no
   * bytes for that long and the download is aborted, the connection closed.
   * It is idle, not total, so a slow but steady download is never cut short.
   * It does not make the host "unresponsive" (Note [An Unresponsive Server Is
   * Not Asked Again At Once]): the server did answer, and a stalled transfer
   * says little about the next request.
   */

  /** How long a request waits for the connection to the server. */
  val ConnectTimeout: Duration = Duration.ofSeconds(30)

  /** How long the body of a response may go without a single byte. */
  val BodyIdleTimeout: Duration = Duration.ofSeconds(30)

  /** [[BodyIdleTimeout]], unless a test shortens it. */
  @volatile private[http] var bodyIdleTimeout: Duration = BodyIdleTimeout

  /* Note [An Unresponsive Server Is Not Asked Again At Once]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * Resolving a project's imports asks the repository for one library after
   * another, and the first execution asks again for those that failed. With a
   * server that does not answer, each of those requests would wait for the
   * whole timeout (measured: 96 s before a project importing two libraries
   * said why it could not start). So a server that timed out is remembered for
   * [[UnresponsiveServerMemory]]: a request to it in that time fails at once,
   * saying that the server did not respond to an earlier request. Any answer
   * from the server forgets it, and so does the end of that time, so a server
   * that comes back is asked again. The message says how long until then.
   *
   * Two consequences to keep in mind before changing a timeout:
   * - A server that is alive but slow, taking longer than the response
   *   timeout to answer one request, blocks every request to its host for the
   *   whole [[UnresponsiveServerMemory]], although it would have answered. So
   *   the response timeout also decides when a host is shut out.
   * - The key is the host of the URL that was requested. `HttpClient` follows
   *   redirects itself and a timeout exception does not say which URL timed
   *   out, so when a request is redirected to another host that stalls (a
   *   GitHub release asset served from `objects.githubusercontent.com`, say),
   *   it is the original host that is remembered and named in the message.
   *   Keying on the final host would mean following redirects by hand; library
   *   repositories, the case of #600, do not redirect.
   */

  /** How long a server that timed out is not asked again. */
  val UnresponsiveServerMemory: Duration = Duration.ofMinutes(2)

  /** [[UnresponsiveServerMemory]], unless a test shortens it. */
  @volatile private[http] var unresponsiveServerMemory: Duration =
    UnresponsiveServerMemory

  /** A server that timed out: when, and how long the request had waited. */
  private case class Unresponsive(sinceNanos: Long, waited: String)

  /** Servers that timed out, by scheme and authority. */
  private val unresponsiveServers =
    new ConcurrentHashMap[String, Unresponsive]()

  /** Forgets the servers that timed out; for tests. */
  private[http] def forgetUnresponsiveServers(): Unit =
    unresponsiveServers.clear()

  private def serverOf(request: HTTPRequest): String = {
    val uri = request.requestImpl.uri()
    s"${uri.getScheme}://${uri.getRawAuthority}"
  }

  /** Fetches the `request` and tries to decode is as a [[String]].
    *
    * The request is executed in a separate thread. A [[TaskProgress]] instance
    * is returned immediately which can be used to track progress of the
    * download. The result contains the decoded response and included headers.
    *
    * Handles redirects, but will return an error if the amount of redirects
    * exceeds [[maximumRedirects]].
    *
    * @param request the request to send
    * @param sizeHint an optional hint indicating the expected size of the
    *                 response. It is used if the response does not include
    *                 explicit Content-Length header.
    * @param encoding the encoding used to decode the response content into a
    *                 string. By default, UTF-8 is used.
    * @return a [[TaskProgress]] that tracks progress of the download and can
    *         be used to get the final result
    */
  def fetchString(
    request: HTTPRequest,
    sizeHint: Option[Long] = None,
    encoding: Charset      = StandardCharsets.UTF_8
  ): TaskProgress[APIResponse] = {
    logger.debug("Fetching [{} {}].", request.method, request.uri)
    val taskProgress =
      new TaskProgressImplementation[APIResponse](ProgressUnit.Bytes)
    val total: java.lang.Long = if (sizeHint.isDefined) sizeHint.get else null
    val bodyHandler =
      StringProgressBodyHandler.of(taskProgress, total, encoding)
    asyncDownload(request, bodyHandler)
      .thenAccept(res => {
        if (res.statusCode() == 404) {
          taskProgress.setComplete(Failure(ResourceNotFound()))
        } else {
          taskProgress.setComplete(
            Success(
              APIResponse(
                res.body(),
                convertHeaders(res.headers()),
                res.statusCode()
              )
            )
          )
        }
      })
      .exceptionally(ex => {
        taskProgress.setComplete(Failure(describeFailure(request, ex)))
        null
      })
    taskProgress
  }

  private def asyncDownload[T](
    request: HTTPRequest,
    bodyHandler: HttpResponse.BodyHandler[T]
  ): CompletableFuture[HttpResponse[T]] = {
    // Note [An Unresponsive Server Is Not Asked Again At Once]
    val server = serverOf(request)
    val remembered = Option(unresponsiveServers.get(server)).filter { u =>
      System.nanoTime() - u.sinceNanos < unresponsiveServerMemory.toNanos
    }
    remembered match {
      case Some(unresponsive) =>
        logger.debug(
          "Not requesting [{}]: [{}] did not respond to an earlier request.",
          request.uri,
          server
        )
        CompletableFuture.failedFuture(
          HTTPException(
            s"The server at [$server] did not respond within " +
            s"${unresponsive.waited}; it will be asked again in about " +
            s"${secondsUntilRetry(unresponsive)} s."
          )
        )
      case None =>
        val vThreadExecutor = Executors.newVirtualThreadPerTaskExecutor()
        val httpClient = HttpClient
          .newBuilder()
          .followRedirects(HttpClient.Redirect.NORMAL)
          .connectTimeout(ConnectTimeout)
          .executor(vThreadExecutor)
          .build()
        val idleHandler = IdleTimeoutBodyHandler.of(
          bodyHandler,
          bodyIdleTimeout,
          s"The download from [${request.uri}] stalled: no data arrived " +
          s"for ${describeDuration(bodyIdleTimeout)}."
        )
        httpClient
          .sendAsync(request.requestImpl, idleHandler)
          .whenComplete { (_, failure) =>
            if (failure == null) unresponsiveServers.remove(server)
            else
              timeoutWaited(request, failure).foreach { waited =>
                unresponsiveServers.put(
                  server,
                  Unresponsive(System.nanoTime(), waited)
                )
              }
          }
          .handle[HttpResponse[T]] { (response, failure) =>
            // Closing a stalled connection makes the client fail with an
            // error of its own; the stall is the cause worth reporting.
            val stalled = idleHandler.stalled()
            if (stalled != null) throw stalled
            else if (failure != null) throw failure
            else response
          }
    }
  }

  private def secondsUntilRetry(unresponsive: Unresponsive): Long = {
    val left = unresponsiveServerMemory.toNanos -
      (System.nanoTime() - unresponsive.sinceNanos)
    Math.max(1L, Math.ceil(left / 1e9).toLong)
  }

  /** The error a failed request completes its task with. A timeout says what
    * did not happen in time (Note [A Download Waits For An Answer Only So
    * Long]); anything else keeps the client's message.
    */
  private[http] def describeFailure(
    request: HTTPRequest,
    failure: Throwable
  ): HTTPException =
    unwrap(failure) match {
      case ours: HTTPException => ours
      case _: HttpConnectTimeoutException =>
        HTTPException(
          s"Could not connect to [${request.uri}] within " +
          s"${describeDuration(ConnectTimeout)}."
        )
      case _: HttpTimeoutException =>
        HTTPException(
          s"The server at [${request.uri}] did not respond within " +
          s"${timeoutWaited(request, failure).getOrElse("the time allowed")}."
        )
      case _ =>
        HTTPException(s"Server responded with: [${failure.getMessage}].")
    }

  /** How long the request waited, if it failed because it timed out. */
  private def timeoutWaited(
    request: HTTPRequest,
    failure: Throwable
  ): Option[String] =
    unwrap(failure) match {
      case _: HttpConnectTimeoutException =>
        Some(describeDuration(ConnectTimeout))
      case _: HttpTimeoutException =>
        Some(
          request.requestImpl
            .timeout()
            .map[String](describeDuration)
            .orElse("the time allowed")
        )
      case _ => None
    }

  private def unwrap(failure: Throwable): Throwable = failure match {
    case wrapped: CompletionException if wrapped.getCause != null =>
      wrapped.getCause
    case other => other
  }

  private def describeDuration(duration: Duration): String =
    if (duration.toMillis % 1000 == 0) s"${duration.toSeconds} seconds"
    else s"${duration.toMillis} ms"

  private def convertHeaders(
    headers: HttpHeaders
  ): Seq[Header] = {
    val headerBuilder = Seq.newBuilder[Header]
    headers.map().forEach { case (name, values) =>
      values.forEach(value => {
        headerBuilder += Header(name, value)
      })
    }
    headerBuilder.result()
  }

  /** Fetches the `uri` and tries to decode is as a [[String]].
    *
    * It is a shorthand for the other variant of [[fetchString]] that creates a
    * simple GET request from the URI.
    *
    * @param uri the URI to query
    * @return a [[TaskProgress]] that tracks progress of the download and can
    *         be used to get the final result
    */
  def fetchString(uri: URI): TaskProgress[APIResponse] = {
    val request = HTTPRequestBuilder.fromURI(uri).GET
    fetchString(request)
  }

  /** Downloads the `request` and saves the response in the file pointed by the
    * `destination`.
    *
    * The request is executed in a separate thread. A [[TaskProgress]] instance
    * is returned immediately which can be used to track progress of the
    * download. The result is the same path as `destination`. It is available
    * only when the download has been completed successfully.
    *
    * Handles redirects, but will return an error if the amount of redirects
    * exceeds [[maximumRedirects]].
    *
    * @param request the request to send
    * @param sizeHint an optional hint indicating the expected size of the
    *                 response. It is used if the response does not include
    *                 explicit Content-Length header.
    * @return a [[TaskProgress]] that tracks progress of the download and can
    *         be used to wait for the completion of the download.
    */
  def download(
    request: HTTPRequest,
    destination: Path,
    sizeHint: Option[Long] = None
  ): TaskProgress[Path] = {
    logger.debug(
      "Downloading [{}] to [{}].",
      request.requestImpl.uri(),
      destination
    )
    val taskProgress          = new TaskProgressImplementation[Path](ProgressUnit.Bytes)
    val total: java.lang.Long = if (sizeHint.isDefined) sizeHint.get else null
    val bodyHandler =
      PathProgressBodyHandler.of(destination, taskProgress, total)
    asyncDownload(request, bodyHandler)
      .thenAccept(res => {
        if (res.statusCode() == 404) {
          taskProgress.setComplete(Failure(ResourceNotFound()))
          Files.deleteIfExists(destination)
        } else {
          taskProgress.setComplete(Success(destination))
        }
      })
      .exceptionally(ex => {
        taskProgress.setComplete(Failure(describeFailure(request, ex)))
        null
      })
    taskProgress
  }

  /** Downloads the `uri` and saves the response in the file pointed by the
    * `destination`.
    *
    * It is a shorthand for the other variant of [[download]] that creates a
    * simple GET request from the URI.
    *
    * @param uri the uri to download
    * @return a [[TaskProgress]] that tracks progress of the download and can
    *         be used to wait for the completion of the download.
    */
  def download(uri: URI, destination: Path): TaskProgress[Path] = {
    val request = HTTPRequestBuilder.fromURI(uri).GET
    download(request, destination)
  }

}
