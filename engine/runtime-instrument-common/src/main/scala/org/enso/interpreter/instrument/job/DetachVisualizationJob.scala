package org.enso.interpreter.instrument.job

import org.enso.interpreter.instrument.execution.RuntimeContext
import org.slf4j.{Logger, LoggerFactory}
import org.enso.polyglot.runtime.Runtime.Api.{
  ContextId,
  ExpressionId,
  VisualizationId
}

/** A job that detaches a visualization.
  *
  * @param visualizationId an identifier of visualization
  * @param expressionId an identifier of expression
  * @param contextId an execution context id
  * @param requestOrder the number of the detach request, from
  *                     `VisualizationHolder.nextRequestOrder`
  */
class DetachVisualizationJob(
  val visualizationId: VisualizationId,
  val expressionId: ExpressionId,
  val contextId: ContextId,
  val requestOrder: Long
) extends Job[Unit](List(contextId), false, false)
    with UniqueJob[Unit] {

  /** @inheritdoc */
  override def equalsTo(that: UniqueJob[_]): Boolean =
    that match {
      case that: DetachVisualizationJob =>
        this.visualizationId == that.visualizationId &&
        this.expressionId == that.expressionId &&
        this.contextId == that.contextId
      case _ => false
    }

  /** @inheritdoc */
  override def runImpl(implicit ctx: RuntimeContext): Unit = {
    ctx.locking.withReadContextLock(
      ctx.locking.getOrCreateContextLock(contextId),
      this.getClass,
      () => {
        val holder = ctx.contextManager.getVisualizationHolder(contextId)
        // Note [Visualization Requests Take Effect In The Order They Arrived]
        // in `VisualizationHolder`.
        if (
          !holder.removeInRequestOrder(
            visualizationId,
            expressionId,
            requestOrder
          )
        ) {
          DetachVisualizationJob.logger.debug(
            "Not detaching visualization {}: a later request changed it.",
            visualizationId
          )
        }
      }
    )
  }

  override def toString: String =
    s"DetachVisualizationJob(visualizationId=$visualizationId, expressionId=$expressionId)"
}

object DetachVisualizationJob {
  private lazy val logger: Logger =
    LoggerFactory.getLogger(classOf[DetachVisualizationJob])
}
