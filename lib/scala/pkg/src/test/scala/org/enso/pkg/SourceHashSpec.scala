package org.enso.pkg

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.security.MessageDigest
import java.util.HexFormat

class SourceHashSpec extends AnyWordSpec with Matchers {

  private def library(files: (String, String)*): Package[File] = {
    val root = Files.createTempDirectory("source-hash")
    root.toFile.deleteOnExit()
    Files.writeString(
      root.resolve("package.yaml"),
      "name: Hashed\nnamespace: local\nversion: 0.0.1\n"
    )
    files.foreach { case (path, code) =>
      val file = root.resolve("src").resolve(path)
      Files.createDirectories(file.getParent)
      Files.writeString(file, code)
    }
    PackageManager.Default.loadPackage(root.toFile).get
  }

  /** The definition, spelled out: see `Package.sourceHash`. */
  private def expected(files: (String, String)*): String = {
    val digest = MessageDigest.getInstance("SHA-256")
    files.sortBy(_._1).foreach { case (path, code) =>
      val bytes = code.getBytes(StandardCharsets.UTF_8)
      digest.update(path.getBytes(StandardCharsets.UTF_8))
      digest.update(0.toByte)
      digest.update(ByteBuffer.allocate(8).putLong(bytes.length.toLong).array())
      digest.update(bytes)
    }
    "sha256:" + HexFormat.of().formatHex(digest.digest())
  }

  "Package.sourceHash" should {
    "hash each .enso source by its /-separated path and its content" in {
      val files =
        Seq("Main.enso" -> "main = 42\n", "Data/Shape.enso" -> "type Shape\n")
      library(files: _*).sourceHash() shouldEqual expected(files: _*)
    }

    "ignore other files, inside src/ and outside it" in {
      val pkg = library("Main.enso" -> "main = 42\n")
      Files.writeString(pkg.sourceDir.toPath.resolve("notes.txt"), "notes")
      Files.writeString(
        pkg.root.toPath.resolve("package.yaml"),
        "name: Hashed\nnamespace: local\nversion: 0.0.2\n"
      )
      pkg.sourceHash() shouldEqual expected("Main.enso" -> "main = 42\n")
    }

    "change when a source changes" in {
      val pkg    = library("Main.enso" -> "main = 42\n")
      val before = pkg.sourceHash()
      Files.writeString(
        pkg.sourceDir.toPath.resolve("Main.enso"),
        "main = 43\n"
      )
      pkg.sourceHash() should not equal before
    }
  }
}
