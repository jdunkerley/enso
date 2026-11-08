package org.enso.languageserver.boot

import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

import java.io.IOException
import java.net.URL
import java.util
import javax.net.ssl.SSLContext

class StartupWarmUpSpec extends AnyFlatSpec with Matchers {

  it should "read the manifests and set up the default SSL context" in {
    StartupWarmUp.run(getClass.getClassLoader)
    SSLContext.getDefault.createSSLEngine().getSession should not be null
  }

  it should "only log when the class loader cannot list the manifests" in {
    val failing = new ClassLoader(null) {
      override def getResources(name: String): util.Enumeration[URL] =
        throw new IOException("no resources")
    }
    noException should be thrownBy StartupWarmUp.run(failing)
  }
}
