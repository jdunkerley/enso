import sbt.Keys._
import sbt._
import sbt.internal.util.ManagedLogger
import sbt.io.IO
import sbt.librarymanagement.{ConfigurationFilter, DependencyFilter}

import scala.collection.immutable.Seq

/** A collection of utility methods for everything related to the GraalVM and Truffle.
  */
object GraalVM {

  private val version: String = Dependencies.graalMavenPackagesVersion

  final def mavenPackagesVersion: String = version

  /** The list of modules that are included in the `component` directory in engine distribution.
    * When invoking the `java` command, these modules need to be put on the module-path.
    */
  val modules: Seq[ModuleID] = Seq(
    "org.graalvm.sdk"      % "nativeimage"      % version,
    "org.graalvm.sdk"      % "word"             % version,
    "org.graalvm.sdk"      % "jniutils"         % version,
    "org.graalvm.sdk"      % "collections"      % version,
    "org.graalvm.polyglot" % "polyglot"         % version,
    "org.graalvm.truffle"  % "truffle-api"      % version,
    "org.graalvm.truffle"  % "truffle-runtime"  % version,
    "org.graalvm.truffle"  % "truffle-compiler" % version
  )

  private val sdkPkgs = Seq(
    "org.graalvm.sdk" % "polyglot-tck" % version,
    "org.graalvm.sdk" % "nativeimage"  % version,
    "org.graalvm.sdk" % "word"         % version,
    "org.graalvm.sdk" % "jniutils"     % version,
    "org.graalvm.sdk" % "collections"  % version
  )

  private val polyglotPkgs = Seq(
    "org.graalvm.polyglot" % "polyglot" % version
  )

  private val trufflePkgs = Seq(
    "org.graalvm.truffle" % "truffle-api"           % version,
    "org.graalvm.truffle" % "truffle-runtime"       % version,
    "org.graalvm.truffle" % "truffle-compiler"      % version,
    "org.graalvm.truffle" % "truffle-dsl-processor" % version
  )

  /** Manually maintained GraalVM languages and their dependencies. Optimally,
    * we would use 'org.graalvm.polyglot:js-community' or 'org.graavm.polyglot:python-community'
    * maven artifacts and all their transitive dependencies, but we have to copy all these artifacts
    * into engine distribution build, so we have to maintain these manually.
    */

  private val pythonPkgs =
    Seq(
      "org.graalvm.python"   % "python-language"    % version,
      "org.graalvm.python"   % "python-resources"   % version,
      "org.bouncycastle"     % "bcutil-jdk18on"     % Dependencies.bouncyCastleVersion,
      "org.bouncycastle"     % "bcpkix-jdk18on"     % Dependencies.bouncyCastleVersion,
      "org.bouncycastle"     % "bcprov-jdk18on"     % Dependencies.bouncyCastleVersion,
      "org.graalvm.llvm"     % "llvm-api"           % version,
      "org.graalvm.truffle"  % "truffle-nfi"        % version,
      "org.graalvm.truffle"  % "truffle-nfi-panama" % version,
      "org.graalvm.truffle"  % "truffle-nfi-libffi" % version,
      "org.graalvm.regex"    % "regex"              % version,
      "org.graalvm.tools"    % "profiler-tool"      % version,
      "org.graalvm.shadowed" % "json"               % version,
      "org.graalvm.shadowed" % "icu4j"              % version,
      "org.graalvm.shadowed" % "xz"                 % version
    )

  val jsPkgs =
    Seq(
      "org.graalvm.js"       % "js-language" % version,
      "org.graalvm.regex"    % "regex"       % version,
      "org.graalvm.shadowed" % "icu4j"       % version,
      "org.graalvm.shadowed" % "xz"          % version
    )

  val chromeInspectorPkgs = Seq(
    "org.graalvm.tools"    % "chromeinspector-tool" % version,
    "org.graalvm.shadowed" % "json"                 % version,
    "org.graalvm.tools"    % "profiler-tool"        % version
  )

  private val debugAdapterProtocolPkgs = Seq(
    "org.graalvm.tools" % "dap-tool" % version
  )

  val insightPkgs = Seq(
    "org.graalvm.tools" % "insight-tool"      % version,
    "org.graalvm.tools" % "insight-heap-tool" % version
  )

  val toolsPkgs = chromeInspectorPkgs ++ debugAdapterProtocolPkgs ++ insightPkgs

  val langsPkgs = jsPkgs ++ pythonPkgs

  private val allowedJavaVendors = Seq(
    "GraalVM Community",
    "Oracle Corporation"
  )

  /** The GitHub release that holds the GraalVM CE JDK for these versions: the
    * innovation line's `graal-<release>` tag, or `jdk-<version>` on 25.0.x,
    * where the JDK and the release share a version.
    * See Note [GraalVM Follows The Innovation Line] in `Dependencies.scala`.
    */
  def downloadLink(
    graalVersion: String,
    graalPackagesVersion: String
  ): String = {
    val tag =
      if (graalVersion == graalPackagesVersion) s"jdk-$graalVersion"
      else s"graal-$graalPackagesVersion"
    s"https://github.com/graalvm/graalvm-ce-builds/releases/tag/$tag"
  }

