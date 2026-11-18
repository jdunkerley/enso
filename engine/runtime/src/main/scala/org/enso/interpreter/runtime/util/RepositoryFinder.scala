package org.enso.interpreter.runtime.util

import java.nio.file.{Files, Path}
import scala.annotation.tailrec

private[util] object RepositoryFinder {
  @tailrec
  private def findRepositoryRoot(path: Path): Option[Path] = {
    val gitDir = path.resolve(".git")
    if (gitDir.toFile.exists()) {
      Some(path)
    } else {
      val parent = path.getParent
      if (parent != null) {
        findRepositoryRoot(parent)
      } else {
        None
      }
    }
  }

  private lazy val root: Option[Path] = {
    val currentDir = Path.of(".").toAbsolutePath.normalize()
    findRepositoryRoot(currentDir)
  }

  /** Handles relativizing the path to the repository root and replacing the
    * built-distribution path with the libraries base source code path.
    *
    * This ensures that the actual source files are referenced instead of the build artifacts.
    *
    * The result is relative to the repository root (as GitHub annotations
    * require), not to the working directory: use [[displayPath]] for a path
    * that can be opened from wherever the process runs.
    */
  def rewritePath(path: Path): Path = rewritePath(root, path)

  /** Like [[rewritePath]], but absolute and normalized, so it stays correct
    * when the working directory is not the repository root (for example
    * `lib/Standard/<Library>` while the standard library is indexed).
    */
  def displayPath(path: Path): Path = displayPath(root, path)

  private[util] def displayPath(root: Option[Path], path: Path): Path = {
    val rewritten = rewritePath(root, path)
    root
      .fold(rewritten.toAbsolutePath)(_.resolve(rewritten))
      .normalize()
  }

  private[util] def rewritePath(root: Option[Path], path: Path): Path = {
    val relative = root
      .filter(r => path.isAbsolute && path.startsWith(r))
      .map(_.relativize(path))
      .getOrElse(path)
    if (relative.startsWith("built-distribution")) {
      val rewrittenPath = Path.of(
        relative.toString
          .replace("\\", "/")
          .replaceFirst(
            """built-distribution/enso-engine-[^/]+/enso-[^/]+/lib/([^/]+)/([^/]+)/[^/]+/""",
            "distribution/lib/$1/$2/0.0.0-dev/"
          )
      )

      // Only apply the rewrite if the new path points to an existing file.
      // It is looked up under the repository root, not the working directory.
      if (Files.exists(root.fold(rewrittenPath)(_.resolve(rewrittenPath)))) {
        rewrittenPath
      } else {
        relative
      }
    } else relative
  }
}
