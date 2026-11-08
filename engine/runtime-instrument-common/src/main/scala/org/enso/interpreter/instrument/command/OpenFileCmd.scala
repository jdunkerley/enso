package org.enso.interpreter.instrument.command

import org.enso.interpreter.instrument.execution.RuntimeContext
import org.enso.polyglot.runtime.Runtime.Api

import scala.concurrent.ExecutionContext

/** A command that opens a file.
  *
  * @param maybeRequestId an option with request id
  * @param request a request for a service
  */
class OpenFileCmd(
  maybeRequestId: Option[Api.RequestId],
  request: Api.OpenFileRequest
) extends SynchronousCommand(None) {

  /** @inheritdoc */
  override def executeSynchronously(implicit
    ctx: RuntimeContext,
    ec: ExecutionContext
  ): Unit = {
    // See Note [Opening A Module With The Text It Already Has]
    val hasText: Boolean = ctx.locking.withFileLock(
      request.path,
      this.getClass,
      () =>
        ctx.executionService.hasModuleSources(request.path, request.contents)
    )
    if (hasText) {
      respond()
    } else {
      ctx.locking.withReadCompilationLock(
        this.getClass,
        () =>
          ctx.locking.withFileLock(
            request.path,
            this.getClass,
            () => {
              ctx.executionService.setModuleSources(
                request.path,
                request.contents
              )
              respond()
            }
          )
      )
    }
  }

  private def respond()(implicit ctx: RuntimeContext): Unit =
    ctx.endpoint.sendToClient(
      Api.Response(maybeRequestId, Api.OpenFileResponse)
    )

  /* Note [Opening A Module With The Text It Already Has]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A client usually pushes an execution context and opens the module's file
   * at about the same time (the IDE does both as a project opens, over two
   * connections). The push compiles the module under the write compilation
   * lock, so an open that took the read compilation lock first waited for
   * the whole compilation, and the client's answer with it: in the IDE the
   * graph's first node waited ~0.5 s on the JVM (#518).
   *
   * The compilation lock is there so that the open does not give a module
   * new text under a running compilation. The text a client opens a module
   * with is usually the one on disk, which is the one the compilation read,
   * and giving a module the text it already has changes nothing (see Note
   * [Opening A Module With The Text It Was Compiled From] in `Module`). So
   * the open first checks for that, under the file lock alone, and answers
   * at once; only other text waits for the compilation lock.
   *
   * The file lock is enough for the check: every write that replaces a
   * module's text with other text holds it (this command, `CloseFileCmd`
   * and the edits `EnsureCompiledJob` applies). The compiler's first read of
   * the file only fills in text the module did not have, and a module with
   * no text yet takes the locked path. Taking the file lock alone keeps the
   * lock order (compilation lock before file locks), as `EditFileCmd` does.
   */
}
