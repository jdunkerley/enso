import sbt._
import sbt.internal.util.{ManagedLogger, MessageOnlyException}

import java.nio.file.Files
import scala.collection.JavaConverters._
import scala.sys.process._

/** Parses every `.enso` file under `distribution/lib` and `test` with the Rust parser's
  * `check_syntax` tool, and fails on any syntax error or warning.
  *
  * This is what `./run libraries check-syntax` ran
  * (`build_tools/build/src/rust/enso_linter.rs`): `cargo run -p enso-parser-debug --bin
  * check_syntax --release -- <files>`, which prints `E <path> <line>:<col>-<line>:<col>: <message>`
  * (or `W …` for a warning) to stderr and exits 1 when any file has a message. The same files, the
  * same tool and the same rules, so errors and warnings both fail.
  *
  * Two differences, both for Windows developers: the file list goes in batches of at most
  * [[MaxArgumentChars]] characters, since ~1,000 absolute paths are far over Windows' 32,767
  * character command line (`./run` only ever ran it on Linux); and the exit code is checked here
  * rather than through [[Cargo.run]], which only logs a failure.
  */
object EnsoSyntaxCheck {

  /** The most characters of file arguments per `check_syntax` call. */
  val MaxArgumentChars = 20000

  private val Summary =
    """Errors or warnings found in (\d+) files""".r.unanchored

  /** The `.enso` files `./run` checked: everything under `distribution/lib` and `test`, sorted. */
  def files(repoRoot: File): Seq[File] =
    Seq(repoRoot / "distribution" / "lib", repoRoot / "test").flatMap { dir =>
      if (!dir.exists()) Seq()
      else {
        val stream = Files.walk(dir.toPath)
        try {
          stream
            .iterator()
            .asScala
            .filter(path =>
              Files.isRegularFile(path) && path.getFileName.toString
                .endsWith(".enso")
            )
            .map(_.toFile)
            .toList
        } finally stream.close()
      }
    }.sorted

  /** Splits `paths` into batches whose joined length (one space between) stays under `limit`. */
  def batches(paths: Seq[String], limit: Int): Seq[Seq[String]] =
    paths.foldLeft(Vector(Vector.empty[String])) { (acc, path) =>
      val current = acc.last
      val length  = current.map(_.length + 1).sum + path.length
      if (current.nonEmpty && length > limit) acc :+ Vector(path)
      else acc.init :+ (current :+ path)
    }

  /** Runs the check; throws when any file has a syntax error or warning. */
  def run(repoRoot: File, log: ManagedLogger): Unit = {
    if (!Cargo.cargoOk(log))
      throw new MessageOnlyException(
        "checkEnsoSyntax needs `cargo` on the PATH."
      )
    val all = files(repoRoot).map(_.getAbsolutePath)
    log.info(s"Checking the syntax of ${all.size} Enso files.")
    var failedFiles = 0
    for (batch <- batches(all, MaxArgumentChars)) {
      val command = Seq(
        "cargo",
        "run",
        "-p",
        "enso-parser-debug",
        "--bin",
        "check_syntax",
        "--release",
        "--"
      ) ++ batch
      var summary: Option[Int] = None
      val logger = ProcessLogger(
        line => log.info(line),
        line => {
          line match {
            case Summary(count) => summary = Some(count.toInt)
            case _              =>
          }
          log.info(line)
        }
      )
      val exitCode = Process(command, repoRoot).!(logger)
      if (exitCode != 0) {
        summary match {
          case Some(count) => failedFiles += count
          case None =>
            throw new MessageOnlyException(
              s"`cargo run -p enso-parser-debug --bin check_syntax` exited with $exitCode."
            )
        }
      }
    }
    if (failedFiles > 0)
      throw new MessageOnlyException(
        s"Enso syntax check failed: errors or warnings found in $failedFiles files."
      )
    log.info("Enso syntax check passed.")
  }
}
