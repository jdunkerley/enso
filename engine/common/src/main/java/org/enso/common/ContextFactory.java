package org.enso.common;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Handler;
import java.util.logging.Level;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Engine;
import org.graalvm.polyglot.HostAccess;
import org.graalvm.polyglot.io.MessageTransport;

/**
 * Builder to create a new Graal polyglot context.
 *
 * @param projectRoot root of the project the interpreter is being run in (or empty if ran outside
 *     of any projects)
 * @param in the input stream for standard in
 * @param out the output stream for standard out
 * @param logLevel the log level for this context
 * @param enableIrCaches whether or not IR caching should be enabled
 * @param disablePrivateCheck If `private` keyword should be disabled.
 * @param enableStaticAnalysis whether or not to enable static type checking
 * @param strictErrors whether or not to use strict errors
 * @param disableLinting whether or not linting passes should run during compilation
 * @param useGlobalIrCacheLocation whether or not to use the global IR cache location
 * @param options additional options for the Context
 * @param executionEnvironment optional name of the execution environment to use during execution
 * @param warningsLimit maximal number of warnings reported to the user
 * @param checkForWarnings name of method to check for warnings
 * @param enableDebugServer enable debug (e.g. REPL) server
 */
public final class ContextFactory {
  private String projectRoot;
  private InputStream in = System.in;
  private OutputStream out = System.out;
  private OutputStream err = System.err;
  private MessageTransport messageTransport;
  private Level logLevel = Level.INFO;
  private boolean logMasking;
  private Handler logHandler;
  private boolean enableIrCaches;
  private boolean disablePrivateCheck;
  private boolean enableStaticAnalysis = false;
  private boolean treatWarningsAsErrors = false;
  private boolean strictErrors;
  private boolean disableLinting;
  private boolean enableAutoParallelism;
  private String executionEnvironment;
  private String checkForWarnings;
  private String pythonResourceDir;
  private int warningsLimit = 100;
  private java.util.Map<String, String> options = new HashMap<>();
  private String runtimerServerKey;
  private boolean enableDebugServer;

  /**
   * The system property a standby engine sets to its project's parent once it knows the project
   * (engine/runner `Standby`, Note [Standby Mode]): the context's working directory, which
   * `EnsoContext.checkWorkingDirectory` compares with the project's parent and against which Enso
   * resolves relative paths, as it did when the process ran in the project's parent.
   */
  public static final String WORKING_DIRECTORY_PROPERTY = "enso.context.workingDirectory";

  private String workingDirectory;

  private ContextFactory() {}

  public static ContextFactory create() {
    return new ContextFactory();
  }

  public ContextFactory projectRoot(String projectRoot) {
    this.projectRoot = projectRoot;
    return this;
  }

  public ContextFactory in(InputStream in) {
    this.in = in;
    return this;
  }

  public ContextFactory out(OutputStream out) {
    this.out = out;
    return this;
  }

  public ContextFactory err(OutputStream err) {
    this.err = err;
    return this;
  }

  public ContextFactory messageTransport(MessageTransport t) {
    this.messageTransport = t;
    return this;
  }

  public ContextFactory logLevel(Level logLevel) {
    this.logLevel = logLevel;
    return this;
  }

  public ContextFactory logMasking(boolean logMasking) {
    this.logMasking = logMasking;
    return this;
  }

  /** Overwrites the {@link JulHandler default} logging handler. */
  public ContextFactory logHandler(Handler handler) {
    this.logHandler = handler;
    return this;
  }

  public ContextFactory enableIrCaches(boolean enableIrCaches) {
    this.enableIrCaches = enableIrCaches;
    return this;
  }

  public ContextFactory disablePrivateCheck(boolean disablePrivateCheck) {
    this.disablePrivateCheck = disablePrivateCheck;
    return this;
  }

  public ContextFactory enableStaticAnalysis(boolean enableStaticAnalysis) {
    this.enableStaticAnalysis = enableStaticAnalysis;
    return this;
  }

  public ContextFactory treatWarningsAsErrors(boolean treatWarningsAsErrors) {
    this.treatWarningsAsErrors = treatWarningsAsErrors;
    return this;
  }

  public ContextFactory strictErrors(boolean strictErrors) {
    this.strictErrors = strictErrors;
    return this;
  }

  public ContextFactory disableLinting(boolean disableLinting) {
    this.disableLinting = disableLinting;
    return this;
  }

  public ContextFactory enableAutoParallelism(boolean enableAutoParallelism) {
    this.enableAutoParallelism = enableAutoParallelism;
    return this;
  }

  public ContextFactory executionEnvironment(String executionEnvironment) {
    this.executionEnvironment = executionEnvironment;
    return this;
  }

  public ContextFactory warningsLimit(int warningsLimit) {
    this.warningsLimit = warningsLimit;
    return this;
  }

  public ContextFactory options(Map<String, String> options) {
    this.options = options;
    return this;
  }

  public ContextFactory enableRuntimeServerInfoKey(String keyName) {
    this.runtimerServerKey = keyName;
    return this;
  }

  public ContextFactory checkForWarnings(String fqnOfMethod) {
    this.checkForWarnings = fqnOfMethod;
    return this;
  }

