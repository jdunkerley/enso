import sbt._
import sbt.internal.util.{ManagedLogger, MessageOnlyException}

import scala.sys.process._

/** Copies the MSVC C runtime DLLs that the engine package's Windows binaries import next to those
  * binaries, so that the package runs on a machine without the Visual C++ redistributable.
  *
  * This is what `./run` did after `buildEngineDistribution` on Windows
  * (`build_tools/build/src/engine/context.rs`, `ci_utils/src/packaging.rs`,
  * `programs/vs/redist.rs`): the CRT set is every DLL under
  * `%VCToolsRedistDir%\x64\*.CRT\`, the binaries are every `.exe` and `.dll` in the package
  * (listed before anything is copied), and each binary gets the CRT DLLs it imports copied into
  * its own directory. Imports are read with `dumpbin /dependents`, which `setup-msvc` (CI) or a
  * Developer Prompt (locally) puts on the PATH together with `VCToolsRedistDir`. The CRT DLLs
  * that a copied DLL imports in turn are copied too (`msvcp140.dll` imports `vcruntime140.dll`),
  * which adds nothing today but keeps the closure complete.
  *
  * On the 2026-10 runner image this copies 7 files: `bin/` msvcp140, vcruntime140,
  * vcruntime140_1; `component/` vcruntime140, vcruntime140_1;
  * `lib/Standard/Snowflake/<version>/polyglot/lib/amd64/windows/` vcruntime140;
  * `python-home/lib-graalpython/` vcruntime140.
  */
object MsvcRuntime {

  private val DllName = """(?i)^\s+(\S+\.dll)\s*$""".r

  /** The DLL names in `dumpbin /dependents` output (including delay-load dependencies). */
  def importedDlls(dumpbinOutput: String): Seq[String] =
    dumpbinOutput.linesIterator.collect { case DllName(name) => name }.toSeq

  /** The CRT DLLs under `<redist>\x64\*.CRT\`, by lower-case file name. */
  def crtDlls(redistDir: File): Map[String, File] = {
    val x64 = redistDir / "x64"
    val crtDirs = Option(x64.listFiles()).toSeq.flatten
      .filter(dir =>
        dir.isDirectory && dir.getName.toLowerCase.endsWith(".crt")
      )
    crtDirs
      .flatMap(dir => (dir ** "*.dll").get)
      .map(dll => dll.getName.toLowerCase -> dll)
      .toMap
  }

  /** Copies the CRT DLLs into `packageRoot`; returns the files written. */
  def copyCrtDlls(packageRoot: File, log: ManagedLogger): Seq[File] = {
    val redist = sys.env.getOrElse(
      "VCToolsRedistDir",
      throw new MessageOnlyException(
        "VCToolsRedistDir is not set: run this from a Visual Studio Developer Prompt " +
        "(CI: the `setup-msvc` action) so that the MSVC runtime DLLs can be copied."
      )
    )
    val crt = crtDlls(file(redist))
    if (crt.isEmpty)
      throw new MessageOnlyException(s"No CRT DLLs under $redist\\x64\\*.CRT.")
    val binaries = (packageRoot ** ("*.exe" || "*.dll")).get
    val imports  = scala.collection.mutable.Map[File, Seq[String]]()
    def importsOf(binary: File): Seq[String] =
      imports.getOrElseUpdate(
        binary, {
          val output =
            Seq("dumpbin", "/nologo", "/dependents", binary.getAbsolutePath).!!
          importedDlls(output).map(_.toLowerCase)
        }
      )
    val copied = for {
      binary <- binaries
      dir = binary.getParentFile
      name <- closure(importsOf(binary), crt, dll => importsOf(crt(dll)))
    } yield {
      val target = dir / crt(name).getName
      IO.copyFile(crt(name), target, preserveLastModified = true)
      log.info(
        s"Copied ${crt(name).getName} next to ${binary.getName} in $dir."
      )
      target
    }
    copied.distinct
  }

  /** The CRT DLLs among `direct`, and those they import, transitively. */
  private def closure(
    direct: Seq[String],
    crt: Map[String, File],
    importsOfCrt: String => Seq[String]
  ): Seq[String] = {
    val found   = scala.collection.mutable.LinkedHashSet[String]()
    var pending = direct.filter(crt.contains)
    while (pending.nonEmpty) {
      val next = pending.filterNot(found.contains)
      found ++= next
      pending = next.flatMap(importsOfCrt).filter(crt.contains)
    }
    found.toSeq
  }
}
