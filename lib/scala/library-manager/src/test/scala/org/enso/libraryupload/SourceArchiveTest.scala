package org.enso.libraryupload

import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.enso.cli.task.{ProgressReporter, TaskProgress}
import org.enso.editions.LibraryName
import org.enso.pkg.{Package, PackageManager}
import org.enso.testkit.WithTemporaryDirectory
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.io.{BufferedInputStream, File}
import java.nio.file.{Files, Path}
import scala.collection.mutable.ArrayBuffer
import scala.util.Using

class SourceArchiveTest
    extends AnyWordSpec
    with Matchers
    with WithTemporaryDirectory {

  private val noProgress = new ProgressReporter {
    override def trackProgress(message: String, task: TaskProgress[_]): Unit =
      ()
  }

  private val uploader = LibraryUploader(new DependencyExtractor[File] {
    override def findDependencies(pkg: Package[File]): Set[LibraryName] =
      Set()
  })

  private def entries(archive: Path): Seq[String] =
    Using.resource(
      new TarArchiveInputStream(
        new GzipCompressorInputStream(
          new BufferedInputStream(Files.newInputStream(archive))
        )
      )
    ) { tar =>
      val names = ArrayBuffer[String]()
      var entry = tar.getNextEntry
      while (entry != null) {
        names += entry.getName
        entry = tar.getNextEntry
      }
      names.toSeq
    }

  "createMainArchive" should {
    "not pack a previous main.tgz into the new one" in {
      val projectRoot = getTestDirectory.resolve("lib_root")
      PackageManager.Default.create(
        projectRoot.toFile,
        name      = "Archive_Test",
        namespace = "tester",
        version   = "1.2.3"
      )
      val source = projectRoot.resolve("src").resolve("Main.enso")
      Files.writeString(source, "main = 42\n" * 10000)
      val archive = projectRoot.resolve(LibraryUploader.mainArchiveName)

      uploader.createMainArchive(projectRoot, noProgress)
      entries(archive) should contain("src/Main.enso")

      // A rebuild over an existing distribution finds the previous archive in
      // the directory being packed. It must neither fail nor include it.
      uploader.createMainArchive(projectRoot, noProgress)
      val rebuilt = entries(archive)
      rebuilt should contain("src/Main.enso")
      rebuilt should not contain LibraryUploader.mainArchiveName
    }
  }
}
