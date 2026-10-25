import io.circe.yaml
import io.circe.syntax._
import org.apache.commons.io.IOUtils
import sbt.internal.util.ManagedLogger
import sbt._
import sbt.io.syntax.fileToRichFile
import sbt.util.{CacheStore, CacheStoreFactory, FileInfo, Tracked}

import scala.sys.process._
import org.enso.build.WithDebugCommand

import java.io.File
import java.nio.charset.Charset
import java.nio.file.{Files, Paths}
import scala.collection.mutable.ArrayBuffer
import scala.jdk.javaapi.CollectionConverters.asJava
import scala.util.Try

object DistributionPackage {

  /** File extensions. */
  implicit class FileExtensions(file: File) {

    /** Get the outermost directory of this file. For absolute paths this
      * function always returns root.
      *
      * == Example ==
      * Get top directory of the relative path.
      * {{{
      *   file("foo/bar/baz").getTopDirectory == file("foo")
      * }}}
      *
      * Get top directory of the absolute path.
      * {{{
      *   file(/foo/bar/baz").getTopDirectory == file("/")
      * }}}
      *
      * @return the outermost directory of this file.
      */
    def getTopDirectory: File = {
      @scala.annotation.tailrec
      def go(path: File): File = {
        val parent = path.getParentFile
        if (parent == null) path else go(parent)
      }
      go(file)
    }
  }

  /** Conditional copying, based on the contents of cache and timestamps of files.
    *
    * @param source source directory
    * @param destination target directory
    * @param cache cache used for persisting the cached information
    * @return true, if copying was necessary, false if no change was detected between the directories
    */
  def copyDirectoryIncremental(
    source: File,
    destination: File,
    cache: CacheStore
  ): Boolean = {
    val allFiles = source.allPaths.get().toSet
    Tracked.diffInputs(cache, FileInfo.lastModified)(allFiles) { diff =>
      val missing = diff.unmodified.exists { f =>
        val relativePath = f.relativeTo(source).get
        val destinationFile =
          destination.toPath.resolve(relativePath.toPath).toFile
        !destinationFile.exists()
      }

      if (diff.modified.nonEmpty || diff.removed.nonEmpty || missing) {
        IO.delete(destination)
        IO.copyDirectory(source, destination)
        true
      } else false
    }
  }

  def copyFilesIncremental(
    sources: Seq[File],
    destinationDirectory: File,
    cache: CacheStore
  ): Unit = {
    val allFiles = sources.toSet
    IO.createDirectory(destinationDirectory)
    Tracked.diffInputs(cache, FileInfo.lastModified)(allFiles) { diff =>
      for (f <- diff.removed) {
        IO.delete(destinationDirectory / f.getName)
      }
      for (f <- diff.modified -- diff.removed) {
        IO.copyFile(f, destinationDirectory / f.getName)
      }
      for (f <- diff.unmodified) {
        val destinationFile = destinationDirectory / f.getName
        if (!destinationFile.exists()) {
          IO.copyFile(f, destinationDirectory / f.getName)
        }
      }
    }
  }

  private def batOrExeName(baseName: String): String =
    if (Platform.isWindows) {
      if (GraalVM.EnsoLauncher.native) {
        baseName + ".exe"
      } else {
        baseName + ".bat"
      }
    } else {
      baseName
    }

