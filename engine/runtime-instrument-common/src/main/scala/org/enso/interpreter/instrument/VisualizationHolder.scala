package org.enso.interpreter.instrument

import org.enso.pkg.QualifiedName
import org.enso.polyglot.runtime.Runtime.Api.{ExpressionId, VisualizationId}
import com.oracle.truffle.api.CompilerDirectives

import java.util.concurrent.atomic.AtomicLong
import scala.collection.mutable

/** A mutable holder of all visualizations attached to an execution context.
  * This class is thread-safe.
  */
class VisualizationHolder {

  private val oneshotExpressions: mutable.Map[ExpressionId, OneshotExpression] =
    mutable.Map.empty

  private val visualizationMap: mutable.Map[ExpressionId, List[Visualization]] =
    mutable.Map.empty.withDefaultValue(List.empty)

  private val unevaluatedMap
    : mutable.Map[ExpressionId, List[UnevaluatedVisualization]] =
    mutable.Map.empty.withDefaultValue(List.empty)

  private val pendingSubExpressionVisualizations: mutable.Set[ExpressionId] =
    mutable.HashSet.empty

  /** The number of the latest attach, modify or detach request that changed
    * each visualization of an expression (Note [Visualization Requests Take
    * Effect In The Order They Arrived]).
    */
  private val latestRequestOrder
    : mutable.Map[(VisualizationId, ExpressionId), Long] =
    mutable.Map.empty

  /* Note [Visualization Requests Take Effect In The Order They Arrived]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * An attach or modify becomes an `UpsertVisualizationJob` and a detach a
   * `DetachVisualizationJob`, and nothing ran them in the order the requests
   * came in. The commands run on a thread pool, and the upsert is a
   * high-priority job that never waits for the context lock (it defers the
   * visualization when an execution holds it), while the detach is a regular
   * job that waits for that lock. So a detach followed by an attach of the
   * same visualization ended with the detach removing what the attach had
   * just set up whenever an execution was running, as one is after every
   * edit (#715). The other way round, an attach followed by a detach could
   * leave the visualization attached.
   *
   * Running the two jobs one after the other would make an attach wait for
   * the execution, which the deferral is there to avoid. Instead each request
   * takes a number when its command is created, on the thread that receives
   * the requests and so in their order (`nextRequestOrder`), and the jobs
   * change a visualization only through the `*InRequestOrder` methods. These
   * apply a change, and record its number, only when no later request has
   * changed that visualization of that expression yet, all under this
   * holder's lock. An overtaken change is dropped, which leaves the
   * visualization as the later request left it: the outcome of running them
   * in order.
   *
   * The key includes the expression because the visualizations of different
   * expressions are separate entries here, and a detach of one does not touch
   * the other. A key is kept after its detach, so that a stale attach is
   * still dropped: one entry per visualization attached in the context,
   * which go with the context.
   *
   * Changes that do not come from a request (an execution evaluating a
   * deferred visualization, a recompilation re-evaluating one) do not take
   * part: they work on what the requests left in the holder.
   */

  /** Applies a change made for the request numbered `requestOrder`, unless a
    * later request has already changed the visualization.
    *
    * @return whether the change was applied
    */
  private def inRequestOrder(
    visualizationId: VisualizationId,
    expressionId: ExpressionId,
    requestOrder: Long
  )(change: => Unit): Boolean = synchronized {
    val key = (visualizationId, expressionId)
    if (latestRequestOrder.get(key).exists(_ > requestOrder)) {
      false
    } else {
      latestRequestOrder.update(key, requestOrder)
      change
      true
    }
  }

  /** Upserts a visualization for the request numbered `requestOrder`, unless
    * a later request has already changed it (Note [Visualization Requests
    * Take Effect In The Order They Arrived]).
    *
    * @return whether the visualization was upserted
    */
  def upsertInRequestOrder(
    visualization: Visualization,
    requestOrder: Long
  ): Boolean =
    inRequestOrder(visualization.id, visualization.expressionId, requestOrder)(
      upsert(visualization)
    )

  /** Upserts an unevaluated visualization for the request numbered
    * `requestOrder`, unless a later request has already changed it (Note
    * [Visualization Requests Take Effect In The Order They Arrived]).
    *
    * @return whether the visualization was upserted
    */
  def upsertUnevaluatedInRequestOrder(
    unevaluated: UnevaluatedVisualization,
    requestOrder: Long
  ): Boolean =
    inRequestOrder(unevaluated.id, unevaluated.expressionId, requestOrder)(
      upsertUnevaluated(unevaluated)
    )

  /** Removes a visualization, evaluated or not, for the request numbered
    * `requestOrder`, unless a later request has already changed it (Note
    * [Visualization Requests Take Effect In The Order They Arrived]).
    *
    * @return whether the visualization was removed
    */
  def removeInRequestOrder(
    visualizationId: VisualizationId,
    expressionId: ExpressionId,
    requestOrder: Long
  ): Boolean =
    inRequestOrder(visualizationId, expressionId, requestOrder) {
      removeUnevaluated(visualizationId, expressionId)
      remove(visualizationId, expressionId)
    }

  /** Upserts a visualization.
    *
    * @param visualization the visualization to upsert
    * @param specificId UUID to attach visualization to
    */
  def upsert(
    visualization: Visualization,
    specificId: ExpressionId = null
  ): Unit = synchronized {
    val id = if (specificId == null) {
      visualization.expressionId
    } else {
      specificId
    }
    val visualizations = visualizationMap(id)
    val rest           = visualizations.filterNot(_.id == visualization.id)
    visualizationMap.update(id, visualization :: rest)
  }