  /** Augments a state transition to do GraalVM version check.
    *
    * @param graalVersion  the GraalVM JDK version that should be used for
    *                      building this project
    * @param graalPackagesVersion the GraalVM release: the version of Truffle and
    *                             the GraalVM packages downloaded from Maven
    * @param javaVersion Version of the Java source code
    * @return an augmented state transition that does all the state changes of
    *         oldTransition but also runs the version checks
    */
  def versionCheck(
    graalVersion: String,
    graalPackagesVersion: String,
    javaVersion: String,
    oldState: State
  ): State = {
    val log        = oldState.log
    val link       = downloadLink(graalVersion, graalPackagesVersion)
    val javaVendor = System.getProperty("java.vendor")
    if (!allowedJavaVendors.contains(javaVendor)) {
      log.warn(
        s"Running on non-GraalVM JVM (The actual java.vendor is $javaVendor). " +
        s"Expected Java vendors: ${allowedJavaVendors.mkString(", ")}. " +
        s"Download link: $link"
      )
    }

    val javaSpecVersion = System.getProperty("java.specification.version")
    if (javaSpecVersion != javaVersion) {
      log.error(
        s"Running on Java version $javaSpecVersion. " +
        s"Expected Java version $javaVersion. " +
        s"Download link: $link"
      )
      return oldState.fail
    }

    val vmVersion = System.getProperty("java.vm.version")
    jvmVersionProblem(vmVersion, graalVersion, graalPackagesVersion) match {
      case Some(problem) =>
        log.error(s"$problem Download link: $link")
        oldState.fail
      case None =>
        oldState
    }
  }

  /** Why a JVM whose `java.vm.version` is `vmVersion` cannot build with the
    * GraalVM JDK `graalVersion` and the GraalVM release `graalPackagesVersion`,
    * or `None` when it can.
    *
    * The JDK's version (`vmVersion` before the `+`) must be `graalVersion`
    * exactly. Its JVMCI version must belong to the release: since 25.1 Truffle's
    * optimising runtime runs only on a GraalVM JDK of the same feature release.
    * A JDK on the innovation line names it (`jvmci-25.5-b26`: the release's
    * first two components); a 25.0.x JDK does not (`jvmci-b01`), and then the
    * release must have the JDK's version.
    * See Note [GraalVM Follows The Innovation Line] in `Dependencies.scala`.
    *
    * The meta-build has no test harness (`project/CLAUDE.md`), so this was
    * checked with `sbt eval GraalVM.jvmVersionProblem(...)` on six cases
    * (`java.vm.version`, graalVersion, graalMavenPackagesVersion):
    *  - `25.0.5.0.3+1-jvmci-25.5-b26`, 25.0.5.0.3, 25.5.5.0.3: None;
    *  - `25.0.1+8-jvmci-b01`, 25.0.1, 25.0.1: None;
    *  - `25.0.5.0.3+1-jvmci-25.5-b26`, 25.0.5.0.3, 25.4.4.1.1: wrong release;
    *  - `25.0.1+8-jvmci-b01`, 25.0.5.0.3, 25.5.5.0.3: wrong JDK;
    *  - `25.0.1+8-jvmci-b01`, 25.0.1, 25.0.5: a 25.0.x JDK, another release;
    *  - `25.0.1` (no `+`), 25.0.1, 25.0.1: unparsable.
    */
  def jvmVersionProblem(
    vmVersion: String,
    graalVersion: String,
    graalPackagesVersion: String
  ): Option[String] = {
    val plus = Option(vmVersion).map(_.indexOf('+')).getOrElse(-1)
    if (plus < 0) {
      return Some(
        s"Could not parse GraalVM version from java.vm.version: $vmVersion."
      )
    }
    val jdkVersion = vmVersion.substring(0, plus)
    if (jdkVersion != graalVersion) {
      return Some(
        s"Running on GraalVM version $jdkVersion. " +
        s"Expected GraalVM version $graalVersion."
      )
    }
    val releaseFeature =
      graalPackagesVersion.split('.').take(2).mkString(".")
    val jvmciFeature =
      """jvmci-(\d+\.\d+)""".r.findFirstMatchIn(vmVersion).map(_.group(1))
    jvmciFeature match {
      case Some(feature) if feature != releaseFeature =>
        Some(
          s"Running on a GraalVM JDK for release $feature ($vmVersion). " +
          s"The GraalVM packages are release $graalPackagesVersion, " +
          s"which needs a JDK for release $releaseFeature."
        )
      case Some(_) => None
      case None    =>
        // A 25.0.x JDK: its release has the JDK's own version.
        if (graalVersion != graalPackagesVersion) {
          Some(
            s"Running on GraalVM JDK $graalVersion ($vmVersion), a 25.0.x " +
            s"JDK (its JVMCI version names no release), whose GraalVM " +
            s"packages are $graalVersion too. The build asks for release " +
            s"$graalPackagesVersion: set graalVersion and " +
            s"graalMavenPackagesVersion to the same 25.0.x version, or use " +
            s"the JDK of release $graalPackagesVersion."
          )
        } else {
          None
        }
    }
  }
}
