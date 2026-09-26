import sbt._
import org.enso.build.BenchTasks.Benchmark

/** Dependencies of the whole project and their versions.
  *
  * Note [Dependency Versions]
  * ~~~~~~~~~~~~~~~~~~~~~~~~~~
  * Please maintain the following section in alphabetical order for the bundles
  * of dependencies. Additionally, please keep the 'Other' subsection in
  * alphabetical order.
  *
  * Furthermore, please keep the following in mind:
  * - Wherever possible, we should use the same version of a dependency
  *   throughout the project.
  * - If you need to include a new dependency, please define its version in this
  *   section.
  * - If that version is not the latest, please include a note explaining why
  *   this is the case.
  * - If, for some reason, you need to use a dependency version other than the
  *   global one, please include a note explaining why this is the case, and the
  *   circumstances under which the dependency could be upgraded to use the
  *   global version
  *
  * Note [Engine And Launcher Version]
  * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  * Currently both Engine and Launcher versions are tied to each other - each new
  * releases contains the Engine and the Launcher and thus the version number is
  * shared. If the version numbers ever diverge, make sure to update the build
  * scripts at .github/workflows accordingly.
  *
  * Note [Default Editions]
  * ~~~~~~~~~~~~~~~~~~~~~~~
  * Currently, the default edition to use is inferred based on the engine
  * version. Each Enso version has an associated default edition name and the
  * `currentEdition` field specifies the default edition name for the upcoming
  * release.
  *
  * Thus the `library-manager` needs to depend on the `version-output` to get
  * this defaults from the build metadata.
  *
  * In the future we may automate generating this edition number when cutting a
  * release.
  *
  * Note [Stdlib Version]
  * ~~~~~~~~~~~~~~~~~~~~~
  * The `stdlibVersion` variable stores the version at which standard library is
  * stored within the source tree, which is currently set to a constant of
  * `0.0.0-dev`.
  *
  * When distributions are built, the library versions are updated to match the
  * current Enso version.
  */
object Dependencies {
  // === project-wide versions =====================================================
  val scalacVersion = "2.13.17"
  // source version of the Java language
  val javaVersion = "25"
  // version of the GraalVM JDK
  // See Note [GraalVM Is Held At 25.0.1]
  val graalVersion = "25.0.1"
  // Version used for the Graal/Truffle related Maven packages
  // Keep in sync with GraalVM.version. Do not change the name of this variable,
  // it is used by the Rust build script via regex matching.
  // See Note [GraalVM Is Held At 25.0.1]
  val graalMavenPackagesVersion = "25.0.1"

  /* Note [GraalVM Is Held At 25.0.1]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * 25.0.2 breaks host-interop overload resolution. Its only Truffle change is
   * "Fixed overloaded method caching regression in HostExecuteNode", and that is
   * exactly what fails: HostExecuteNode.fillArgTypesArray asserts that its cached
   * argument types still validate against the overload it selected, and they do
   * not.
   *
   * Standard Library tests run with -enableassertions, so this surfaces as a hard
   * crash in Column_Operations_Spec under both the DuckDB and SQLite backends.
   * Verified one variable at a time, same commit, only this version changed:
   * 25.0.2 crashes DuckDB_Tests, 25.0.1 passes it.
   *
   * Without assertions the same defect silently selects a possibly-wrong
   * overload, so this is not a test-only concern.
   *
   * See https://github.com/jdunkerley/enso/issues/36 before bumping this.
   */

  def runningInAnIde: Boolean = {
    val idea = System.getProperty("idea.managed")
    idea != null && idea.nonEmpty
  }
  val targetJavaVersion     = if (runningInAnIde) "22" else "17"
  val defaultDevEnsoVersion = "0.0.0-dev"
  val ensoVersion = sys.env.getOrElse(
    "ENSO_VERSION",
    defaultDevEnsoVersion
  ) // Note [Engine And Launcher Version]
  val currentEdition = sys.env.getOrElse(
    "ENSO_EDITION",
    defaultDevEnsoVersion
  ) // Note [Default Editions]

  // Note [Stdlib Version]
  val stdLibVersion       = defaultDevEnsoVersion
  val targetStdlibVersion = ensoVersion
  val mavenUploadVersion  = "0.2-SNAPSHOT"

  // === Akka ===================================================================