  /** @param distributionRoot Root directory for the engine build distribution. Will be populated.
    * @param jarModulesToCopy Modular Jar archives that will be copied into the `component` directory.
    * @param pythonResources Directories with extracted resources from GraalPy
    * @param pythonHome Target directory for `pythonResources`
    * @param targetDir Directory with built rust-parser native library.
    */
  def createEnginePackage(
    distributionRoot: File,
    cacheFactory: CacheStoreFactory,
    log: Logger,
    jarModulesToCopy: Seq[File],
    pythonResources: Seq[File],
    pythonHome: File,
    graalVersion: String,
    javaVersion: String,
    ensoVersion: String,
    editionName: String,
    sourceStdlibVersion: String,
    targetStdlibVersion: String,
    targetDir: File
  ): Unit = {
    copyDirectoryIncremental(
      file("distribution/engine/THIRD-PARTY"),
      distributionRoot / "THIRD-PARTY",
      cacheFactory.make("engine-third-party")
    )

    copyFilesIncremental(
      jarModulesToCopy,
      distributionRoot / "component",
      cacheFactory.make("module jars")
    )

    // pythonResources contain everything - both files and directories.
    // It should be enough to just recursively copy the first `python-home` directory.
    val pyResource = pythonResources.head
    if (pyResource.getName != "python-home") {
      throw new AssertionError(
        s"Expected the first python resource to be 'python-home', but got '${pyResource.getName}'"
      )
    }
    copyDirectoryIncremental(
      source      = pyResource,
      destination = pythonHome,
      cache       = cacheFactory.make("engine-python-home")
    )

    val parser = targetDir / Platform.dynamicLibraryFileName("enso_parser")
    copyFilesIncremental(
      Seq(parser),
      distributionRoot / "component",
      cacheFactory.make("engine-parser-library")
    )

    (distributionRoot / "editions").mkdirs()
    Editions.writeEditionConfig(
      editionsRoot    = distributionRoot / "editions",
      editionTemplate = file("distribution/edition.template.yaml"),
      ensoVersion     = ensoVersion,
      editionName     = editionName,
      libraryVersion  = targetStdlibVersion,
      log             = log
    )

    copyLibraryCacheIncremental(
      sourceRoot      = file("distribution/lib"),
      destinationRoot = distributionRoot / "lib",
      sourceVersion   = sourceStdlibVersion,
      targetVersion   = targetStdlibVersion,
      cacheFactory    = cacheFactory.sub("engine-libraries"),
      log             = log
    )

    if (GraalVM.EnsoLauncher.native) {
      log.info(
        s"Using native launchers as ${GraalVM.EnsoLauncher.VAR_NAME} env variable is ${GraalVM.EnsoLauncher.toString}"
      )
    } else {
      log.info(
        s"Using shell launchers as ${GraalVM.EnsoLauncher.VAR_NAME} env variable is ${GraalVM.EnsoLauncher.toString}"
      )
      copyDirectoryIncremental(
        file("distribution/bin"),
        distributionRoot / "bin",
        cacheFactory.make("engine-bin")
      )
    }

    buildEngineManifest(
      template     = file("distribution/manifest.template.yaml"),
      destination  = distributionRoot / "manifest.yaml",
      graalVersion = graalVersion,
      javaVersion  = javaVersion
    )
  }

  /** Generates indexes (compiles) all the standard libraries.
    * Will do that only for libraries which have modified source files since last
    * compilation.
    * Compilation is done by invoking a single subprocess.
    * @param libRoot Root dir for all the libraries.
    * @param libsToUpload Name of libraries that will be uploaded as release assets.
    */
  def indexStdLibs(
    stdLibVersion: String,
    ensoVersion: String,
    libRoot: File,
    javaOpts: Seq[String],
    cacheFactory: CacheStoreFactory,
    libsToUpload: Seq[String],
    log: Logger,
    env: Map[String, String] = Map.empty
  ): Unit = {
    val modifiedLibs: ArrayBuffer[File]         = ArrayBuffer()
    val modifiedCaches: ArrayBuffer[CacheStore] = ArrayBuffer()
    for (libNamespace <- libRoot.listFiles()) {
      for (libName <- libNamespace.listFiles()) {
        val libRootDir = libName / stdLibVersion
        val cache      = cacheFactory.make(s"${libName.getName}.$ensoVersion")
        val trackedFiles = libRootDir
          .globRecursive("*.enso" && FileOnlyFilter)
          .get()
          .toSet
        Tracked.diffInputs(cache, FileInfo.lastModified)(trackedFiles) { diff =>
          if (diff.modified.nonEmpty) {
            modifiedLibs.append(libRootDir)
            modifiedCaches.append(cache)
          }
        }
      }
    }

    if (modifiedLibs.nonEmpty) {
      try {
        invokeIndexStdLibs(
          libRootDirs  = modifiedLibs,
          javaOpts     = javaOpts,
          libsToUpload = libsToUpload,
          log          = log,
          env          = env
        )
      } catch {
        case e: Throwable =>
          // `Tracked.diffInputs` has already recorded these libraries as
          // up to date. Forget that, so that the next run indexes them again
          // instead of silently skipping them.
          modifiedCaches.foreach(_.delete())
          throw e
      }
    }
  }

