import sbt._

/* Note [ANTLR Output Has No Absolute Paths]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * ANTLR starts every generated file with a header comment naming the grammar
 * it was generated from, spelled exactly as it was given on the command line:
 *
 *     // Generated from C:\Repos\Enso\ide\std-bits\table\src\main\antlr4\Expression.g4 by ANTLR 4.12.0
 *
 * sbt-antlr4 always passes the grammar's absolute path (and offers no setting
 * for a relative one), so the checkout's location lands in the Java sources.
 * That breaks the build when a directory on the path starts with the letter
 * u (so the path holds a backslash directly followed by u): javac translates
 * unicode escapes before it tokenizes, comments included, so the path reads as
 * a malformed escape and fails with "illegal unicode escape" (#696). scalac
 * does the same, which is why this comment cannot spell the sequence out. The
 * path would also make the generated sources differ from machine to machine.
 *
 * `stripGrammarPath` therefore rewrites that header to name the grammar file
 * alone. It is attached to the generation task itself, so no later step ever
 * sees the absolute path. The rewrite is idempotent, which matters because
 * sbt-antlr4 caches its outputs and may or may not rerun the tool.
 */
object AntlrSources {

  private val Header = """(?m)\A// Generated from .*[/\\]([^/\\\r\n]+\.g4) by ANTLR""".r

  /** Rewrites the `// Generated from <path> by ANTLR` header of `file` so that
    * it keeps only the grammar's file name. Files without that header are left
    * untouched.
    */
  def stripGrammarPath(file: File): File = {
    val content = IO.read(file, IO.utf8)
    val updated = Header.replaceFirstIn(
      content,
      "// Generated from $1 by ANTLR"
    )
    if (updated != content) IO.write(file, updated, IO.utf8)
    file
  }

  /** Applies [[stripGrammarPath]] to every file in `files`. */
  def stripGrammarPaths(files: Seq[File]): Seq[File] =
    files.map(stripGrammarPath)
}