  /* Note [Akka Is Frozen]
   * ~~~~~~~~~~~~~~~~~~~~~
   * `akkaVersion` and `akkaHTTPVersion` are deliberately NOT kept current.
   *
   * Akka relicensed from Apache-2.0 to the Business Source License with 2.7.0
   * (and akka-http with 10.3.0). 2.6.20 and 10.2.10 are the last Apache-2.0
   * releases, so these pins are a licence floor for the engine, not neglect.
   * Newer versions exist and a routine "sweep the stale dependencies" pass will
   * offer them — do not take them.
   *
   * The only real options are to stay here or to migrate to Apache Pekko (the
   * Apache-2.0 fork of Akka 2.6.x). Both are decisions, not upgrades.
   */
  def akkaPkg(name: String)     = akkaURL %% s"akka-$name" % akkaVersion
  def akkaHTTPPkg(name: String) = akkaURL %% s"akka-$name" % akkaHTTPVersion
  val akkaURL                   = "com.typesafe.akka"
  val akkaVersion               = "2.6.20"  // See Note [Akka Is Frozen]
  val akkaHTTPVersion           = "10.2.10" // See Note [Akka Is Frozen]
  val akkaMockSchedulerVersion  = "0.5.5"
  // Held at 1.0.3: 1.0.4 relicensed reactive-streams from CC0 to MIT-0.
  val reactiveStreamsVersion = "1.0.3"
  val sprayJsonVersion       = "1.3.6"
  val logbackClassicVersion  = "1.6.4"
  val javaDiffVersion        = "4.17"
  val logbackPkg = Seq(
    "ch.qos.logback" % "logback-classic" % logbackClassicVersion,
    "ch.qos.logback" % "logback-core"    % logbackClassicVersion
  )
  val akkaActor   = akkaPkg("actor")
  val akkaStream  = akkaPkg("stream")
  val akkaTestkit = akkaPkg("testkit")
  val akkaSLF4J   = akkaPkg("slf4j")
  val akkaHttp    = akkaHTTPPkg("http")
  val logbackTest = logbackPkg.map(_ % Test)
  val akka =
    Seq(
      akkaActor,
      akkaStream,
      akkaHttp
    )

  // === Cats ===================================================================

  val catsVersion = "2.13.0"
  // Not a direct dependency: pinned to what `circe-jawn` resolves, because the
  // JPMS wrappers in build.sbt look the jar up by exact version.
  val jawnParserVersion = "1.6.0"

  // === Circe ==================================================================

  /* Note [Scala Libraries Capped By scala-library]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * Scala 2.13 is only backwards binary compatible, so sbt (SIP-51) refuses to
   * resolve a library that was built against a newer scala-library than
   * `scalacVersion`. Several libraries below are therefore held at the newest
   * release built against scala-library <= `scalacVersion`, not their latest.
   * Bumping `scalacVersion` lifts the cap; re-check these when it moves:
   * circe (0.14.16 needs 2.13.18), jawn-parser (1.7.0), pureconfig (0.17.10),
   * jsoniter-scala (2.38.5+), scalacheck (1.20.0), decline (2.6.1+),
   * diffson (4.7.0+), zio (2.1.24+).
   */
  val circeVersion              = "0.14.15"
  val circeGenericExtrasVersion = "0.14.4"
  val circe = Seq("circe-core", "circe-generic", "circe-parser")
    .map("io.circe" %% _ % circeVersion)
  val snakeyamlVersion = "2.7"

  // === Commons ================================================================