  private object FileOnlyFilter extends sbt.io.FileFilter {
    def accept(arg: File): Boolean = arg.isFile
  }

  private def invokeIndexStdLibs(
    libRootDirs: Seq[File],
    javaOpts: Seq[String],
    libsToUpload: Seq[String],
    log: Logger,
    env: Map[String, String] = Map.empty
  ): Unit = {
    val libNames = libRootDirs
      .map { libRoot =>
        libRoot.getParentFile.getName
      }
      .sorted
      .mkString(", ")
    val libPaths = libRootDirs.map { libRoot =>
      libRoot.getAbsolutePath
    }
    log.info(s"Generating indexes for libraries [$libNames]")
    val javaCommand = javaExecutable()

    val javaArgs = javaOpts ++ Seq(
      "--no-compile-dependencies",
      "--compile"
    ) ++ libPaths
    // See Note [Standard Library Indexing Uses An Argument File]
    val argFile = writeJavaArgumentFile(javaArgs)
    try {
      val command = Seq(javaCommand, "@" + argFile.getAbsolutePath)
      log.debug((javaCommand +: javaArgs).mkString(" "))
      log.debug(
        s"Arguments passed via argument file $argFile; command line is " +
        s"${command.mkString(" ").length} chars instead of " +
        s"${(javaCommand +: javaArgs).mkString(" ").length}."
      )
      runIndexStdLibs(command, libRootDirs, libNames, libsToUpload, log, env)
    } finally {
      argFile.delete()
    }
  }

  /* Note [Standard Library Indexing Uses An Argument File]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * The indexing JVM gets `engine-runner / Runtime / javaOptions`, whose two
   * `--module-path` values list every Coursier-cache jar and every jar built in
   * this checkout by absolute path. Passed on the command line, that was ~28,100
   * chars from a checkout at `C:\Repos\Enso\ide` - and the checkout path occurs
   * 140 times, so each extra character of it costs 140 more (33,971 chars from a
   * git worktree 42 chars deeper). Windows caps a command line at 32,767 chars,
   * so a checkout path only ~33 chars longer failed with `CreateProcess
   * error=206, The filename or extension is too long`, and every new dependency
   * (or a longer user name, via the Coursier cache) eats into that headroom.
   *
   * `java @file` (JDK 9+) reads the arguments from a file instead, keeping the
   * command line short regardless of path lengths. Do not inline the arguments
   * back onto the command line.
   */

  /** Writes `args` to a temporary `java` launcher argument file, one quoted
    * argument per line. The caller is responsible for deleting the file.
    */
  private def writeJavaArgumentFile(args: Seq[String]): File = {
    val argFile = File.createTempFile("enso-index-stdlibs-", ".args")
    argFile.deleteOnExit()
    val content = args
      .map(quoteJavaArgumentFileArg)
      .mkString("", System.lineSeparator(), System.lineSeparator())
    // The launcher reads the file as raw bytes in the platform encoding.
    val charset = Option(System.getProperty("native.encoding"))
      .flatMap(name => Try(Charset.forName(name)).toOption)
      .getOrElse(Charset.defaultCharset())
    Files.write(argFile.toPath, content.getBytes(charset))
    argFile
  }

  /** Quotes an argument for a `java` launcher argument file.
    *
    * Inside quotes the launcher treats backslash as an escape character, so
    * backslashes (Windows paths) and quotes must be escaped; quoting keeps
    * whitespace (e.g. `Program Files`) and a leading `#` (a comment) literal.
    */
  private def quoteJavaArgumentFileArg(arg: String): String = {
    val escaped = arg
      .replace("\\", "\\\\")
      .replace("\"", "\\\"")
      .replace("\n", "\\n")
      .replace("\r", "\\r")
    "\"" + escaped + "\""
  }

