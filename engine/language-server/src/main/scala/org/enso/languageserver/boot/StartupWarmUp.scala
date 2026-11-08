package org.enso.languageserver.boot

import com.typesafe.scalalogging.LazyLogging

import java.util.concurrent.atomic.AtomicBoolean
import java.util.jar.Manifest
import javax.net.ssl.SSLContext

import scala.jdk.CollectionConverters._
import scala.util.Using
import scala.util.control.NonFatal

/** Work that the server's startup does on its main thread anyway, started
  * earlier on a background thread so that it overlaps with the rest of the
  * startup. See Note [Startup Warm-Up].
  */
object StartupWarmUp extends LazyLogging {

  /* Note [Startup Warm-Up]
   * ~~~~~~~~~~~~~~~~~~~~~~
   * Two pieces of work on the way to "Started server" are done by libraries on
   * the main thread, and depend on nothing the server sets up:
   *
   * - Akka's `ManifestInfo` extension, created when the `ActorSystem` starts,
   *   reads every `META-INF/MANIFEST.MF` the class loader can see. Each read
   *   opens the jar through a `jar:` URL; for the signed Bouncy Castle jars it
   *   also verifies their signatures.
   * - Akka HTTP binds a plain (not TLS) listener through `TLSPlacebo`, whose
   *   static initializer calls `SSLContext.getDefault.createSSLEngine`. That
   *   loads the JDK trust store (`cacerts`), and the JDK's provider lookup
   *   instantiates the `java.security.Provider`s on the module path, the Bouncy
   *   Castle ones among them (and JCE verifies their jar).
   *
   * On the JVM the two cost the main thread about 60 ms and 50 ms of the ~450
   * ms from "Starting Language Server" to "Started server". The warm-up thread
   * does the same work first, the manifests (needed first) and then the SSL
   * context. The `jar:` URL connections cache the jars they open (verified),
   * and `SSLContext.getDefault` caches the default context, so the main thread
   * finds both done. The manifests are read in reverse order, so that the two
   * threads meet in the middle if `ManifestInfo` starts before the warm-up has
   * finished. Nothing is configured differently: a failure here is only
   * logged, and the main thread then does the same work, and fails the same
   * way, as it did before.
   */

  private val started = new AtomicBoolean(false)

  /** Starts the warm-up on a daemon thread and returns at once. Only the first
    * call in a process does anything: a restart of the server
    * (`LanguageServerComponent.restart`) finds both caches already filled.
    *
    * @param classLoader the class loader the `ActorSystem` is given
    * @return whether this call started the warm-up
    */
  def start(classLoader: ClassLoader): Boolean = {
    val first = started.compareAndSet(false, true)
    if (first) {
      val thread = new Thread(() => run(classLoader), "ls-startup-warm-up")
      thread.setDaemon(true)
      thread.start()
    }
    first
  }

  /** Does the warm-up on the calling thread. */
  private[boot] def run(classLoader: ClassLoader): Unit = {
    try {
      val manifests =
        classLoader.getResources("META-INF/MANIFEST.MF").asScala.toVector
      manifests.reverseIterator.foreach { url =>
        try Using.resource(url.openStream())(new Manifest(_))
        catch {
          case NonFatal(error) =>
            // `ManifestInfo` will meet the same failure and handle it; the
            // warm-up only loses this jar's head start.
            logger.trace(s"Reading the manifest [$url] failed.", error)
        }
      }
    } catch {
      case NonFatal(error) =>
        logger.debug("Reading the jar manifests failed.", error)
    }
    try {
      SSLContext.getDefault.createSSLEngine().getSession
    } catch {
      case NonFatal(error) =>
        logger.debug("Warming up the default SSL context failed.", error)
    }
  }
}
