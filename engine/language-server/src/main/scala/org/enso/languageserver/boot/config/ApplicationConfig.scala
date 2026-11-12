package org.enso.languageserver.boot.config

import com.typesafe.config.ConfigFactory
import pureconfig.ConfigSource
import pureconfig.generic.auto._

/** An `application.conf` configuration.
  *
  * @param channelToken the token a ydoc host must present on the channel
  *                     sockets (`LANGUAGE_SERVER_CHANNEL_TOKEN`); without one
  *                     every channel socket is refused
  */
case class ApplicationConfig(channelToken: Option[String]) {

  /** The token is a secret: a logged config must not leak it. */
  override def toString: String =
    s"ApplicationConfig(channelToken=${channelToken.map(_ => "<redacted>")})"
}

object ApplicationConfig {

  private val ConfigFilename  = "application-ls.conf"
  private val ConfigNamespace = "language-server"

  /** Load the configuration from the config file. */
  def load(): ApplicationConfig = {
    val contextClassLoader = Thread.currentThread().getContextClassLoader
    try {
      Thread.currentThread().setContextClassLoader(getClass.getClassLoader)
      // A fresh `systemProperties()`, not pureconfig's `ConfigSource.systemProperties` (a snapshot
      // taken when `ConfigSource` is first used): a standby engine sets the channel token as a
      // property after it started (engine/runner `StandbyRequest`).
      ConfigSource
        .resources(ConfigFilename)
        .withFallback(ConfigSource.fromConfig(ConfigFactory.systemProperties()))
        .at(ConfigNamespace)
        .loadOrThrow[ApplicationConfig]
    } finally Thread.currentThread().setContextClassLoader(contextClassLoader)
  }

}
