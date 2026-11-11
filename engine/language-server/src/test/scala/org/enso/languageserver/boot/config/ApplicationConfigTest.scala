package org.enso.languageserver.boot.config

import com.typesafe.config.ConfigFactory
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

class ApplicationConfigTest extends AnyFlatSpec with Matchers {

  it should "load config" in {
    ApplicationConfig.load()
  }

  it should "leave the channel token off by default" in {
    // The variable sets a value only when the shim asks for it.
    val config = ApplicationConfig.load()
    config.channelToken shouldBe sys.env.get("LANGUAGE_SERVER_CHANNEL_TOKEN")
  }

  it should "keep the channel token out of its string form" in {
    val config = ApplicationConfig(Some("hunter2-token"))
    config.toString should not include "hunter2-token"
    config.toString should include("redacted")
    config.copy(channelToken = None).toString should not include "redacted"
  }

  it should "read the channel token a standby engine set after start" in {
    // The resources source wins over a variable that is set, so the property path is not exercised.
    assume(sys.env.get("LANGUAGE_SERVER_CHANNEL_TOKEN").isEmpty)
    // engine/runner `StandbyRequest.applyEnvironment` sets it, then invalidates the caches.
    sys.props("language-server.channel-token") = "standby-token"
    ConfigFactory.invalidateCaches()
    try {
      val config = ApplicationConfig.load()
      config.channelToken shouldBe Some("standby-token")
    } finally {
      sys.props -= "language-server.channel-token"
      ConfigFactory.invalidateCaches()
    }
  }
}