  /* Note [Apache Commons On The Module Path]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * The engine runs on the module path. Newer Apache Commons releases replace
   * their automatic module with a real `module-info`, which is not a drop-in
   * change here, so commons-lang3, commons-io, commons-compress and commons-cli
   * are each held on their last automatic-module release:
   * - commons-lang3 3.14.0+ and commons-compress 1.24.0+ `requires java.desktop`,
   *   which the engine deliberately stays off (see the POI and JNA copies in
   *   `lib/java`).
   * - commons-io 2.14.0+ only requires `java.base`, but as an explicit module
   *   it is no longer readable by modules that use it without
   *   `requires org.apache.commons.io`. Scala sources compile anyway (scalac
   *   does not check module readability) and then fail at run time:
   *   `org.enso.distribution` does exactly this (`IllegalAccessError` in
   *   `LibraryUploadTest`).
   * - commons-cli 1.6.0+ renames the module from `commons.cli` to
   *   `org.apache.commons.cli`, which `engine-runner`, `engine-runner-common`
   *   and `language-server` require by the old name.
   * commons-compress is not a drop-in bump even past that: 1.25.0 made
   * `ArchiveInputStream` generic (breaks `lib/scala/downloader`), and 1.26.0+
   * add commons-io, commons-lang3 and commons-codec as runtime dependencies.
   * 1.26.0 fixes CVE-2024-25710 and CVE-2024-26308, so that move is worth doing
   * as its own change.
   */
  // commons-lang3, commons-io, commons-compress and commons-cli are held:
  // see Note [Apache Commons On The Module Path].
  val commonsCollectionsVersion = "4.4"
  val commonsLangVersion        = "3.13.0"
  val commonsIoVersion          = "2.13.0"
  val commonsTextVersion        = "1.15.0"
  val commonsMathVersion        = "3.6.1"
  val commonsCompressVersion    = "1.23.0"
  // Held at 1.5: 1.6.0 swaps its mail implementation from
  // `com.sun.mail:javax.mail` to `com.sun.mail:jakarta.mail`, a different
  // artifact under a different licence, so it needs a legal review of its own
  // rather than a version bump.
  val commonsEmailVersion = "1.5"
  val commonsCliVersion   = "1.5.0"
  val commons = Seq(
    "org.apache.commons" % "commons-collections4" % commonsCollectionsVersion,
    "org.apache.commons" % "commons-lang3"        % commonsLangVersion,
    "commons-io"         % "commons-io"           % commonsIoVersion,
    "org.apache.commons" % "commons-text"         % commonsTextVersion,
    "org.apache.commons" % "commons-math3"        % commonsMathVersion,
    "commons-cli"        % "commons-cli"          % commonsCliVersion
  )

  // === Helidon ================================================================
  val helidonVersion = "4.2.2"
  val helidon = {
    val clientAndSharedDeps = Seq(
      "io.helidon"               % "helidon"                     % helidonVersion,
      "io.helidon.builder"       % "helidon-builder-api"         % helidonVersion,
      "io.helidon.common"        % "helidon-common"              % helidonVersion,
      "io.helidon.common"        % "helidon-common-buffers"      % helidonVersion,
      "io.helidon.common"        % "helidon-common-config"       % helidonVersion,
      "io.helidon.common"        % "helidon-common-configurable" % helidonVersion,
      "io.helidon.common"        % "helidon-common-context"      % helidonVersion,
      "io.helidon.common"        % "helidon-common-key-util"     % helidonVersion,
      "io.helidon.common"        % "helidon-common-mapper"       % helidonVersion,
      "io.helidon.common"        % "helidon-common-media-type"   % helidonVersion,
      "io.helidon.common"        % "helidon-common-parameters"   % helidonVersion,
      "io.helidon.common"        % "helidon-common-resumable"    % helidonVersion,
      "io.helidon.common"        % "helidon-common-socket"       % helidonVersion,
      "io.helidon.common"        % "helidon-common-tls"          % helidonVersion,
      "io.helidon.common"        % "helidon-common-types"        % helidonVersion,
      "io.helidon.common"        % "helidon-common-uri"          % helidonVersion,
      "io.helidon.http"          % "helidon-http"                % helidonVersion,
      "io.helidon.http.encoding" % "helidon-http-encoding"       % helidonVersion,
      "io.helidon.http.media"    % "helidon-http-media"          % helidonVersion,
      "io.helidon.logging"       % "helidon-logging-common"      % helidonVersion,
      "io.helidon.logging"       % "helidon-logging-slf4j"       % helidonVersion,
      "io.helidon.metadata"      % "helidon-metadata-hson"       % helidonVersion,
      "io.helidon.service"       % "helidon-service-metadata"    % helidonVersion,
      "io.helidon.service"       % "helidon-service-registry"    % helidonVersion,
      "io.helidon.webclient"     % "helidon-webclient"           % helidonVersion,
      "io.helidon.webclient"     % "helidon-webclient-api"       % helidonVersion,
      "io.helidon.webclient"     % "helidon-webclient-http1"     % helidonVersion,
      "io.helidon.webclient"     % "helidon-webclient-websocket" % helidonVersion,
      "io.helidon.websocket"     % "helidon-websocket"           % helidonVersion
    )
    val serverDeps = Seq(
      "io.helidon.webserver"          % "helidon-webserver"                 % helidonVersion,
      "io.helidon.webserver"          % "helidon-webserver-websocket"       % helidonVersion,
      "io.helidon.config"             % "helidon-config"                    % helidonVersion,
      "io.helidon.common"             % "helidon-common-security"           % helidonVersion,
      "io.helidon.common.concurrency" % "helidon-common-concurrency-limits" % helidonVersion,
      "io.helidon.common.features"    % "helidon-common-features"           % helidonVersion,
      "io.helidon.common.features"    % "helidon-common-features-api"       % helidonVersion,
      "io.helidon.common"             % "helidon-common-task"               % helidonVersion,
      "io.helidon.logging"            % "helidon-logging-slf4j"             % helidonVersion,
      "io.helidon.metrics"            % "helidon-metrics-api"               % helidonVersion
    )
    clientAndSharedDeps ++ serverDeps
  }