  private def runIndexStdLibs(
    command: Seq[String],
    libRootDirs: Seq[File],
    libNames: String,
    libsToUpload: Seq[String],
    log: Logger,
    env: Map[String, String]
  ): Unit = {
    val allEnv1 = mapAppend(
      env,
      "NO_COLOR" -> "true"
    )
    // Don't create source archives for standard libraries.
    val noSrcArchivesSysProp = noSourceArchivesOpt(libRootDirs, libsToUpload)
    val allEnv = mapAppend(
      allEnv1,
      "JAVA_TOOL_OPTIONS" -> noSrcArchivesSysProp
    )
    val procBldr = new java.lang.ProcessBuilder(asJava(command))
    val cwd      = libRootDirs.head.getAbsoluteFile.getParentFile
    procBldr.directory(cwd)
    allEnv.foreach { case (k, v) =>
      procBldr.environment().put(k, v)
    }

    val runningProcess = Process(procBldr).run()
    // Poor man's solution to stuck index generation
    val GENERATING_INDEX_TIMEOUT = 60 * 4 // 2 minutes
    var current                  = 0
    var timeout                  = false
    while (runningProcess.isAlive() && !timeout) {
      if (current > GENERATING_INDEX_TIMEOUT) {
        java.lang.System.err
          .println(
            "Reached timeout when generating index. Terminating..."
          )
        try {
          val pidOfProcess = pid(runningProcess)
          val javaHome     = System.getProperty("java.home")
          val jstack =
            if (javaHome == null) "jstack"
            else
              Paths.get(javaHome, "bin", "jstack").toAbsolutePath.toString
          val in = java.lang.Runtime.getRuntime
            .exec(Array(jstack, pidOfProcess.toString))
            .getInputStream

          System.err.println(IOUtils.toString(in, "UTF-8"))
        } catch {
          case e: Throwable =>
            java.lang.System.err
              .println("Failed to get threaddump of a stuck process", e);
        } finally {
          timeout = true
          runningProcess.destroy()
        }
      } else {
        Thread.sleep(1000)
        current += 1
      }
    }
    if (timeout) {
      throw new RuntimeException(
        s"TIMEOUT: Failed to compile [$libNames] in $GENERATING_INDEX_TIMEOUT seconds"
      )
    }
    if (runningProcess.exitValue() != 0) {
      throw new RuntimeException(s"Cannot compile [$libNames].")
    } else {
      log.info(
        s"Successfully generated indexes for libraries [$libNames] in $current seconds."
      )
    }
  }

  /** Constructs a system property that tells the compiler for which libraries there should
    * be no source archive created.
    * A source archive is created only for libraries that will be uploaded.
    * @param libRootDirs
    * @param libsToUpload
    * @return
    */
  private def noSourceArchivesOpt(
    libRootDirs: Seq[File],
    libsToUpload: Seq[String]
  ): String = {
    val noArchives = libRootDirs.filter { libRootDir =>
      val libName      = libRootDir.getParentFile
      val libNamespace = libName.getParentFile
      val name         = libNamespace.getName + "." + libName.getName
      val shouldUpload = libsToUpload.contains(name)
      !shouldUpload
    }
    if (noArchives.isEmpty) {
      ""
    } else {
      val absPaths = noArchives.map { _.getAbsolutePath }
      "-Dorg.enso.compiler.noSourceArchives=" + absPaths.mkString(",")
    }
  }

  private def mapAppend(
    dest: Map[String, String],
    entry: (String, String)
  ): Map[String, String] = {
    val newKey = entry._1
    val newVal = entry._2
    if (dest.contains(newKey)) {
      val oldVal      = dest(newKey)
      val appendedVal = oldVal + " " + newVal
      dest + (newKey -> appendedVal)
    } else {
      dest + entry
    }
  }

