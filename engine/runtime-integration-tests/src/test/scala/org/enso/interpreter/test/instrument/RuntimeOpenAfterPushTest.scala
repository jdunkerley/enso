package org.enso.interpreter.test.instrument

import org.enso.common.{LanguageInfo, MethodNames, RuntimeOptions}
import org.enso.interpreter.runtime.{EnsoContext, Module}
import org.enso.interpreter.test.Metadata
import org.enso.logger.ObservedMessage
import org.enso.polyglot.RuntimeServerInfo
import org.enso.polyglot.runtime.Runtime.Api
import org.graalvm.polyglot.Context
import org.scalatest.BeforeAndAfterEach
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers
import org.slf4j.{Logger, LoggerFactory}

import java.io.{ByteArrayOutputStream, File}
import java.nio.file.{Files, Paths}
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

import scala.jdk.CollectionConverters._

/** A client may push an execution context for a module before it opens the
  * module's file: the IDE's execution context and its ydoc server talk to the
  * language server over two connections, and nothing orders the two. The push
  * compiles the module from disk, which asks for the module's IR to be
  * serialised in the background; the open then gives the module the client's
  * contents before that serialisation has run.
  *
  * When those contents are the ones the module was compiled from, the module
  * keeps its compiled state (#506). When they differ, it needs compiling
  * again, and the serialisation must not store its stale IR (#505).
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

    lazy val languageContext: EnsoContext = context
      .getBindings(LanguageInfo.ID)
      .invokeMember(MethodNames.TopScope.LEAK_CONTEXT)
      .asHostObject[EnsoContext]

    def writeInSrcDir(moduleName: String, contents: String): File = {
      val file = new File(pkg.sourceDir, s"$moduleName.enso")
      Files.write(file.toPath, contents.getBytes).toFile
    }
  }

  private val logged                   = new CopyOnWriteArrayList[ObservedMessage]()
  private var observing: AutoCloseable = _

  private val moduleName = "Enso_Test.Test.Main"

  /* Each test gets its own expression ids, and so its own source text: the IR
   * cache is per user and keyed on the module's name and the digest of its
   * source, so with the same text a later test would load the module from the
   * cache instead of compiling it, and nothing would be queued to serialise.
   */
  private var idResult: UUID       = _
  private var code: String         = _
  private var changedCode: String  = _
  private var largeCode: String    = _
  private var largeChanged: String = _

  private def withIds(
    metadata: Metadata,
    value: Int,
    rest: String = ""
  ): String =
    metadata.appendToCode(
      s"""main =
         |    x = $value
         |    x
         |""".stripMargin.linesIterator.mkString("\n") + rest
    )

  /** Methods enough to keep the module compiling for a while after it has
    * read its text, so that an open can arrive in the middle.
    */
  private val manyMethods: String =
    (1 to 3000).map(i => s"\nf$i x = x + $i").mkString

  private val visualizationCode =
    new Metadata("from Standard.Base import to_text\n\n").appendToCode(
      """
        |encode x = x.to_text
        |""".stripMargin.linesIterator.mkString("\n")
    )

  override protected def beforeEach(): Unit = {
    logged.clear()
    observing = ObservedMessage.observe(
      LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME),
      m => logged.add(m)
    )
    val metadata = new Metadata
    idResult = metadata.addItem(22, 1)
    // The module as it is on disk.
    code = withIds(metadata, 42)
    // The module as a client that edited it might open it: the same length,
    // so the expression ids in the metadata still point at `x`.
    changedCode = withIds(metadata, 43)
    // The same module with a few thousand more methods, which take long
    // enough to compile for the open to arrive while they compile.
    largeCode    = withIds(metadata, 42, manyMethods)
    largeChanged = withIds(metadata, 43, manyMethods)
    context      = new TestContext("Test")
    context.writeInSrcDir("Visualization", visualizationCode)
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

  private def mainModule: Module =
    context.languageContext.findModule(moduleName).orElseThrow()

  /** Creates a context and pushes `main` with the module still closed, so it
    * compiles from disk. Returns the context id and the type of `x`.
    */
  private def pushBeforeOpen(): (UUID, Api.ExpressionType) = {
    context.writeMain(code)
    val (contextId, requestId) = startPush()
    val pushed                 = receiveUntilExecutionComplete(contextId)
    pushed should contain(
      Api.Response(requestId, Api.PushContextResponse(contextId))
    )
    pushed.last shouldEqual context.executionComplete(contextId)
    val integer = valueOf(pushed, idResult).flatMap(_.expressionType)
    integer should not be empty
    (contextId, integer.get)
  }

  /** Creates a context and pushes `main`, without waiting for the push to
    * finish. Returns the context id and the push's request id.
    */
  private def startPush(): (UUID, UUID) = {
    val contextId = UUID.randomUUID()
    val requestId = UUID.randomUUID()
    context.send(Api.Request(requestId, Api.CreateContextRequest(contextId)))
    context.receive shouldEqual Some(
      Api.Response(requestId, Api.CreateContextResponse(contextId))
    )
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
    (contextId, requestId)
  }

  /** Pushes `main` of the large module and waits until its compilation has
    * read the module's text, so that it is compiling from that text.
    */
  private def pushLargeAndWaitForCompilation(): UUID = {
    context.writeMain(largeCode)
    val (contextId, _) = startPush()
    val deadline       = System.currentTimeMillis() + 60000
    def hasReadText: Boolean =
      context.languageContext
        .findModule(moduleName)
        .filter(_.getLiteralSource != null)
        .isPresent
    while (!hasReadText && System.currentTimeMillis() < deadline) {
      Thread.sleep(1)
    }
    withClue("the compilation never read the module: ") {
      mainModule.getLiteralSource should not be null
    }
    withClue("the module compiled before the open could be sent: ") {
      mainModule.needsCompilation() shouldBe true
    }
    contextId
  }

  /** Sends an open and receives messages until its answer. Returns the
    * messages that came before it.
    */
  private def openDuringCompilation(
    contents: String
  ): List[Api.Response] = {
    val requestId = UUID.randomUUID()
    context.send(
      Api.Request(
        requestId,
        Api.OpenFileRequest(context.pkg.mainFile, contents)
      )
    )
    val before   = List.newBuilder[Api.Response]
    var answered = false
    while (!answered) {
      context.receiveWithTimeout(120) match {
        case Some(Api.Response(Some(`requestId`), Api.OpenFileResponse)) =>
          answered = true
        case Some(r) => before += r
        case None    => fail("Timed out waiting for the open")
      }
    }
    before.result()
  }

  private def open(contents: String): Unit = {
    val requestId = UUID.randomUUID()
    context.send(
      Api.Request(
        requestId,
        Api.OpenFileRequest(context.pkg.mainFile, contents)
      )
    )
    context.receive shouldEqual Some(
      Api.Response(Some(requestId), Api.OpenFileResponse)
    )
  }

  /** Starts background processing, which runs the queued serialisation, and
    * waits for it to end. It must end without an error.
    */
  private def runQueuedSerialization(): Unit = {
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
    serializationOutcome.map(_.getFormattedMessage) should not be empty
    serializationOutcome.map(_.getFormattedMessage).get should not include
    "Error executing"
  }

  private def recompute(contextId: UUID): List[Api.Response] = {
    val requestId = UUID.randomUUID()
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
    recomputed
  }

  /** Attaches a visualisation of `x` and returns the data it first sends. */
  private def visualizeResult(contextId: UUID): String = {
    val requestId       = UUID.randomUUID()
    val visualizationId = UUID.randomUUID()
    context.send(
      Api.Request(
        requestId,
        Api.AttachVisualization(
          visualizationId,
          idResult,
          Api.VisualizationConfiguration(
            contextId,
            Api.VisualizationExpression.Text(
              "Enso_Test.Test.Visualization",
              "x -> encode x",
              Vector()
            ),
            "Enso_Test.Test.Visualization"
          )
        )
      )
    )
    var attached          = false
    var data: Array[Byte] = null
    while (!attached || data == null) {
      // The first visualisation compiles Standard.Base, which can take longer
      // than the default wait for a message.
      context.receiveWithTimeout(120) match {
        case Some(
              Api.Response(Some(`requestId`), Api.VisualizationAttached())
            ) =>
          attached = true
        case Some(
              Api.Response(
                None,
                Api.VisualizationUpdate(
                  Api.VisualizationContext(`visualizationId`, `contextId`, _),
                  bytes
                )
              )
            ) =>
          data = bytes
        case Some(Api.Response(_, error: Api.Error)) =>
          fail(s"Attaching the visualisation failed: $error")
        case Some(_) =>
        case None =>
          fail("Timed out waiting for the visualisation")
      }
    }
    new String(data)
  }

  it should "keep a module opened after its context was pushed executable" in {
    val (contextId, integer) = pushBeforeOpen()

    // Then open it, with the contents the push compiled.
    open(code)

    // Only now let the queued serialisation run. With assertions off, as in a
    // release build, a module reset by the open was stored with its compiled
    // IR labelled as needing every pass again, and the next compilation
    // loaded that cache (#505).
    runQueuedSerialization()

    // The program still runs, and its value still reaches the client.
    val recomputed = recompute(contextId)
    valueOf(recomputed, idResult).flatMap(_.expressionType) shouldEqual Some(
      integer
    )
    visualizeResult(contextId) shouldEqual "42"
  }

  it should "not recompile a module opened with the contents it was compiled from" in {
    val (contextId, integer) = pushBeforeOpen()
    val compiled             = mainModule.getIr
    mainModule.needsCompilation() shouldBe false

    open(code)

    mainModule.needsCompilation() shouldBe false
    runQueuedSerialization()

    val recomputed = recompute(contextId)
    valueOf(recomputed, idResult).flatMap(_.expressionType) shouldEqual Some(
      integer
    )
    visualizeResult(contextId) shouldEqual "42"
    withClue("the module was compiled again: ") {
      (mainModule.getIr eq compiled) shouldBe true
    }
  }

  it should "answer an open with the text a module is compiling from without waiting for the compilation" in {
    val contextId = pushLargeAndWaitForCompilation()

    // The client opens the module with the text on disk, which the running
    // compilation read. Its answer must not wait for the compilation's write
    // lock: in the IDE the module's graph waits for this answer. So it
    // arrives before the push's execution, which starts only once the
    // compilation is done, has sent anything.
    val before = openDuringCompilation(largeCode)
    val fromExecution = before.collect {
      case r @ Api.Response(None, Api.ExpressionUpdates(`contextId`, _)) => r
      case r @ Api.Response(None, Api.ExecutionComplete(`contextId`))    => r
      case r @ Api.Response(None, Api.ExecutionFailed(`contextId`, _))   => r
    }
    withClue("the open waited for the compilation: ") {
      fromExecution shouldBe empty
    }

    // The open changed nothing: the push finishes and the program runs.
    val pushed = before ++ receiveUntilExecutionComplete(contextId)
    pushed.last shouldEqual context.executionComplete(contextId)
    valueOf(pushed, idResult).flatMap(_.expressionType) should not be empty
    mainModule.needsCompilation() shouldBe false
    visualizeResult(contextId) shouldEqual "42"
  }

  it should "apply an open with other text than a compiling module's after the compilation" in {
    val contextId = pushLargeAndWaitForCompilation()

    // Other text must not replace the module's under the compilation, so the
    // open still waits for it.
    val before = openDuringCompilation(largeChanged)

    // Once the compilation is done, the open and the push's execution both
    // wait only for the read compilation lock, so either can finish first.
    if (!before.contains(context.executionComplete(contextId))) {
      val pushed = receiveUntilExecutionComplete(contextId)
      pushed.last shouldEqual context.executionComplete(contextId)
    }
    recompute(contextId)
    visualizeResult(contextId) shouldEqual "43"
  }

  it should "recompile a module opened with contents other than those it was compiled from" in {
    val (contextId, integer) = pushBeforeOpen()
    val compiled             = mainModule.getIr

    open(changedCode)

    mainModule.needsCompilation() shouldBe true
    // The module changed since it was compiled, so the queued serialisation
    // must skip it (#505) rather than store its stale IR.
    runQueuedSerialization()

    val recomputed = recompute(contextId)
    valueOf(recomputed, idResult).flatMap(_.expressionType) shouldEqual Some(
      integer
    )
    visualizeResult(contextId) shouldEqual "43"
    (mainModule.getIr eq compiled) shouldBe false
  }
}
