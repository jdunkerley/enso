package org.enso.languageserver.boot.config

import pureconfig.ConfigSource
import pureconfig.generic.auto._

/** An `application.conf` configuration.
  *
  * @param ydoc the embedded ydoc server
  * @param channelToken the token a ydoc host must present on the channel
  *                     sockets (`LANGUAGE_SERVER_CHANNEL_TOKEN`); without one
  *                     every channel socket is refused
  */
case class ApplicationConfig(ydoc: YdocConfig, channelToken: Option[String]) {

  /** The token is a secret: a logged config must not leak it. */
  override def toString: String =
    s"ApplicationConfig(ydoc=$ydoc,channelToken=${channelToken.map(_ => "<redacted>")})"
}

object ApplicationConfig {

  private val ConfigFilename  = "application-ls.conf"
  private val ConfigNamespace = "language-server"

  /** Load the configuration from the config file. */
  def load(): ApplicationConfig = {
    val contextClassLoader = Thread.currentThread().getContextClassLoader
    try {
      Thread.currentThread().setContextClassLoader(getClass.getClassLoader)
      ConfigSource
        .resources(ConfigFilename)
        .withFallback(ConfigSource.systemProperties)
        .at(ConfigNamespace)
        .loadOrThrow[ApplicationConfig]
    } finally Thread.currentThread().setContextClassLoader(contextClassLoader)
  }

}