  private def javaExecutable(): String = {
    val jHome = System.getProperty("java.home")
    if (jHome != null) {
      if (Platform.isWindows) {
        jHome + File.separator + "bin" + File.separator + "java.exe"
      } else {
        jHome + File.separator + "bin" + File.separator + "java"
      }
    } else {
      ProcessHandle.current().info().command().asScala.getOrElse("java")
    }
  }

  /** Helper method to execute project manager and enso using similar technique.
    */
  private def adjustArgsAndStart(
    log: Logger,
    args: java.util.List[String],
    jvmOptName: String,
    pb: java.lang.ProcessBuilder,
    appendJvmOpts: String     = "-ea",
    cwd: Option[java.io.File] = None,
    env: Map[String, String]  = Map.empty
  ): java.lang.Process = {
    val envToFill: java.util.Map[String, String] = pb.environment()
    var atEnv                                    = args.indexOf("--env")
    while (atEnv >= 0) {
      var keyAndValue = args.get(atEnv + 1).split("=")
      envToFill.put(keyAndValue(0), keyAndValue(1))
      args.remove(atEnv)
      args.remove(atEnv)
      atEnv = args.indexOf("--env")
    }

    var prevValue = System.getenv(jvmOptName)
    if (prevValue == null) {
      prevValue = appendJvmOpts;
    } else {
      prevValue = prevValue + " " + appendJvmOpts
    }

    val at = args.indexOf("--debug")
    if (at >= 0) {
      args.set(at, "--jvm=" + System.getProperty("java.home"))
      val newValue = if (prevValue == "") {
        WithDebugCommand.DEBUG_OPTION
      } else {
        prevValue + " " + WithDebugCommand.DEBUG_OPTION
      }
      envToFill.put(jvmOptName, newValue)
    } else {
      envToFill.put(jvmOptName, prevValue)
    }

    for ((k, v) <- env) {
      val prev = envToFill.get(k)
      val newValue = if (prev != null) {
        prev + " " + v
      } else {
        v
      }
      envToFill.put(k, newValue)
    }

    pb.command(args)
    cwd.map { d =>
      pb.directory(d)
    }
    pb.inheritIO()
    log.info(
      s"Executing ${args.stream.collect(java.util.stream.Collectors.joining(" "))}"
    )
    envToFill
      .entrySet()
      .forEach(entry => {
        val name = entry.getKey
        if (name.startsWith("ENSO_") || name == jvmOptName) {
          log.info(s"  with ${name}=${entry.getValue}")
        }
      })
    val process = pb.start()
    process
  }

  def runEnginePackage(
    distributionRoot: File,
    args: Seq[String],
    log: Logger,
    cwd: Option[java.io.File] = None,
    env: Map[String, String]  = Map.empty
  ): Boolean = {
    import scala.collection.JavaConverters._

    val enso = distributionRoot / "bin" / batOrExeName("enso")
    val pb   = new java.lang.ProcessBuilder()
    val all  = new java.util.ArrayList[String]()
    val (atIndex, fileToRun, projectPath) =
      findProjectPath(distributionRoot, args)

    log.debug("fileToRun Index: " + atIndex)
    log.debug("fileToRun: " + fileToRun)
    log.debug("projectPath: " + projectPath)

    val disablePrivateCheck = Option(fileToRun)
      .map { toRun =>
        val prj = EnsoProjects.Project(None, projectPath, toRun.toPath)
        prj.usesPrivateAccess
      }
      .getOrElse(false)
    val adjustedCwd = cwd.orElse {
      Option(projectPath).map(new File(_).getParentFile)
    }

    all.add(enso.getAbsolutePath)
    all.addAll(args.asJava)
    if (disablePrivateCheck) {
      all.add("--disable-private-check")
    }
    if (fileToRun != null) {
      all.set(atIndex + 1, fileToRun.getPath)
    }
    val p =
      adjustArgsAndStart(
        log,
        all,
        "JAVA_TOOL_OPTIONS",
        pb,
        cwd = adjustedCwd,
        env = env
      )
    val exitCode = p.waitFor()
    if (exitCode != 0) {
      log.warn(enso + " finished with exit code " + exitCode)
    }
    exitCode == 0
  }

