import sbt._
import sbt.internal.util.MessageOnlyException

import javax.xml.parsers.DocumentBuilderFactory
import scala.sys.process._

/* Note [The Bundled java.exe Uses UTF-8]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `java.exe` reads its command line through the ANSI code page (`GetCommandLineA`), so on Windows
 * every character the system code page lacks becomes `?` before any Java runs. `WindowsArguments`
 * (Note [Arguments Outside The ANSI Code Page]) repairs `main`'s arguments afterwards, but the JVM's
 * own options cannot be repaired: with the engine under `C:\Users\Łukasz 漢\` on code page 1252,
 * `--module-path` arrives as `C:\Users\?ukasz ?\…` and the JVM fails at boot with
 * `InvalidPathException: Illegal char <?>`. The IDE installs per user (`%LOCALAPPDATA%\Programs`),
 * so a user whose name is outside the code page could start no engine at all (#693).
 *
 * The fix is the `activeCodePage` setting of the application manifest (`java-utf8.manifest` in
 * this directory): it makes UTF-8 the ANSI code page of that process alone, so the command line,
 * the module path, `-XX:AOTCache=`, `-D` values, `sun.jnu.encoding` and the native library paths
 * all keep every character. It is merged into the manifest the JDK's launchers already carry
 * (assembly identity, common controls, `asInvoker`, DPI awareness, supported OS list) with `mt.exe
 * -updateresource`, which keeps those elements; `embed` checks that it did, and that the merged
 * manifest has the setting. A launcher started with a console still writes to it in the console's
 * code page (`stdout.encoding` follows it); written to a pipe, as the IDE's shim reads it, the
 * output is UTF-8 instead of the ANSI code page.
 *
 * - Windows 10 1903 and later honour the setting; older Windows ignores it (the limit stays).
 * - Only the bundled runtime gets it: the IDE's `runtime/graalvm-*`, which the shim and `enso.bat`
 *   prefer. A JDK from `JAVA_HOME` or the PATH keeps the limit.
 * - Rewriting the resources drops the launchers' Authenticode signature (Oracle's). The fork
 *   ships unsigned; a signing step (electron-builder's) runs after this one, on the installer.
 *
 * `mt.exe` comes with the Windows SDK and is on the PATH in a Visual Studio Developer Prompt (CI:
 * `setup-msvc`), which the engine bundle needs for `MsvcRuntime` anyway; without it the build fails.
 */

/** Embeds the UTF-8 code page manifest in a Windows JDK's launchers (see the Note above). */
object JavaUtf8Manifest {

  /** The launchers that get the manifest: the shim and `enso.bat` start `java.exe`; `javaw.exe`
    * is the same launcher without a console.
    */
  val launchers: Seq[String] = Seq("java.exe", "javaw.exe")

  private val windowsSettings2019 =
    "http://schemas.microsoft.com/SMI/2019/WindowsSettings"

  /** The manifest in the repository, relative to the build's root. */
  def manifest(buildRoot: File): File =
    buildRoot / "project" / "java-utf8.manifest"

  /** Merges `manifestFile` into the manifest of each launcher in `jdkDirectory/bin`. */
  def embed(jdkDirectory: File, manifestFile: File, log: Logger): Unit = {
    if (!manifestFile.isFile)
      throw new MessageOnlyException(s"$manifestFile is missing.")
    val mt = findMt()
    IO.withTemporaryDirectory { tmp =>
      for (name <- launchers) {
        val exe = jdkDirectory / "bin" / name
        if (!exe.isFile)
          throw new MessageOnlyException(s"$exe is missing.")
        val before = tmp / s"$name.before.manifest"
        val after  = tmp / s"$name.after.manifest"
        run(
          mt,
          Seq(s"-inputresource:${exe.getAbsolutePath};#1", s"-out:$before")
        )
        run(
          mt,
          Seq(
            "-manifest",
            manifestFile.getAbsolutePath,
            s"-updateresource:${exe.getAbsolutePath};#1"
          )
        )
        run(
          mt,
          Seq(s"-inputresource:${exe.getAbsolutePath};#1", s"-out:$after")
        )
        val lost = missingElements(before, after)
        if (lost.nonEmpty)
          throw new MessageOnlyException(
            s"Merging $manifestFile into $exe lost elements of its manifest: ${lost.mkString(", ")}."
          )
        val codePage = activeCodePage(after)
        if (!codePage.contains("UTF-8"))
          throw new MessageOnlyException(
            s"$exe's merged manifest has activeCodePage ${codePage.getOrElse("(none)")}, not UTF-8."
          )
        log.info(s"Embedded the UTF-8 code page manifest in $exe.")
      }
    }
  }

