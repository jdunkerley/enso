package org.enso.editions

import org.scalatest.wordspec.AnyWordSpec

class HaltSpec extends AnyWordSpec {
  "throwaway #443" should {
    "kill the forked test JVM" in {
      Runtime.getRuntime.halt(1)
    }
  }
}
