package org.enso.logging.service.logback;

import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.joran.JoranConfigurator;
import ch.qos.logback.core.joran.spi.JoranException;
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import javax.net.ServerSocketFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * A direct copy of ch.qos.logback.classic.net.SimpleSocketServer. A simple {@link
 * SocketLoggingNode} based server.
 *
 * @author Ceki G&uuml;lc&uuml;
 * @author S&eacute;bastien Pennec
 * @since 0.8.4
 */
public class SocketServer extends Thread {

  /** The accept backlog {@link ServerSocketFactory#createServerSocket(int)} uses by default. */
  private static final int BACKLOG = 50;

  Logger logger = LoggerFactory.getLogger(SocketServer.class);

  private final int port;
  private final LoggerContext lc;
  private volatile boolean closed = false;
  private volatile ServerSocket serverSocket;
  private List<SocketLoggingNode> socketNodeList = new ArrayList<>();

  // used for testing purposes
  private CountDownLatch latch;

  /**
   * Creates a server for the given port.
   *
   * @param lc the context the received events are logged to
   * @param port the port to listen on; 0 lets the operating system pick a free one, which {@link
   *     #bind()} then reports
   */
  public SocketServer(LoggerContext lc, int port) {
    this.lc = lc;
    this.port = port;
  }

  /**
   * Binds the server socket on the calling thread, so that a failure to bind reaches the caller
   * instead of only the server thread. Call it before {@link #start()}; see Note [Logging Server
   * Binds Before It Starts].
   *
   * @return the port the server is listening on, which differs from the requested one when that was
   *     0
   * @throws IOException if the port cannot be bound, e.g. because something else listens on it
   */
  public synchronized int bind() throws IOException {
    if (serverSocket == null) {
      // Note [Logging Server Listens On Loopback Only]
      var address = InetAddress.getLoopbackAddress();
      serverSocket = getServerSocketFactory().createServerSocket(port, BACKLOG, address);
      logger.debug("Listening on " + address.getHostAddress() + ":" + serverSocket.getLocalPort());
    }
    return serverSocket.getLocalPort();
  }

  /* Note [Logging Server Binds Before It Starts]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * The server used to create its server socket in `run`, on its own thread. A
   * failed bind - the port already taken by another language server's logging
   * server, or by an unrelated program - was then only logged from that thread,
   * while `LoggingServer.start` had already returned the URI as if the server
   * were up. Its own socket appender then connected to whoever owned the port.
   * Binding in `bind`, on the caller's thread, lets `LoggingServer.start` fail,
   * so `LoggingSetupHelper` can fall back to logging locally. It also tells the
   * caller the actual port, which is what makes port 0 (any free port) usable.
   */

  public void run() {

    final String oldThreadName = Thread.currentThread().getName();

    try {

      final String newThreadName = getServerThreadName();
      Thread.currentThread().setName(newThreadName);

      var listening = serverSocket;
      if (listening == null) {
        bind();
        listening = serverSocket;
      }
      while (!closed) {
        signalAlmostReadiness();
        Socket socket = listening.accept();
        SocketLoggingNode newSocketNode = new SocketLoggingNode(this, socket, lc);
        synchronized (socketNodeList) {
          socketNodeList.add(newSocketNode);
        }
        final String clientThreadName = getClientThreadName(socket);
        new Thread(newSocketNode, clientThreadName).start();
      }
    } catch (Exception e) {
      if (closed) {
        logger.warn("Exception in run method for a closed server", e);
      } else {
        logger.error("Unexpected failure in run method", e);
      }
    } finally {
      Thread.currentThread().setName(oldThreadName);
    }
  }

  /* Note [Logging Server Listens On Loopback Only]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * Every client of the logging server runs on the same machine: language servers
   * and the runners the launcher spawns connect to the `localhost` URI that
   * `LoggingServer.start` hands out, or to the `localhost` default of the `socket`
   * appender's `hostname`. Nothing needs to reach it from another host, while
   * anyone who can connect can feed it log and telemetry events, which it writes
   * to the user's log files and forwards to the cloud. So it binds to the loopback
   * address rather than the wildcard address (every interface).
   *
   * `InetAddress.getLoopbackAddress()` follows `java.net.preferIPv6Addresses` the
   * same way resolving `localhost` does, so the address the clients resolve and
   * the address the server binds stay on the same IP family.
   */

  /** Returns the name given to the server thread. */
  protected String getServerThreadName() {
    var listening = serverSocket;
    var actualPort = listening != null ? listening.getLocalPort() : port;
    return String.format("Logback %s (port %d)", getClass().getSimpleName(), actualPort);
  }

  /** Returns a name to identify each client thread. */
  protected String getClientThreadName(Socket socket) {
    return String.format("Logback SocketNode (client: %s)", socket.getRemoteSocketAddress());
  }

  /**
   * Gets the platform default {@link ServerSocketFactory}.
   *
   * <p>Subclasses may override to provide a custom server socket factory.
   */
  protected ServerSocketFactory getServerSocketFactory() {
    return ServerSocketFactory.getDefault();
  }

  /**
   * Signal another thread that we have established a connection This is useful for testing
   * purposes.
   */
  void signalAlmostReadiness() {
    if (latch != null && latch.getCount() != 0) {
      latch.countDown();
    }
  }

  /**
   * Used for testing purposes
   *
   * @param latch
   */
  void setLatch(CountDownLatch latch) {
    this.latch = latch;
  }

  /** Used for testing purposes */
  public CountDownLatch getLatch() {
    return latch;
  }

  public boolean isClosed() {
    return closed;
  }

  public void closeProject(UUID projectId) {
    if (projectId != null) {
      synchronized (socketNodeList) {
        for (SocketLoggingNode sn : socketNodeList) {
          if (sn.projectId != null && sn.projectId.equals(projectId)) sn.closing();
        }
      }
    }
  }

  public void close() {
    closed = true;
    if (serverSocket != null) {
      try {
        serverSocket.close();
      } catch (IOException e) {
        logger.error("Failed to close serverSocket", e);
      } finally {
        serverSocket = null;
      }
    }

    logger.info("closing this server");
    synchronized (socketNodeList) {
      for (SocketLoggingNode sn : socketNodeList) {
        sn.close();
      }
    }
    if (socketNodeList.size() != 0) {
      logger.warn("Was expecting a 0-sized socketNodeList after server shutdown");
    }
  }

  public void socketNodeClosing(SocketLoggingNode sn) {
    // don't allow simultaneous access to the socketNodeList
    // (e.g. removal whole iterating on the list causes
    // java.util.ConcurrentModificationException)
    synchronized (socketNodeList) {
      socketNodeList.remove(sn);
    }
  }

  public static void configureLC(LoggerContext lc, String configFile) throws JoranException {
    JoranConfigurator configurator = new JoranConfigurator();
    lc.reset();
    configurator.setContext(lc);
    configurator.doConfigure(configFile);
  }
}
