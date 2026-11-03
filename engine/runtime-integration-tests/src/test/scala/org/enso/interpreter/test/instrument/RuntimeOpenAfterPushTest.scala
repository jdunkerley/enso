package org.enso.interpreter.test.instrument

import org.enso.common.{LanguageInfo, RuntimeOptions}
import org.enso.interpreter.test.Metadata
import org.enso.logger.ObservedMessage
import org.enso.polyglot.RuntimeServerInfo
import org.enso.polyglot.runtime.Runtime.Api
import org.graalvm.polyglot.Context
import org.scalatest.BeforeAndAfterEach
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers
import org.slf4j.{Logger, LoggerFactory}

import java.io.ByteArrayOutputStream
import java.nio.file.Paths
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

import scala.jdk.CollectionConverters._

/** A client may push an execution context for a module before it opens the
  * module's file: the IDE's execution context and its ydoc server talk to the
  * language server over two connections, and nothing orders the two. The push
  * compiles the module from disk, which asks for the module's IR to be
  * serialised in the background; the open then gives the module a literal
  * source, and so a module that needs compiling again, before that
  * serialisation has run.
  *
  * Background processing is started only after the open, so the serialisation
  * always runs after it, as it did in the IDE's failing launches.
  */
class RuntimeOpenAfterPushTest
    extends AnyFlatSpec
    with Matchers
    with BeforeAndAfterEach
    with org.enso.testkit.ReportLogsOnFailure {

  var context: TestContext = _

  class TestContext(packageName: String)
      extends InstrumentTestContext(packageName) {

    val out: ByteArrayOutputStream = new ByteArrayOutputStream()
    val context =
      Context
        .newBuilder(LanguageInfo.ID)
        .allowExperimentalOptions(true)
        .allowAllAccess(true)
        .option(RuntimeOptions.PROJECT_ROOT, pkg.root.getAbsolutePath)
        .option(
          RuntimeOptions.LOG_LEVEL,
          java.util.logging.Level.WARNING.getName
        )
        .option(RuntimeOptions.CHECK_CWD, "false")
        .option(
          RuntimeOptions.INTERPRETER_SEQUENTIAL_COMMAND_EXECUTION,
          "true"
        )
        .option(RuntimeOptions.ENABLE_PROJECT_SUGGESTIONS, "false")
        .option(RuntimeOptions.ENABLE_GLOBAL_SUGGESTIONS, "false")
        .option(RuntimeOptions.ENABLE_PROGRESS_REPORT, "false")
        .option(RuntimeOptions.ENABLE_EXECUTION_TIMER, "false")
        // The defect is in the IR cache, so it has to be on.
        .option(RuntimeOptions.DISABLE_IR_CACHES, "false")
        .option(RuntimeServerInfo.ENABLE_OPTION, "true")
        .option(RuntimeOptions.INTERACTIVE_MODE, "true")
        .option(
          RuntimeOptions.LANGUAGE_HOME_OVERRIDE,
          Paths.get("../../distribution/component").toFile.getAbsolutePath
        )
        .option(RuntimeOptions.EDITION_OVERRIDE, "0.0.0-dev")
        .out(out)
        .logHandler(System.err)
        .serverTransport(runtimeServerEmulator.makeServerTransport)
        .build()
  }

  private val logged                   = new CopyOnWriteArrayList[ObservedMessage]()
  private var observing: AutoCloseable = _

  override protected def beforeEach(): Unit = {
    logged.clear()
    observing = ObservedMessage.observe(
      LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME),
      m => logged.add(m)
    )
    context = new TestContext("Test")
    context.init()
    val Some(Api.Response(_, Api.InitializedNotification())) = context.receive
  }

  override protected def afterEach(): Unit = {
    if (context != null) {
      context.close()
      context.out.reset()
      context = null
    }
    if (observing != null) {
      observing.close()
      observing = null
    }
  }

  /** Receives responses until the execution of the context completes. */
  private def receiveUntilExecutionComplete(
    contextId: UUID
  ): List[Api.Response] = {
    val received = List.newBuilder[Api.Response]
    var done     = false
    while (!done) {
      context.receive match {
        case Some(r @ Api.Response(None, Api.ExecutionComplete(`contextId`))) =>
          received += r
          done = true
        case Some(
              r @ Api.Response(None, Api.ExecutionFailed(`contextId`, _))
            ) =>
          received += r
          done = true
        case Some(r) => received += r
        case None    => fail("Timed out waiting for the execution to complete")
      }
    }
    received.result()
  }

  private def valueOf(
    responses: List[Api.Response],
    expressionId: UUID
  ): Option[Api.ExpressionUpdate] =
    responses
      .collect { case Api.Response(None, Api.ExpressionUpdates(_, updates)) =>
        updates.filter(u =>
          u.expressionId == expressionId &&
          u.payload.isInstanceOf[Api.ExpressionUpdate.Payload.Value]
        )
      }
      .flatten
      .lastOption

  /** How the background serialisation of the module ended: the job engine
    * logs either that it finished or that it failed.
    */
  private def serializationOutcome: Option[ObservedMessage] =
    logged.asScala.find { m =>
      val text = m.getFormattedMessage
      text.contains("SerializeModuleJob(Enso_Test.Test.Main)") &&
      (text.contains("finished in") || text.contains("Error executing"))
    }

  it should "keep a module opened after its context was pushed executable" in {
    val contextId  = UUID.randomUUID()
    val requestId  = UUID.randomUUID()
    val moduleName = "Enso_Test.Test.Main"
    val metadata   = new Metadata
    val idResult   = metadata.addItem(22, 1)
    val code = metadata.appendToCode(
      """main =
        |    x = 42
        |    x
        |""".stripMargin.linesIterator.mkString("\n")
    )
    val mainFile = context.writeMain(code)

    context.send(Api.Request(requestId, Api.CreateContextRequest(contextId)))
    context.receive shouldEqual Some(
      Api.Response(requestId, Api.CreateContextResponse(contextId))
    )

    // Push before the file is open: the module compiles from disk, which
    // queues its serialisation as a background job.
    context.send(
      Api.Request(
        requestId,
        Api.PushContextRequest(
          contextId,
          Api.StackItem.ExplicitCall(
            Api.MethodPointer(moduleName, moduleName, "main"),
            None,
            Vector()
          )
        )
      )
    )
    val pushed = receiveUntilExecutionComplete(contextId)
    pushed should contain(
      Api.Response(requestId, Api.PushContextResponse(contextId))
    )
    pushed.last shouldEqual context.executionComplete(contextId)
    val integer = valueOf(pushed, idResult).flatMap(_.expressionType)
    integer should not be empty

    // Then open it, with the contents the push compiled.
    context.send(Api.Request(requestId, Api.OpenFileRequest(mainFile, code)))
    context.receive shouldEqual Some(
      Api.Response(Some(requestId), Api.OpenFileResponse)
    )

    // Only now let the queued serialisation run.
    context.send(
      Api.Request(UUID.randomUUID(), Api.StartBackgroundProcessing())
    )
    context.receive shouldEqual Some(
      Api.Response(Api.BackgroundJobsStartedNotification())
    )
    val deadline = System.currentTimeMillis() + 30000
    while (
      serializationOutcome.isEmpty && System.currentTimeMillis() < deadline
    ) {
      Thread.sleep(20)
    }
    // With assertions off, as in a release build, the job does not fail: it
    // writes the compiled IR labelled as needing every pass again, and the
    // next compilation loads that cache.
    serializationOutcome.map(_.getFormattedMessage) should not be empty
    serializationOutcome.map(_.getFormattedMessage).get should not include
    "Error executing"

    // The program still runs, and its value still reaches the client.
    context.send(
      Api.Request(
        requestId,
        Api.RecomputeContextRequest(
          contextId,
          Some(Api.InvalidatedExpressions.All()),
          None,
          Seq()
        )
      )
    )
    val recomputed = receiveUntilExecutionComplete(contextId)
    recomputed should contain(
      Api.Response(requestId, Api.RecomputeContextResponse(contextId))
    )
    recomputed.last shouldEqual context.executionComplete(contextId)
    valueOf(recomputed, idResult).flatMap(_.expressionType) shouldEqual integer
  }
}