  // https://stackoverflow.com/questions/23279898/get-process-id-of-scala-sys-process-process
  def pid(p: Process): Long = {
    val procField = p.getClass.getDeclaredField("p")
    procField.synchronized {
      procField.setAccessible(true)
      val proc = procField.get(p)
      try {
        proc match {
          case unixProc
              if unixProc.getClass.getName == "java.lang.UNIXProcess" =>
            val pidField = unixProc.getClass.getDeclaredField("pid")
            pidField.synchronized {
              pidField.setAccessible(true)
              try {
                pidField.getLong(unixProc)
              } finally {
                pidField.setAccessible(false)
              }
            }
          case javaProc: java.lang.Process =>
            javaProc.pid()
          case other =>
            throw new RuntimeException(
              "Cannot get PID of a " + proc.getClass.getName
            )
        }
      } finally {
        procField.setAccessible(false)
      }
    }
  }

  /** Returns the argument specifying the path of the project to run.
    *
    * It will be the argument following `--in-project`, `--run` or `--compile`.
    *
    * @param root the root of the engine distribution
    * @return index of the replace argument (or -1)
    */
  private def findProjectPath(
    root: File,
    args: Seq[String]
  ): (Int, java.io.File, String) = {
    def findArg(name: String): Option[(Int, String)] = {
      val location = args.indexOf(name)
      if (location >= 0 && location + 1 < args.size) {
        Some((location + 1, args(location + 1)))
      } else {
        None
      }
    }

    val indexPath = findArg("--in-project")
      .orElse(findArg("--run"))
      .orElse(findArg("--compile"))
    if (indexPath.isEmpty) {
      return (-1, null, null)
    }

    val index = indexPath.orNull._1
    val path  = indexPath.orNull._2

    val runnerJar = root / "component" / "engine-runner.jar"
    if (!runnerJar.exists()) {
      throw new IllegalStateException("Cannot find " + runnerJar)
    }
    val slf4jJar =
      root / "component" / s"slf4j-api-${Dependencies.slf4jVersion}.jar"
    if (!slf4jJar.exists()) {
      throw new IllegalStateException("Cannot find " + slf4jJar)
    }
    val l = new java.net.URLClassLoader(
      Array(
        runnerJar.toURI().toURL(),
        slf4jJar.toURI().toURL()
      ),
      Class.forName("scala.Tuple2").getClassLoader()
    )
    try {
      val utils = l.loadClass("org.enso.runner.Utils")
      val find = utils.getDeclaredMethod(
        "findFileAndProject",
        classOf[String],
        classOf[String],
        classOf[String]
      )
      find.setAccessible(true)
      val res = find
        .invoke(null, null, path, null)
        .asInstanceOf[(Boolean, java.io.File, String)]
      return (index, res._2, res._3);
    } catch {
      case ex: ReflectiveOperationException =>
        ex.printStackTrace()
        throw ex
    }
  }

  def fixLibraryManifest(
    packageRoot: File,
    targetVersion: String,
    log: Logger
  ): Unit = {
    val packageConfig   = packageRoot / "package.yaml"
    val originalContent = IO.read(packageConfig)
    yaml.parser.parse(originalContent) match {
      case Left(error) =>
        log.error(s"Failed to parse $packageConfig: $error")
        throw error
      case Right(parsed) =>
        val obj = parsed.asObject.getOrElse {
          throw new IllegalStateException(s"Incorrect format of $packageConfig")
        }

        val key        = "version"
        val updated    = obj.remove(key).add(key, targetVersion.asJson)
        val serialized = yaml.printer.print(updated.asJson)
        if (serialized == originalContent) {
          log.info(
            s"No need to update $packageConfig, already in correct version."
          )
        } else {
          IO.write(packageConfig, serialized)
          log.debug(s"Updated $packageConfig to $targetVersion")
        }
    }
  }

