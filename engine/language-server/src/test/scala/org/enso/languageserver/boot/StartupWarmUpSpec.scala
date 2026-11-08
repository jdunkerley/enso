package org.enso.languageserver.boot

import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import java.io.IOException
import java.net.URL
import java.util

class StartupWarmUpSpec extends AnyFlatSpec with Matchers {

  // A smoke test: the caches it fills are the JDK's and not observable here.
  it should "complete without throwing on the server's class loader" in {
    noException should be thrownBy StartupWarmUp.run(getClass.getClassLoader)
  }

  it should "only log when the class loader cannot list the manifests" in {
    val failing = new ClassLoader(null) {
      override def getResources(name: String): util.Enumeration[URL] =
        throw new IOException("no resources")
    }
    noException should be thrownBy StartupWarmUp.run(failing)
  }

  it should "start the warm-up once per process" in {
    StartupWarmUp.start(getClass.getClassLoader)
    StartupWarmUp.start(getClass.getClassLoader) shouldBe false
  }
}