  // === Jackson ================================================================

  val jacksonVersion = "2.22.3"
  // Since 2.20, jackson-annotations is versioned by minor only ("2.22", no
  // patch), so it cannot share `jacksonVersion`. Keep it on the same minor.
  val jacksonAnnotationsVersion = "2.22"

  // === Guava ==================================================================

  // `guavaVersion` itself is under "Other". Guava is an explicit JPMS module
  // that `requires transitive` failureaccess, so `interpreter-dsl` puts both on
  // its module path; this must equal the failureaccess `guavaVersion` depends on.
  val guavaFailureAccessVersion = "1.0.3"

  // === JAXB ================================================================

  val jaxbVersion = "4.0.5"
  val jaxb = Seq(
    "jakarta.xml.bind" % "jakarta.xml.bind-api" % jaxbVersion % Benchmark,
    "com.sun.xml.bind" % "jaxb-impl"            % jaxbVersion % Benchmark
  )
  val jaActivationVersion = "2.1.4"

  // === JMH ====================================================================

  val jmhVersion = "1.37"
  val jmh = Seq(
    "org.openjdk.jmh" % "jmh-core"                 % jmhVersion % Benchmark,
    "org.openjdk.jmh" % "jmh-generator-annprocess" % jmhVersion % Benchmark
  )

  // === Scala =========================================================
  val scalaReflect = Seq(
    "org.scala-lang" % "scala-reflect" % scalacVersion
  )
  val scalaLibrary = Seq(
    "org.scala-lang" % "scala-library" % scalacVersion
  )
  val scalaParserCombinatorsVersion = "1.1.2"
  // Held: this is Akka's own dependency (1.0.0), and Akka is frozen - see
  // Note [Akka Is Frozen].
  val scalaJavaCompatVersion       = "1.0.0"
  val scalaCollectionCompatVersion = "2.14.0"

  // === std-lib ================================================================

  // Has to match Truffle's ANTLR dependency version to avoid spurious warnings in Native Image
  val antlrVersion = "4.12.0"
  // `std-aws` uses AWS SDK for Java v2 only; every v2 artifact moves with this
  // (and the `bom` imported at the same version). v1 reached end of support in
  // December 2025 and is no longer shipped: it was only ever declared for the
  // Redshift driver, which dropped it in 2.2.0 - see
  // Note [Redshift Driver Declares Its AWS SDK As Optional].
  val awsJavaSdkV2Version = "2.55.6"
  // Held on the 73.x line: ICU 74 relicensed icu4j from the ICU licence to
  // Unicode-3.0, so moving past it is a legal review, not a version bump.
  val icuVersion = "73.2"
  // Held, together with `xmlbeansVersion`: `lib/java/poi-wrapper` shadows five
  // POI classes with modified copies of their 5.2.3 sources (to avoid a
  // dependency on `java.desktop`). A newer POI needs those copies re-derived
  // from its own sources first, otherwise old code runs against new internals.
  val poiOoxmlVersion         = "5.2.3"
  // See Note [Redshift Driver Declares Its AWS SDK As Optional].
  val redshiftVersion         = "2.2.9"
  val univocityParsersVersion = "2.9.1"
  val xmlbeansVersion         = "5.1.1"
  val tableauVersion          = "0.0.19691.r2d7e5bc8"