  /** Removes a visualization from the holder.
    *
    * @param visualizationId the visualization identifier
    * @param expressionId the id of expression that the visualization is
    *                     attached to
    */
  def remove(
    visualizationId: VisualizationId,
    expressionId: ExpressionId
  ): Unit = synchronized {
    val visualizations = visualizationMap(expressionId)
    val rest           = visualizations.filterNot(_.id == visualizationId)
    visualizationMap.update(expressionId, rest)
  }

  /** Finds all visualizations attached to an expression.
    *
    * @param expressionId the unique identifier of the expression
    * @return a list of matching visualization
    */
  @CompilerDirectives.TruffleBoundary
  def find(expressionId: ExpressionId): List[Visualization] = synchronized {
    visualizationMap(expressionId)
  }

  /** Finds all visualizations in a given module.
    *
    * @param module the qualified module name
    * @return a list of matching visualization
    */
  def findByModule(
    module: QualifiedName
  ): Iterable[Visualization] = synchronized {
    visualizationMap.values.flatten.collect {
      case visualization: Visualization
          if visualization.module.getName == module =>
        visualization
    }.toList
  }

  /** Returns a visualization with the provided id.
    *
    * @param visualizationId the identifier of visualization
    * @return an option with visualization
    */
  def getById(visualizationId: VisualizationId): Option[Visualization] =
    synchronized {
      visualizationMap.values.flatten.find(_.id == visualizationId)
    }

  /** @return all available visualizations. */
  def getAll: Iterable[Visualization] = synchronized {
    visualizationMap.values.flatten.toList
  }

  /** @return the oneshot expression attached to the `expressionId`. */
  def getOneshotExpression(
    expressionId: ExpressionId
  ): OneshotExpression = synchronized {
    oneshotExpressions.remove(expressionId).orNull
  }

  /** Set oneshot expression for execution. */
  def setOneshotExpression(oneshotExpression: OneshotExpression): Unit =
    synchronized {
      this.oneshotExpressions
        .put(oneshotExpression.expressionId, oneshotExpression)
    }

  /** Returns an unevaluated visualization with the provided id.
    *
    * @param visualizationId the identifier of visualization
    * @return an option with unevaluated visualization
    */
  def getUnevaluatedById(
    visualizationId: VisualizationId
  ): Option[UnevaluatedVisualization] =
    synchronized {
      unevaluatedMap.values.flatten.find(_.id == visualizationId)
    }

  /** Upserts an unevaluated visualization. Multiple can exist per expression. */
  def upsertUnevaluated(unevaluated: UnevaluatedVisualization): Unit =
    synchronized {
      val existing = unevaluatedMap(unevaluated.expressionId)
      val rest     = existing.filterNot(_.id == unevaluated.id)
      unevaluatedMap.update(unevaluated.expressionId, unevaluated :: rest)
    }

  /** Removes an unevaluated visualization by ID from a specific expression.
    *
    * @param visualizationId the visualization identifier
    * @param expressionId the id of expression that the visualization is attached to
    * @return the removed unevaluated visualization, if found
    */
  def removeUnevaluated(
    visualizationId: VisualizationId,
    expressionId: ExpressionId
  ): Option[UnevaluatedVisualization] = synchronized {
    val existing        = unevaluatedMap(expressionId)
    val (removed, rest) = existing.partition(_.id == visualizationId)
    unevaluatedMap.update(expressionId, rest)
    removed.headOption
  }

  /** Gets all unevaluated visualizations for an expression.
    *
    * @param expressionId the unique identifier of the expression
    * @return a list of matching unevaluated visualizations
    */
  @CompilerDirectives.TruffleBoundary
  def findUnevaluated(
    expressionId: ExpressionId
  ): List[UnevaluatedVisualization] = synchronized {
    unevaluatedMap(expressionId)
  }

  /** Gets all unevaluated visualizations across all expressions. */
  @CompilerDirectives.TruffleBoundary
  def getAllUnevaluated: Iterable[UnevaluatedVisualization] = synchronized {
    unevaluatedMap.values.flatten.toList
  }

  /** Checks if there are any pending unevaluated visualizations.
    *
    * @return true if there are pending visualizations to process
    */
  def hasPendingVisualizations: Boolean = synchronized {
    unevaluatedMap.values.exists(_.nonEmpty)
  }

  /** Registers a nested visualization for a subexpression.
    *
    * @param nodeID the expression id to register
    */
  @CompilerDirectives.TruffleBoundary
  def upsertNestedVisualization(nodeID: ExpressionId): Unit = {
    pendingSubExpressionVisualizations.add(nodeID)
  }

  /** Checks if there is a pending nested visualization for the given expression.
    * If found, removes it from the pending set.
    *
    * @param nodeID the expression id to check
    * @return true if a nested visualization was pending for this expression
    */
  @CompilerDirectives.TruffleBoundary
  def checkAndClearNestedVisualizations(nodeID: ExpressionId): Boolean = {
    pendingSubExpressionVisualizations.remove(nodeID)
  }
}

object VisualizationHolder {

  private val requestCounter = new AtomicLong()

  /** Numbers a visualization request in the order the requests arrive (Note
    * [Visualization Requests Take Effect In The Order They Arrived]). Call it
    * when the request's command is created.
    */
  def nextRequestOrder(): Long = requestCounter.incrementAndGet()

  /** Returns an empty visualization holder. */
  def empty = new VisualizationHolder
}
