package org.enso.interpreter.instrument.command

import org.enso.interpreter.instrument.execution.RuntimeContext
import org.enso.polyglot.runtime.Runtime.Api
import org.slf4j.LoggerFactory

import scala.concurrent.{ExecutionContext, Future}

/** A command requesting to start the background jobs processing.
  *
  * @param maybeRequestId an option with request id
  */
final class StartBackgroundProcessingCmd(
  maybeRequestId: Option[Api.RequestId]
) extends AsynchronousCommand(maybeRequestId) {

  /** @inheritdoc */
  override def executeAsynchronously(implicit
    ctx: RuntimeContext,
    ec: ExecutionContext
  ): Future[Unit] = {
    Future(StartBackgroundProcessingCmd.startBackgroundJobs())
  }

}

object StartBackgroundProcessingCmd {
  private def logger: org.slf4j.Logger =
    LoggerFactory.getLogger(classOf[StartBackgroundProcessingCmd])

  /** Start background jobs execution. */
  private def startBackgroundJobs()(implicit ctx: RuntimeContext): Unit = {
    val jobsStarted = ctx.jobControlPlane.startBackgroundJobs()
    if (jobsStarted) {
      logger.debug("Background jobs started")
      ctx.endpoint.sendToClient(
        Api.Response(Api.BackgroundJobsStartedNotification())
      )
    }
  }
}