  /**
   * Path to the Python resources directory. The directory must exist and must contain subdirectory
   * {@code python-home}.
   *
   * <p>See {@link Engine#copyResources(Path, String...)}.
   */
  public ContextFactory pythonResourceDir(String resourceDir) {
    this.pythonResourceDir = resourceDir;
    return this;
  }

  public ContextFactory enableDebugServer(boolean b) {
    this.enableDebugServer = b;
    return this;
  }

  /**
   * The context's working directory, instead of the process's; {@link #WORKING_DIRECTORY_PROPERTY}
   * when not given.
   */
  public ContextFactory workingDirectory(String workingDirectory) {
    this.workingDirectory = workingDirectory;
    return this;
  }

  /*
   * Note [Low Compilation Load Lowers The Thresholds]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * Truffle scales its first-tier compilation threshold (400 calls or loop iterations) by the
   * load of the compile queue. Up to GraalVM 25.0 an idle queue (load below 10) lowered it to
   * about 25; Truffle 25.1 (GR-76434) changed engine.DynamicCompilationThresholdsMinNormalLoad
   * from 10 to 0, so the threshold stays 400. Roots that loop in plain Java without reporting
   * their loop counts (VectorFromFunctionNode: Vector.new, fill, map) then compile far later, and
   * Vector benchmarks ran up to 9x slower on 25.5 (PR #666; the investigation is
   * scratchpad/wave1/jvm/P3inv/report.md, not checked in). The 25.0 value is restored here, for
   * every context the engine builds. It is an internal (experimental) option: the builder allows
   * experimental options. Drop it once the loops report their counts and the guard passes without
   * it.
   */
  private static final String MIN_NORMAL_LOAD_OPTION =
      "engine.DynamicCompilationThresholdsMinNormalLoad";

  private static final String MIN_NORMAL_LOAD = "10";

  public Context build() {
    if (executionEnvironment != null) {
      options.put("enso.ExecutionEnvironment", executionEnvironment);
    }
    options = new HashMap<>(options);
    if (runtimerServerKey != null) {
      options.put(runtimerServerKey, "true");
    }
    if (pythonResourceDir != null) {
      System.setProperty("polyglot.engine.resourcePath.python", pythonResourceDir);
    }
    options.putIfAbsent(MIN_NORMAL_LOAD_OPTION, MIN_NORMAL_LOAD);
    var builder =
        Context.newBuilder()
            .allowExperimentalOptions(true)
            .allowAllAccess(true)
            .allowHostAccess(allWithTypeMapping())
            .option(RuntimeOptions.STRICT_ERRORS, Boolean.toString(strictErrors))
            .option(RuntimeOptions.DISABLE_LINTING, Boolean.toString(disableLinting))
            .option(RuntimeOptions.WAIT_FOR_PENDING_SERIALIZATION_JOBS, "true")
            .option(RuntimeOptions.DISABLE_IR_CACHES, Boolean.toString(!enableIrCaches))
            .option(RuntimeOptions.DISABLE_PRIVATE_CHECK, Boolean.toString(disablePrivateCheck))
            .option(RuntimeOptions.ENABLE_STATIC_ANALYSIS, Boolean.toString(enableStaticAnalysis))
            .option(
                RuntimeOptions.TREAT_WARNINGS_AS_ERRORS, Boolean.toString(treatWarningsAsErrors))
            .option(RuntimeOptions.LOG_MASKING, Boolean.toString(logMasking))
            .options(options)
            .option(RuntimeOptions.ENABLE_AUTO_PARALLELISM, Boolean.toString(enableAutoParallelism))
            .option(RuntimeOptions.WARNINGS_LIMIT, Integer.toString(warningsLimit))
            .out(out)
            .err(err)
            .in(in);

    var cwd =
        workingDirectory != null
            ? workingDirectory
            : System.getProperty(WORKING_DIRECTORY_PROPERTY);
    if (cwd != null) {
      builder.currentWorkingDirectory(java.nio.file.Path.of(cwd).toAbsolutePath());
    }

    if (checkForWarnings != null) {
      builder.option(DebugServerInfo.METHOD_BREAKPOINT_OPTION, checkForWarnings);
    }
    if (enableDebugServer) {
      builder.option(DebugServerInfo.ENABLE_OPTION, "true");
    }

    ContextLoggingConfigurator.DEFAULT.prepareBuilderForLogging(builder, logLevel, logHandler);

    if (projectRoot != null) {
      builder.option(RuntimeOptions.PROJECT_ROOT, projectRoot);
      var graalpy =
          new File(
              new File(new File(new File(new File(projectRoot), "polyglot"), "python"), "bin"),
              "graalpy");
      if (graalpy.exists()) {
        builder.option("python.Executable", graalpy.getAbsolutePath());
      }
    }

    if (messageTransport != null) {
      builder.serverTransport(messageTransport);
    }

    var ctx = builder.build();
    ContextInsightSetup.configureContext(ctx);
    return ctx;
  }

  private static HostAccess allWithTypeMapping() {
    return HostAccess.newBuilder()
        .allowPublicAccess(true)
        .allowAllImplementations(true)
        .allowAllClassImplementations(true)
        .allowArrayAccess(true)
        .allowListAccess(true)
        .allowBufferAccess(true)
        .allowIterableAccess(true)
        .allowIteratorAccess(true)
        .allowMapAccess(true)
        .allowAccessInheritance(true)
        .build();
  }
}
