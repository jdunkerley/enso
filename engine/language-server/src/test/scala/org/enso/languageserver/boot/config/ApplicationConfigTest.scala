package org.enso.languageserver.boot.config

import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

class ApplicationConfigTest extends AnyFlatSpec with Matchers {

  it should "load config" in {
    ApplicationConfig.load()
  }

  it should "leave the embedded ydoc server and the channel token off by default" in {
    // The variables set a value only when the shim asks for it.
    val config = ApplicationConfig.load()
    config.ydoc.port shouldBe sys.env
      .get("LANGUAGE_SERVER_YDOC_PORT")
      .map(_.toInt)
    config.channelToken shouldBe sys.env.get("LANGUAGE_SERVER_CHANNEL_TOKEN")
  }
}
