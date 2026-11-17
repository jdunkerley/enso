package org.enso.interpreter.test.semantic

import org.enso.interpreter.runtime.EnsoContext
import org.enso.interpreter.test.{
  InterpreterContext,
  InterpreterException,
  InterpreterTest
}
import org.enso.common.{LanguageInfo, MethodNames}

import scala.ref.WeakReference
import org.graalvm.polyglot.Context
import org.enso.common.RuntimeOptions
import org.enso.runtime.utils.ThreadUtils

import java.util.concurrent.TimeUnit

class RuntimeManagementTest extends InterpreterTest {
  private def parallelism = 5

  override def subject: String = "Enso Code Execution"

  override def contextModifiers: Option[Context#Builder => Context#Builder] =
    Some(b => {
      b.allowCreateThread(true)
        .option(RuntimeOptions.GUEST_PARALLELISM, "" + parallelism)
    })

  /** How long any single wait in these tests may take. A passing run takes
    * about two seconds per test, even on Windows CI.
    */
  private val waitTimeoutSeconds = 120L

  private def failWithThreadDump(message: String): Nothing =
    fail(ThreadUtils.dumpAllStacktraces(message))

  /** Waits for `f` and returns how it ended: `Left` with the exception it
    * failed with, or `Right` with its value. A timeout fails the test with a
    * thread dump. It must not run inside `intercept`, which would replace the
    * dump with its own message.
    */
  private def awaitOutcome[T](
    f: java.util.concurrent.Future[T]
  ): Either[java.util.concurrent.ExecutionException, T] =
    try {
      Right(f.get(waitTimeoutSeconds, TimeUnit.SECONDS))
    } catch {
      case ex: java.util.concurrent.ExecutionException => Left(ex)
      case _: java.util.concurrent.TimeoutException =>
        failWithThreadDump(
          s"A guest thread did not finish within $waitTimeoutSeconds seconds."
        )
    }

  /** Waits until `marker` occurs `count` times in the output so far. It never
    * resets the output, so it cannot lose a write; see Note [Waiting For The
    * Guest Threads To Start].
    */
  private def awaitOutput(marker: String, count: Int)(implicit
    interpreterContext: InterpreterContext
  ): Unit = {
    val deadline =
      System.nanoTime() + TimeUnit.SECONDS.toNanos(waitTimeoutSeconds)
    def seen = java.util.regex.Pattern
      .compile(java.util.regex.Pattern.quote(marker))
      .matcher(interpreterContext.output().toString)
      .results()
      .count()
    while (seen < count) {
      if (System.nanoTime() > deadline) {
        failWithThreadDump(
          s"Saw $seen of $count '$marker' within $waitTimeoutSeconds seconds."
        )
      }
      Thread.sleep(10)
    }
  }

  override def specify(implicit
    interpreterContext: InterpreterContext
  ): Unit = {

    "Interrupt threads through Thread#interrupt()" in {
      val langCtx = interpreterContext
        .ctx()
        .getBindings(LanguageInfo.ID)
        .invokeMember(MethodNames.TopScope.LEAK_CONTEXT)
        .asHostObject[EnsoContext]()

      val code =
        """import Standard.Base.Runtime.Thread
          |import Standard.Base.IO
          |import Standard.Base.Nothing
          |import Standard.Base.Data.Numbers.Number
          |
          |foo x =
          |    if x == 0 then IO.println "Start." else Nothing
          |    @Tail_Call foo x+1
          |
          |main =
          |    Thread.with_interrupt_handler (foo 0) (IO.println "Interrupted.")
          |""".stripMargin

      val main = getMain(code)

      def runMain(): java.util.concurrent.Future[org.graalvm.polyglot.Value] =
        langCtx.getThreadManager.submit(() => {
          main.execute()
        })

      // Note [Waiting For The Guest Threads To Start]
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // The threads must all be running `foo` before `interruptThreads` is
      // called: a thread that has not started yet is not flagged, so it is
      // never interrupted and loops forever, and `f.get()` waits for it
      // forever. This used to be decided by counting the lines that
      // `consumeOut` returned, which races with the guest threads (#741):
      // - `consumeOut` is `toString` followed by `reset`, two separate calls,
      //   so a "Start." written between them is thrown away. The count then
      //   never reaches `parallelism` and the loop spins forever. This is the
      //   hang seen on Windows CI: a stress run of the old loop lost a line
      //   in about 1 in 600 rounds with the JVM pinned to 4 CPUs, as on the
      //   CI runners, and never with 32.
      // - `println` writes the text and the line separator as two writes, so
      //   a `toString` between them sees "Start." and, on the next round, a
      //   bare separator, which `linesIterator` counts as a second (empty)
      //   line. The count can then reach `parallelism` while a thread has not
      //   started, and that thread is never interrupted. Not observed, but
      //   nothing prevents it.
      // Counting complete "Start." markers in the whole output, without
      // resetting it, is immune to both. Every wait is bounded and fails with
      // a thread dump.
      def runTest(): Unit = {
        val futures = 0.until(parallelism).map(_ => runMain())
        awaitOutput("Start.", parallelism)
        langCtx.getThreadManager.interruptThreads()
        futures.foreach(f => {
          val ex = awaitOutcome(f) match {
            case Left(ex) => ex
            case Right(v) => fail("Unexpected value: " + v)
          }
          ex.getMessage() shouldEqual "org.enso.interpreter.test.InterpreterException: org.enso.interpreter.runtime.control.ThreadInterruptedException"
        })
        val out = consumeOut
        out.filter(_ == "Start.") shouldEqual List.fill(parallelism)("Start.")
        out.filter(
          _ != "Start."
        ) shouldEqual List.fill(parallelism)("Interrupted.")
        futures.forall(_.isDone) shouldBe true
      }

      runTest()
      runTest()
    }

    "Interrupt a thread that is running a finalizer" in {
      // See Note [A Finalizer Delays Thread Interrupts] in ResourceManager.
      val langCtx = interpreterContext
        .ctx()
        .getBindings(LanguageInfo.ID)
        .invokeMember(MethodNames.TopScope.LEAK_CONTEXT)
        .asHostObject[EnsoContext]()

      val code =
        """import Standard.Base.Runtime.Thread
          |import Standard.Base.IO
          |import Standard.Base.Nothing
          |import Standard.Base.Data.Numbers.Number
          |from Standard.Base.Runtime.Managed_Resource import Managed_Resource
          |
          |type Mock_File
          |    Value i
          |
          |wait_for flag = if flag.get then Nothing else @Tail_Call wait_for flag
          |
          |finalizer flag _ =
          |    IO.println "Finalizing."
          |    wait_for flag
          |    IO.println "Finalized."
          |
          |foo flag x =
          |    if x == 0 then Managed_Resource.register (Mock_File.Value x) (finalizer flag) else Nothing
          |    @Tail_Call foo flag x+1
          |
          |main flag =
          |    Thread.with_interrupt_handler (foo flag 0) (IO.println "Interrupted.")
          |""".stripMargin

      consumeOut
      val main = getMain(code)
      // The finalizer runs on the guest thread and does not return until the
      // interrupt has been requested, so the interrupt arrives while it runs.
      val flag   = new java.util.concurrent.atomic.AtomicBoolean(false)
      val future = langCtx.getThreadManager.submit(() => main.execute(flag))
      val deadline =
        System.nanoTime() + TimeUnit.SECONDS.toNanos(waitTimeoutSeconds)
      while (!interpreterContext.output().toString.contains("Finalizing.")) {
        if (System.nanoTime() > deadline) {
          failWithThreadDump(
            s"The finalizer did not start within $waitTimeoutSeconds seconds."
          )
        }
        System.gc()
        Thread.sleep(10)
      }
      // The flag is set right after the interrupt, so without the fix the guest
      // could in rare runs read it and leave `wait_for` before its next poll; the
      // root-node return and `IO.println "Finalized."` still poll inside the
      // finalizer, so the unfixed code almost always fails here. With the fix the
      // test is deterministic.
      langCtx.getThreadManager.interruptThreads()
      flag.set(true)

      val ex = awaitOutcome(future) match {
        case Left(ex) => ex
        case Right(v) => fail("Unexpected value: " + v)
      }
      ex.getMessage() shouldEqual "org.enso.interpreter.test.InterpreterException: org.enso.interpreter.runtime.control.ThreadInterruptedException"
      consumeOut shouldEqual List("Finalizing.", "Finalized.", "Interrupted.")
      interpreterContext
        .err()
        .toString should not include "Exception in finalizer"
    }

    // The next three tests cover Note [A Thread Interrupt Is Sticky] in
    // ThreadManager (#834).
    val interruptedMessage =
      "org.enso.interpreter.test.InterpreterException: org.enso.interpreter.runtime.control.ThreadInterruptedException"

    def leakContext(): EnsoContext = interpreterContext
      .ctx()
      .getBindings(LanguageInfo.ID)
      .invokeMember(MethodNames.TopScope.LEAK_CONTEXT)
      .asHostObject[EnsoContext]()

    "Interrupt a thread again when it loses the interrupt" in {
      // GraalVM 25.5 can lose the exception that the interrupt throws, and the
      // guest loop then carries on. Swallowing the first exception in host code
      // and running the loop again stands in for that loss, deterministically.
      val langCtx = leakContext()
      val code =
        """import Standard.Base.IO
          |import Standard.Base.Nothing
          |import Standard.Base.Data.Numbers.Number
          |
          |foo x =
          |    if x == 0 then IO.println "Start." else Nothing
          |    @Tail_Call foo x+1
          |
          |main = foo 0
          |""".stripMargin

      consumeOut
      val main      = getMain(code)
      val swallowed = new java.util.concurrent.atomic.AtomicBoolean(false)
      val future: java.util.concurrent.Future[org.graalvm.polyglot.Value] =
        langCtx.getThreadManager.submit(() => {
          var result: Option[org.graalvm.polyglot.Value] = None
          while (result.isEmpty) {
            try {
              result = Some(main.execute())
            } catch {
              case ex: InterpreterException
                  if ex.getMessage.contains("ThreadInterruptedException") &&
                  !swallowed.get() =>
                swallowed.set(true)
            }
          }
          result.get
        })
      awaitOutput("Start.", 1)
      langCtx.getThreadManager.interruptThreads()

      val ex = awaitOutcome(future) match {
        case Left(ex) => ex
        case Right(v) => fail("Unexpected value: " + v)
      }
      swallowed.get() shouldBe true
      ex.getMessage() shouldEqual interruptedMessage
      // The second run is interrupted at its first poll, which may come before
      // or after it prints.
      consumeOut.distinct shouldEqual List("Start.")
    }

    "Run new guest code on the threads of an interrupted task" in {
      val langCtx = leakContext()
      val code =
        """import Standard.Base.IO
          |import Standard.Base.Nothing
          |import Standard.Base.Data.Numbers.Number
          |
          |foo x =
          |    if x == 0 then IO.println "Start." else Nothing
          |    @Tail_Call foo x+1
          |
          |count n = if n == 0 then "Done." else @Tail_Call count n-1
          |
          |main n = if n == 0 then foo 0 else count n
          |""".stripMargin

      consumeOut
      val main = getMain(code)
      // As many looping tasks as threads, so every thread is interrupted.
      val looping = 0
        .until(parallelism)
        .map(_ =>
          langCtx.getThreadManager.submit(() => {
            main.execute(Long.box(0))
          }): java.util.concurrent.Future[org.graalvm.polyglot.Value]
        )
      awaitOutput("Start.", parallelism)
      langCtx.getThreadManager.interruptThreads()
      looping.foreach(f =>
        awaitOutcome(f) match {
          case Left(ex) => ex.getMessage() shouldEqual interruptedMessage
          case Right(v) => fail("Unexpected value: " + v)
        }
      )

      // The latch keeps every task waiting until all have started, so they
      // run on all the threads, including each thread interrupted above. A
      // thread still carrying the interrupt would fail at its first poll.
      val started = new java.util.concurrent.CountDownLatch(parallelism)
      val counting = 0
        .until(parallelism)
        .map(_ =>
          langCtx.getThreadManager.submit(() => {
            started.countDown()
            started.await(waitTimeoutSeconds, TimeUnit.SECONDS)
            main.execute(Long.box(1000000))
          }): java.util.concurrent.Future[org.graalvm.polyglot.Value]
        )
      counting.foreach(f =>
        awaitOutcome(f) match {
          case Left(ex) => fail("Unexpected failure", ex)
          case Right(v) => v.asString() shouldEqual "Done."
        }
      )
      consumeOut shouldEqual List.fill(parallelism)("Start.")
    }

    "Run an interrupt handler and a bracket destructor to completion" in {
      // Both run guest code while the interrupt unwinds the thread, so the
      // interrupt must not be delivered again until they return.
      val langCtx = leakContext()
      val code =
        """import Standard.Base.Runtime.Thread
          |import Standard.Base.IO
          |import Standard.Base.Nothing
          |import Standard.Base.Data.Numbers.Number
          |from Standard.Base.Runtime.Managed_Resource import Managed_Resource
          |
          |foo x =
          |    if x == 0 then IO.println "Start." else Nothing
          |    @Tail_Call foo x+1
          |
          |count n = if n == 0 then Nothing else @Tail_Call count n-1
          |
          |close _ =
          |    IO.println "Closing."
          |    count 100000
          |    IO.println "Closed."
          |
          |handler =
          |    IO.println "Handling."
          |    count 100000
          |    IO.println "Handled."
          |
          |main =
          |    Thread.with_interrupt_handler (Managed_Resource.bracket Nothing (r-> close r) (_-> foo 0)) handler
          |""".stripMargin

      consumeOut
      val main = getMain(code)
      val future: java.util.concurrent.Future[org.graalvm.polyglot.Value] =
        langCtx.getThreadManager.submit(() => {
          main.execute()
        })
      awaitOutput("Start.", 1)
      langCtx.getThreadManager.interruptThreads()

      val ex = awaitOutcome(future) match {
        case Left(ex) => ex
        case Right(v) => fail("Unexpected value: " + v)
      }
      ex.getMessage() shouldEqual interruptedMessage
      consumeOut shouldEqual List(
        "Start.",
        "Closing.",
        "Closed.",
        "Handling.",
        "Handled."
      )
    }

    /** Don't use this in production code, ever.
      */
    def forceGC(): Unit = {
      var obj = new Object
      val ref = new WeakReference[Object](obj)
      obj = null
      while (ref.get.isDefined) {
        System.gc()
      }
    }

    def consumeWithGC(expect: Int): List[String] = {
      forceGC()
      var round                  = 0
      var totalOut: List[String] = Nil
      totalOut = consumeOut
      while (totalOut.length < expect && round < 500) {
        round = round + 1
        if (round % 10 == 0) {
          forceGC();
        }
        val res = eval("main a b = a + b").execute("Hello", "Enso")
        assertResult("HelloEnso")(res.asString)
        Thread.sleep(100)
        totalOut ++= consumeOut
      }
      totalOut
    }

    "Automatically free managed resources" in {
      val code =
        """
          |from Standard.Base.Runtime.Managed_Resource import Managed_Resource
          |from Standard.Base import IO, to_text
          |
          |type Mock_File
          |    Value i
          |
          |free_resource r = IO.println ("Freeing: " + r.to_text)
          |
          |create_resource i =
          |    c = Mock_File.Value i
          |    r = Managed_Resource.register c free_resource
          |    r . with f-> IO.println ("Accessing: " + f.to_text)
          |
          |main =
          |    create_resource 0
          |    create_resource 1
          |    create_resource 2
          |    create_resource 3
          |    create_resource 4
          |""".stripMargin
      eval(code)
      val totalOut = consumeWithGC(10)

      def mkAccessStr(i: Int): String = s"Accessing: (Mock_File.Value $i)"
      def mkFreeStr(i: Int): String   = s"Freeing: (Mock_File.Value $i)"
      def all                         = 0.to(4).map(mkAccessStr) ++ 0.to(4).map(mkFreeStr)
      totalOut should contain theSameElementsAs all
    }

    "Automatically free managed resources amongst manual closure of other managed resources" in {
      val code =
        """
          |from Standard.Base.Runtime.Managed_Resource import Managed_Resource
          |from Standard.Base import IO, Nothing, Number, to_text
          |
          |type Mock_File
          |    Value i
          |
          |free_resource r = IO.println ("Freeing: " + r.to_text)
          |
          |create_resource i =
          |    c = Mock_File.Value i
          |    r = Managed_Resource.register c free_resource
          |    r . with f-> IO.println ("Accessing: " + f.to_text)
          |    if i % 2 == 0 then r.finalize else Nothing
          |
          |main =
          |    create_resource 0
          |    create_resource 1
          |    create_resource 2
          |    create_resource 3
          |    create_resource 4
          |""".stripMargin
      eval(code)
      val totalOut = consumeWithGC(10)

      def mkAccessStr(i: Int): String = s"Accessing: (Mock_File.Value $i)"
      def mkFreeStr(i: Int): String   = s"Freeing: (Mock_File.Value $i)"
      def all                         = 0.to(4).map(mkAccessStr) ++ 0.to(4).map(mkFreeStr)
      totalOut should contain theSameElementsAs all
    }

    "Automatically free managed resources amongst manual takeover of other managed resources" in {
      val code =
        """
          |from Standard.Base.Runtime.Managed_Resource import Managed_Resource
          |from Standard.Base import IO, Nothing, to_text, Number
          |
          |type Mock_File
          |    Value i
          |
          |free_resource r = IO.println ("Freeing: " + r.to_text)
          |
          |create_resource i =
          |    c = Mock_File.Value i
          |    r = Managed_Resource.register c free_resource
          |    r . with f-> IO.println ("Accessing: " + f.to_text)
          |    if i % 2 == 0 then r.take else Nothing
          |
          |main =
          |    create_resource 0
          |    create_resource 1
          |    create_resource 2
          |    create_resource 3
          |    create_resource 4
          |""".stripMargin
      eval(code)
      val totalOut = consumeWithGC(7)

      def mkAccessStr(i: Int): String = s"Accessing: (Mock_File.Value $i)"
      def mkFreeStr(i: Int): String   = s"Freeing: (Mock_File.Value $i)"
      def all                         = 0.to(4).map(mkAccessStr) ++ List(1, 3).map(mkFreeStr)
      totalOut should contain theSameElementsAs all
    }

    "Allow for multithreaded polyglot class loading" in {
      val langCtx = interpreterContext
        .ctx()
        .getBindings(LanguageInfo.ID)
        .invokeMember(MethodNames.TopScope.LEAK_CONTEXT)
        .asHostObject[EnsoContext]()

      val code =
        """import Standard.Base.Data.Numbers
          |polyglot java import org.enso.example.TestClass
          |main =
          |    instance = TestClass.new (x -> x * 2)
          |    instance.callFunctionAndIncrement 10
          |""".stripMargin

      val main = getMain(code)

      def runMain()
        : java.util.concurrent.CompletableFuture[org.graalvm.polyglot.Value] =
        langCtx.getThreadManager.submit(() => {
          main.execute()
        })

      def runTest(): Unit = {
        val futures = 0.until(parallelism).map(_ => runMain())
        val combinedFuture = java.util.concurrent.CompletableFuture
          .allOf(futures: _*)
          .thenApply(_ => {
            futures
              .map(_.get(10, java.util.concurrent.TimeUnit.SECONDS).asInt())
          })
        val result =
          combinedFuture.get(20, java.util.concurrent.TimeUnit.SECONDS)
        result should equal(List(21, 21, 21, 21, 21))
        futures.forall(_.isDone) shouldBe true
      }

      runTest()
    }
  }
}