  def copyLibraryCacheIncremental(
    sourceRoot: File,
    destinationRoot: File,
    sourceVersion: String,
    targetVersion: String,
    cacheFactory: CacheStoreFactory,
    log: Logger
  ): Unit = {
    val existingLibraries =
      collection.mutable.ArrayBuffer.empty[(String, String)]
    for (prefix <- sourceRoot.list()) {
      for (libName <- (sourceRoot / prefix).list()) {
        val targetPackageRoot =
          destinationRoot / prefix / libName / targetVersion
        val libSourceDir = sourceRoot / prefix / libName / sourceVersion
        if (libSourceDir.exists() && libSourceDir.isDirectory) {
          val copied = copyDirectoryIncremental(
            source      = libSourceDir,
            destination = targetPackageRoot,
            cache       = cacheFactory.make(s"$prefix.$libName")
          )
          val bindingsDir = targetPackageRoot / ".enso" / "cache" / "bindings"
          if (copied && bindingsDir.exists()) {
            log.info(
              s"Clearing cached bindings for $prefix.$libName, because library sources were changed."
            )
            IO.delete(bindingsDir)
          }
          fixLibraryManifest(targetPackageRoot, targetVersion, log)
          existingLibraries.append((prefix, libName))
        }
      }
    }

    val existingLibrariesSet = existingLibraries.toSet
    for (prefix <- destinationRoot.list()) {
      for (libName <- (destinationRoot / prefix).list()) {
        if (!existingLibrariesSet.contains((prefix, libName))) {
          log.info(
            s"Removing a library $prefix.$libName from the distribution, " +
            s"because it does not exist in the sources anymore."
          )
        }
      }
    }

  }

  private def buildEngineManifest(
    template: File,
    destination: File,
    graalVersion: String,
    javaVersion: String
  ): Unit = {
    val base = IO.read(template)
    val extensions =
      s"""graal-vm-version: $graalVersion
         |graal-java-version: $javaVersion
         |""".stripMargin
    IO.write(destination, base + extensions)
  }

  sealed trait OS {
    def name:  String
    def archs: Seq[Architecture]
  }
  object OS {
    case object Linux extends OS {
      override val name: String = "linux"
      override val archs        = Seq(Architecture.X64)
    }
    trait MacOS extends OS {
      override val name: String = "macos"
    }
    case object MacOSAmd extends MacOS {
      override val archs = Seq(Architecture.X64)
    }
    case object MacOSArm extends MacOS {
      override val archs = Seq(Architecture.AarchX64)
    }
    case object Windows extends OS {
      override val name: String = "windows"
      override val archs        = Seq(Architecture.X64)
    }
  }

  sealed trait Architecture {
    def name: String
  }
  object Architecture {
    case object X64 extends Architecture {
      override val name: String = "amd64"
    }
    case object AarchX64 extends Architecture {
      override val name: String = "aarch64"
    }
  }

  /** A helper class that manages building distribution artifacts. */
  class Builder(ensoVersion: String, val artifactRoot: File) {

    def artifactName(
      component: String,
      os: OS,
      architecture: Architecture
    ): String =
      s"enso-$component-$ensoVersion-${os.name}-${architecture.name}"

    /** The OS and architecture of this machine, as the artifact names spell them. */
    def localPlatform: (OS, Architecture) = {
      val os =
        if (Platform.isWindows) OS.Windows
        else if (Platform.isLinux) OS.Linux
        else if (Platform.isMacOS) {
          if (Platform.isAmd64) OS.MacOSAmd
          else if (Platform.isArm64) OS.MacOSArm
          else
            throw new IllegalStateException(
              "Unknown Arch: " + sys.props("os.arch")
            )
        } else
          throw new IllegalStateException("Unknown OS: " + sys.props("os.name"))
      (os, os.archs.head)
    }

    /** Path to the artifact that is built on this local machine. */
    def localArtifact(component: String): File = {
      val (os, architecture) = localPlatform
      artifactRoot / artifactName(component, os, architecture)
    }
  }
}