  /** Fails the build unless the JDK's `java.exe` runs with UTF-8 as its ANSI code page. */
  def checkActive(jdkDirectory: File, log: Logger): Unit = {
    val java   = jdkDirectory / "bin" / "java.exe"
    val output = new StringBuilder
    val exit = Process(
      Seq(java.getAbsolutePath, "-XshowSettings:properties", "-version")
    ).!(ProcessLogger(l => output.append(l).append('\n')))
    val jnu = """(?m)^\s*sun\.jnu\.encoding = (\S+)""".r
      .findFirstMatchIn(output)
      .map(_.group(1))
    if (exit != 0 || !jnu.contains("UTF-8"))
      throw new MessageOnlyException(
        s"$java does not run with UTF-8 as its code page (exit $exit, sun.jnu.encoding " +
        s"${jnu.getOrElse("not printed")}).\n$output"
      )
    log.info(s"$java runs with sun.jnu.encoding = UTF-8.")
  }

  /** The elements of `before` (namespace and name, with their counts) that `after` lacks. */
  private def missingElements(before: File, after: File): Seq[String] = {
    val was = elementCounts(before)
    val is  = elementCounts(after)
    was
      .collect {
        case (key, count) if is.getOrElse(key, 0) < count => key
      }
      .toSeq
      .sorted
  }

  private def elementCounts(manifest: File): Map[String, Int] = {
    val elements = parse(manifest).getElementsByTagNameNS("*", "*")
    (0 until elements.getLength)
      .map { i =>
        val e = elements.item(i)
        s"{${e.getNamespaceURI}}${e.getLocalName}"
      }
      .groupBy(identity)
      .map { case (k, v) => k -> v.size }
  }

  private def activeCodePage(manifest: File): Option[String] = {
    val found =
      parse(manifest).getElementsByTagNameNS(
        windowsSettings2019,
        "activeCodePage"
      )
    if (found.getLength == 1) Some(found.item(0).getTextContent.trim) else None
  }

  private def parse(manifest: File) = {
    val factory = DocumentBuilderFactory.newInstance()
    factory.setNamespaceAware(true)
    factory.newDocumentBuilder().parse(manifest)
  }

  private def run(mt: File, args: Seq[String]): Unit = {
    val output = new StringBuilder
    val exit = Process(mt.getAbsolutePath +: "-nologo" +: args)
      .!(ProcessLogger(l => output.append(l).append('\n')))
    if (exit != 0)
      throw new MessageOnlyException(
        s"$mt ${args.mkString(" ")} exited with $exit.\n$output"
      )
  }

  /** `mt.exe` from the PATH, else from the Windows SDK of a Developer Prompt. */
  private def findMt(): File = {
    val onPath = sys.env
      .getOrElse("PATH", "")
      .split(java.io.File.pathSeparator)
      .filter(_.nonEmpty)
      .map(dir => file(dir) / "mt.exe")
      .find(_.isFile)
    val inSdk = sys.env
      .get("WindowsSdkVerBinPath")
      .map(dir => file(dir) / "x64" / "mt.exe")
      .filter(_.isFile)
    onPath.orElse(inSdk).getOrElse {
      throw new MessageOnlyException(
        "mt.exe (Windows SDK) is not on the PATH: run this from a Visual Studio Developer Prompt " +
        "(CI: the `setup-msvc` action), so that the bundled java.exe gets its UTF-8 code page " +
        "manifest (Note [The Bundled java.exe Uses UTF-8] in project/JavaUtf8Manifest.scala)."
      )
    }
  }
}