  /* Note [Redshift Driver Declares Its AWS SDK As Optional]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * `redshift-jdbc42` declares the AWS SDK modules of its IAM authentication
   * (`jdbc:redshift:iam://`, which `Redshift_Details` uses for every
   * `AWS_Credential`) as `<optional>` dependencies, so none of them is
   * resolved transitively and `std-aws` has to declare them itself. Since
   * driver 2.2.0 they are AWS SDK v2 - `auth`, `redshift`, `redshiftserverless`
   * and `sts` - which resolve here at `awsJavaSdkV2Version` rather than the
   * driver's own 2.31.x. Up to 2.1.x they were the v1
   * `aws-java-sdk-{core,redshift,redshiftserverless,sts}`, which is why v1
   * was declared here; nothing else used it, and the declaration outlived the
   * move to driver 2.2 unused. `sts` is what v2's `ProfileCredentialsProvider`
   * loads reflectively for a profile with `role_arn`, and `IamHelper` builds a
   * `redshiftserverless` client for a Redshift Serverless endpoint.
   *
   * The driver also uses `software.amazon.awssdk.http.apache` (the Apache
   * HttpClient 4 client) directly, on every IAM connection
   * (`IamHelper.setBuilderConfiguration`), without declaring it at all. It
   * used to arrive with the service modules; since the SDK made
   * `apache5-client` their default (during 2.45.x) they no longer bring it, so
   * `apache-client` is declared too. `std-aws`'s own S3 and SES clients do not
   * choose an HTTP client and get the SDK's highest-priority one,
   * `apache5-client`.
   *
   * All of these are loaded lazily, so a missing module fails a connection
   * with `NoClassDefFoundError`, never the build. Re-check the driver's POM
   * and its `software/amazon/awssdk` references whenever `redshiftVersion` or
   * `awsJavaSdkV2Version` moves.
   */

  // === ZIO ====================================================================

  /* Note [ZIO Is Held On 2.0.x]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * ZIO 2.1 is not a drop-in bump here. It pulls in `scala-collection-compat`
   * and izumi-reflect 3, and zio-interop-cats 23.0.0.7+ adds
   * `zio-interop-tracer`. `zio-wrapper` assembles all of ZIO's transitive
   * dependencies into one JPMS module with a hand-written `module-info.java`,
   * and `engine-runner` depends on `scala-collection-compat` directly, so the
   * move needs its own module-layout and native-image verification.
   *
   * `zioIzumiReflectVersion` must stay equal to the izumi-reflect that
   * `zioVersion` itself depends on: `zio-wrapper` bundles this version, while
   * the engine's legal review sees the one ZIO resolves.
   */
  val zioVersion             = "2.0.22"   // See Note [ZIO Is Held On 2.0.x]
  val zioInteropCatsVersion  = "23.0.0.6" // See Note [ZIO Is Held On 2.0.x]
  val zioIzumiReflectVersion = "2.3.8"    // See Note [ZIO Is Held On 2.0.x]
  val zio = Seq(
    "dev.zio" %% "zio"              % zioVersion,
    "dev.zio" %% "zio-interop-cats" % zioInteropCatsVersion
  )

  // === Bouncy Castle ==========================================================

  // Also GraalPy's dependency: `GraalVM.pythonPkgs` ships these jars at this
  // version in the engine distribution, so the two must not drift apart.
  val bouncyCastleVersion = "1.86"
  val bouncyCastle = Seq(
    "org.bouncycastle" % "bcutil-jdk18on" % bouncyCastleVersion,
    "org.bouncycastle" % "bcpkix-jdk18on" % bouncyCastleVersion,
    "org.bouncycastle" % "bcprov-jdk18on" % bouncyCastleVersion
  )

  // === JLine ==================================================================
  val jlineVersion = "3.26.3"
  val jlineNative = Seq(
    "org.jline" % "jline-native" % jlineVersion
  )
  val jline = Seq(
    "org.jline" % "jline-terminal"     % jlineVersion,
    "org.jline" % "jline-terminal-jni" % jlineVersion, // The terminal provider jna has been deprecated, check your configuration.
    "org.jline" % "jline-reader"       % jlineVersion
  ) ++ jlineNative

  // === Google =================================================================

  /* Note [Google Libraries Move With gRPC]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * `std-google`'s libraries share one gax / google-http-client / gRPC /
   * protobuf tree. The analytics clients decide it: gax-grpc resolves every
   * `io.grpc` artifact at one version, and protobuf-java at whatever their
   * generated code was built for (4.x since admin 0.93.0 / data 0.94.0).
   * - `grpcVersion` must equal the gRPC the analytics clients resolve, not the
   *   latest: it pins `grpc-netty-shaded` (and `grpc-wrapper`'s natives), and a
   *   newer one drags part of the gRPC tree up with it (grpc-api, -core, -util)
   *   while the rest stays behind. gRPC artifacts must share one version.
   * - The protobuf `std-google` ships in its `polyglot/java` is the one the
   *   analytics clients resolve, not `googleProtobufVersion`: that is the
   *   engine's and does not pin it (see Note [Engine protobuf-java]), so the
   *   two may differ.
   * - The Google BOM these clients import lifts conscrypt to 2.6.2, but
   *   `conscrypt-wrapper` (shared with `std-snowflake`) ships 2.5.2's natives,
   *   and grpc-alts, conscrypt's only user here, itself declares 2.5.2. So
   *   `std-google` holds conscrypt at `conscryptVersion`.
   * google-api-client 2.8.0+ moved google-http-client to 2.x; the analytics
   * clients use 2.x as well now, so they move together.
   * The licence review resolves dependencies through Ivy, which (unlike the
   * Coursier resolution that decides what ships) no longer sees
   * javax.annotation-api via api-common 2.69. `std-google` declares it
   * directly at `javaxAnnotationApiVersion`, which must equal what api-common
   * resolves, so the notices keep covering the jar that ships.
   */

  /* Note [Engine protobuf-java]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * `googleProtobufVersion` is the protobuf-java the engine ships in
   * `component/`, as a module `akka-wrapper` requires. Nothing in the engine
   * uses it (Akka's own protobuf is shaded into akka-protobuf-v3), and it pins
   * nothing in `std-google`. 4.x declares `Automatic-Module-Name:
   * com.google.protobuf`, which is the name `akka-wrapper` requires.
   */
  val googleApiClientVersion         = "2.9.1"
  val googleApiServicesSheetsVersion = "v4-rev20260610-2.0.0"
  val googleAnalyticsAdminVersion    = "0.108.0"
  val googleAnalyticsDataVersion     = "0.109.0"
  val grpcVersion                    = "1.83.0"
  // Shared by `std-google`, `std-snowflake` and `conscrypt-wrapper`, which
  // ships this version's natives. See Note [Google Libraries Move With gRPC].
  val conscryptVersion = "2.5.2"
  // See Note [Google Libraries Move With gRPC].
  val javaxAnnotationApiVersion = "1.3.2"

  // === SLF4J ==================================================================
  val slf4jVersion = "2.0.20"
  val slf4jApi = Seq(
    "org.slf4j" % "slf4j-api" % slf4jVersion
  )
  val slf4jNop       = "org.slf4j" % "slf4j-nop" % slf4jVersion
  val slf4jNopModule = "org.slf4j.nop"

  // === Other ==================================================================

  // decline, diffson, pureconfig, scalacheck and jsoniter-scala below:
  // see Note [Scala Libraries Capped By scala-library].
  val declineVersion          = "2.6.0"
  val diffsonVersion          = "4.6.1"
  val directoryWatcherVersion = "0.18.0"
  val flatbuffersVersion      = "24.3.25"
  val guavaVersion            = "33.7.1-jre"
  val jgitVersion             = "7.8.0.202609011348-r"
  val kindProjectorVersion    = "0.13.3"
  val mockitoScalaVersion     = "1.17.14"
  val mockitoJavaVersion      = "5.24.0"
  val newtypeVersion          = "0.4.4"
  val pprintVersion           = "0.8.1"
  val pureconfigVersion       = "0.17.9"
  val scalacheckVersion       = "1.19.0"
  val scalacticVersion        = "3.2.20"
  val scalaLoggingVersion     = "3.9.6"
  val scalameterVersion       = "0.21"
  val scalatestVersion        = "3.2.20"
  val sqliteVersion           = "3.53.4.0"
  val tikaVersion             = "2.4.1"
  val typesafeConfigVersion   = "1.4.9"
  val junitVersion            = "4.13.2"
  val junitIfVersion          = "0.13.3"
  val hamcrestVersion         = "1.3"
  val netbeansApiVersion      = "RELEASE180"
  val opencvVersion           = "4.9.0-0"
  val fansiVersion            = "0.5.1"
  // httpclient and httpcore are versioned separately upstream (4.5.x / 4.4.x).
  val httpClientVersion      = "4.5.14"
  val httpCoreVersion        = "4.4.16"
  val apacheArrowVersion     = "14.0.1"
  val `snowflakeJDBCVersion` = "4.0.1"
  val mssqlserverJDBCVersion = "13.6.0.jre11"
  // The Azure SDK brings its own Netty classes; `std-microsoft` pairs them with
  // the netty-tcnative natives from `nettyTcNativeBorringSSL`, which must not be
  // newer than Azure's netty-tcnative-classes. See Note [Netty Native Libraries].
  val azureIdentityVersion    = "1.18.6"
  val azureResourceVersion    = "2.64.0"
  val azureBlobStorageVersion = "12.35.1"
  val jsoniterVersion         = "2.38.4"
  // Held: `lib/java/jna-wrapper` shadows `com.sun.jna.Native` with a modified
  // copy of its 5.14.0 source (to avoid `java.desktop`). A newer JNA needs that
  // copy re-derived first, otherwise the old `Native` runs against newer JNA.
  val jnaVersion            = "5.14.0"
  val googleProtobufVersion = "4.36.2" // See Note [Engine protobuf-java]
  val shapelessVersion      = "2.3.13"
  val postgresVersion       = "42.7.13"
  // Not a one-line bump: `lib/java/duckdb-wrapper` replaces `org.duckdb.DuckDBNative`
  // with a copy of this version's source, whose `native` declarations must match the
  // JNI library in this jar, and the JNI lookups that library makes on load are listed
  // for Native Image in std-bits/duckdb's `reachability-metadata.json`. Re-derive both
  // from the new version's sources (`src/jni/refs.cpp`) when this moves.
  val duckdbVersion              = "1.5.5.1"
  val h2Version                  = "2.5.250"
  val jimFsVersion               = "1.3.2"
  val nettyTcNativeBorringSSL    = "2.0.74.Final"
  val nettyTransportEpollVersion = "4.1.118.Final"
  // ^ These two and the one below are Netty native-library pins, and all three
  // are held: see Note [Netty Native Libraries] below.
  val nettyResolverDnsNativeMacosVersion = "4.1.118.Final"
  // Not free to move: must equal the zstd-jni that `snowflake-jdbc-thin`
  // resolves. `std-snowflake` ships `zstd-jni-wrapper`'s repackaged copy at
  // this version, while its legal review follows the version snowflake-jdbc
  // resolves; bumping this alone ships a zstd-jni the notices do not describe.
  // Moves with `snowflakeJDBCVersion`.
  val zstdVersion = "1.5.6-5"

  /* Note [Netty Native Libraries]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * `netty-tc-native-wrapper`, `netty-epoll-native-wrapper` and
   * `netty-resolver-dns-native-macos-wrapper` extract only the JNI libraries
   * from these three versions. The Java classes that load them come
   * from whatever the consuming libraries resolve: Snowflake JDBC for
   * `std-snowflake` (netty 4.1.127, netty-tcnative-classes 2.0.74) and the
   * Azure SDK for `std-microsoft` (netty 4.1.137, 2.0.81 at the Azure pins). So
   * these are not free to move to their latest; checked on Linux x86_64 with
   * `OpenSsl.isAvailable()` / `Epoll.isAvailable()`, natives loaded from
   * `java.library.path` as the standard library loads them:
   * - A netty-tcnative native newer than the classes fails to load, and netty
   *   silently falls back to the JDK's TLS: 2.0.81 and 2.0.84 natives fail with
   *   2.0.74 classes. Older natives load: 2.0.74 works with 2.0.81 classes. So
   *   this must not exceed the oldest consumer (Snowflake, 2.0.74).
   * - The epoll native is meant for `std-snowflake` only, but currently ships
   *   nothing: `netty-epoll-native-wrapper` extracts from the classifier-less
   *   `netty-transport-native-epoll` jar, and the `.so` is only in its
   *   `linux-x86_64` classifier jar, so Snowflake falls back to NIO. Fixing
   *   that belongs with the Snowflake JDBC bump (#58). When it is fixed: 4.2.x
   *   natives fail with Snowflake's 4.1.127 classes, while 4.1.118 and 4.1.137
   *   load; match the 4.1.x that Snowflake resolves.
   * - The macOS DNS-resolver native (`nettyResolverDnsNativeMacosVersion`) is
   *   shipped by both. Its classes are netty-resolver-dns-classes-macos at
   *   4.1.127 (Snowflake) and 4.1.135 (Azure), so on the evidence above it must
   *   not be newer than 4.1.127. It is untested: the natives are macOS-only.
   * Neither consumer uses Netty 4.2 yet. Move these with `snowflakeJDBCVersion`.
   */
}
