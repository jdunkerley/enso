package org.enso.interpreter.runtime

import scala.jdk.OptionConverters.RichOption
import org.enso.common.HostEnsoUtils
import org.enso.compiler.PackageRepository
import org.enso.compiler.context.CompilerContext
import org.enso.compiler.core.ir.{Module => IRModule}
import com.oracle.truffle.api.TruffleFile
import com.typesafe.scalalogging.Logger
import org.apache.commons.lang3.StringUtils
import org.enso.common.MethodNames
import org.enso.editions.LibraryVersion
import org.enso.interpreter.runtime.util.TruffleFileSystem
import org.enso.librarymanager.published.repository.LibraryManifest
import org.enso.librarymanager.resolved.LibraryRoot
import org.enso.librarymanager.ResolvingLibraryProvider
import org.enso.logger.masking.MaskedPath
import org.enso.polyglot.runtime.Runtime.Api
import org.enso.pkg.{
  Component,
  ComponentGroup,
  ComponentGroups,
  ExtendedComponentGroup,
  NativeLibraryFinder,
  Package,
  PackageManager,
  QualifiedName,
  SourceFile
}
import org.enso.text.buffer.Rope
import org.enso.common.CompilationStage

import java.nio.file.Path
import scala.collection.immutable.ListSet
import scala.jdk.CollectionConverters.{
  CollectionHasAsScala,
  IterableHasAsJava,
  SeqHasAsJava
}
import scala.util.{Failure, Success, Try, Using}
import scala.util.control.NonFatal
import org.enso.distribution.locking.ResourceManager
import org.enso.distribution.{DistributionManager, LanguageHome}
import org.enso.editions.updater.EditionManager
import org.enso.editions.{DefaultEdition, Editions, LibraryName}
import org.enso.interpreter.runtime.builtin.Builtins
import org.enso.interpreter.runtime.instrument.NotificationHandler
import org.enso.interpreter.runtime.nativeimage.NativeLibrarySearchPath
import org.enso.librarymanager.DefaultLibraryProvider
import org.graalvm.nativeimage.ImageInfo
import org.slf4j.LoggerFactory

/** The default [[PackageRepository]] implementation.
  *
  * @param libraryProvider     the [[ResolvingLibraryProvider]] which resolves
  *                            which library version should be imported and
  *                            locates them (or downloads if they are missing)
  * @param context             the language context
  * @param builtins            the builtins module
  * @param notificationHandler a notification handler
  * @param preferLocalLibraries whether the project prefers local libraries, so
  *                            that a library missing from the edition may yet
  *                            appear among them
  */
private class DefaultPackageRepository(
  libraryProvider: ResolvingLibraryProvider,
  context: EnsoContext,
  builtins: Builtins,
  notificationHandler: NotificationHandler,
  preferLocalLibraries: Boolean
) extends PackageRepository {
  type TFile = TruffleFile

  private val logger = Logger[DefaultPackageRepository]

  implicit private val fs: TruffleFileSystem               = TruffleFileSystem.INSTANCE
  private val packageManager                               = new PackageManager[TruffleFile]
  private var projectPackage: Option[Package[TruffleFile]] = None

  /** The mapping containing all loaded packages.
    *
    * It should be modified only from within synchronized sections, but it may
    * be always read. Thus elements should be added to this mapping only after
    * all library loading bookkeeping has been finished - so that if other,
    * unsynchronized threads read this map, every element it contains is
    * already fully processed.
    */
  private val loadedPackages
    : collection.mutable.Map[LibraryName, Option[Package[TruffleFile]]] = {
    collection.mutable.LinkedHashMap(builtinsName -> None)
  }

  private def builtinsName: LibraryName = {
    LibraryName(
      MethodNames.Builtins.NAMESPACE,
      MethodNames.Builtins.PACKAGE_NAME
    )
  }

  /** The mapping containing loaded modules.
    *
    * We use [[String]] as the key as we often index into this map based on
    * qualified names that come from interop (via
    * [[org.enso.interpreter.runtime.scope.TopLevelScope]]). These arrive as
    * Strings, and constantly converting them into [[QualifiedName]]s would
    * add more overhead than is probably necessary.
    */
  private val loadedModules
    : collection.concurrent.Map[String, CompilerContext.Module] =
    collection.concurrent.TrieMap(
      MethodNames.Builtins.MODULE_NAME -> builtins.getModule.asCompilerModule()
    )

  /** The mapping containing loaded component groups.
    *
    * It should be modified and read only from within synchronized sections.
    * The component mapping is added to the collection after ensuring that the
    * corresponding library was loaded.
    */
  private val loadedComponents
    : collection.mutable.Map[LibraryName, ComponentGroups] = {
    collection.mutable.LinkedHashMap(builtinsName -> ComponentGroups.empty)
  }

  /** The libraries that could not be loaded, with the error each import of
    * them gets. Note [A Failed Library Is Remembered].
    */
  private val failedPackages: collection.concurrent.Map[LibraryName, Failed] =
    collection.concurrent.TrieMap()

  /** The failures reported to the notification handler, the last one of each
    * library. Note [A Failed Library Is Remembered].
    */
  private val reportedFailures: collection.concurrent.Map[LibraryName, Failed] =
    collection.concurrent.TrieMap()

  /** The libraries whose dependencies `getLibraryBindings` has loaded. */
  private val dependenciesLoaded: collection.mutable.Set[LibraryName] =
    collection.mutable.Set()

  private def getComponentModules: ListSet[CompilerContext.Module] = {
    val modules = for {
      componentGroups <- loadedComponents.values
      newComponents      = componentGroups.newGroups.flatMap(_.exports)
      extendedComponents = componentGroups.extendedGroups.flatMap(_.exports)
      component <- newComponents ++ extendedComponents
      module    <- findComponentModule(component)
    } yield module
    modules.to(ListSet)
  }

  private def findComponentModule(
    component: Component
  ): Option[CompilerContext.Module] = {
    def mkModuleName(path: Array[String]): String =
      path.mkString(LibraryName.separator.toString)
    @scala.annotation.tailrec
    def go(path: Array[String]): Option[CompilerContext.Module] =
      if (path.isEmpty) None
      else {
        loadedModules.get(mkModuleName(path)) match {
          case Some(module) => Some(module)
          case None         => go(path.init)
        }
      }

    go(component.name.split(LibraryName.separator))
  }

  /** @inheritdoc */
  override def getModuleMap: PackageRepository.ModuleMap = loadedModules

  /** @inheritdoc */
  override def freezeModuleMap: PackageRepository.FrozenModuleMap =
    loadedModules.toMap

  /** @inheritdoc */
  override def getComponents: PackageRepository.ComponentsMap =
    this.synchronized {
      loadedComponents.toMap
    }

  /** @inheritdoc */
  override def getPendingModules: ListSet[CompilerContext.Module] =
    this.synchronized {
      for {
        module <- getComponentModules
        isCompiled =
          module.getCompilationStage.isAtLeast(
            CompilationStage.AFTER_CODEGEN
          )
        if !isCompiled
      } yield module
    }

  /** @inheritdoc */
  override def registerMainProjectPackage(
    libraryName: LibraryName,
    pkg: Package[TruffleFile]
  ): Unit = {
    projectPackage = Some(pkg)
    if (!loadedPackages.contains(libraryName)) {
      registerPackageInternal(
        libraryName    = libraryName,
        pkg            = pkg,
        libraryVersion = LibraryVersion.Local,
        isLibrary      = false
      )
    }
  }

  /** @inheritdoc */
  override def getMainProjectPackage
    : Option[Package[com.oracle.truffle.api.TruffleFile]] = {
    projectPackage
  }

  /** Returns a package directory corresponding to the requested library */
  def getPackageForLibraryJava(
    libraryName: LibraryName
  ): java.util.Optional[Package[TruffleFile]] =
    getPackageForLibrary(libraryName).toJava

  private def registerPackageInternal(
    libraryName: LibraryName,
    libraryVersion: LibraryVersion,
    pkg: Package[TruffleFile],
    isLibrary: Boolean
  ): Unit = {
    val extensions = pkg.listPolyglotExtensions("java")
    extensions.foreach(context.addToClassPath(pkg, _))

    val (regularModules, syntheticModulesMetadata) = pkg
      .listSources()
      .map(srcFile =>
        (
          new Module(srcFile.qualifiedName, pkg, srcFile.file),
          inferSyntheticModules(srcFile)
        )
      )
      .unzip

    regularModules.foreach(m => registerModule(m.asCompilerModule()))

    syntheticModulesMetadata.flatten
      .groupMap(_._1)(v => (v._2, v._3))
      .foreach { case (qName, modulesWithSources) =>
        val source = modulesWithSources
          .map(_._2)
          .foldLeft("")(_ ++ "\n" ++ _)
        registerSyntheticModule(
          Module.synthetic(
            qName,
            pkg,
            Rope(source)
          ),
          modulesWithSources.map(_._1)
        )
      }

    // Note [Package Registered Before Notification]
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // The package must be in `loadedPackages` before `addedLibrary` is called.
    // The language server reacts to that notification by queueing a job that
    // loads the library's suggestions, and the job looks the library up with
    // `getPackageForLibrary`. When background jobs are already running it can
    // run before this method returns; with the old order it found no package,
    // loaded no suggestions, and a library loaded mid-session never reached the
    // GUI. The native library path is set first, as it must precede anything
    // that could load native code.
    if (isLibrary) {
      addNativeLibPath(pkg)
    }

    loadedPackages.put(libraryName, Some(pkg))

    if (isLibrary) {
      val root = Path.of(pkg.root.toString)
      notificationHandler.addedLibrary(libraryName, libraryVersion, root)
    }
  }

  /** If the package contains any native libraries, their parent directories are added to the
    * native library search path. This only works in native image.
    * @param pkg the package to check for native libraries
    */
  private def addNativeLibPath(
    pkg: Package[TruffleFile]
  ): Unit = {
    if (ImageInfo.inImageRuntimeCode()) {
      val nativeLibs = NativeLibraryFinder.listAllNativeLibraries(
        pkg,
        TruffleFileSystem.INSTANCE
      )
      val distinctParentDirs = nativeLibs.asScala
        .map(_.getParent)
        .toSet
      distinctParentDirs.foreach { dir =>
        logger.debug("Adding '{}' to native lib search path", dir.getPath)
        NativeLibrarySearchPath.addToSearchPath(dir.getPath)
      }
    }
  }

  /** For any given source file, infer data necessary to generate synthetic modules as well as their contents.
    * E.g., for A/B/C.enso it infers modules
    * - A.B that exports A.B.C
    * - A that exports A.B
    *
    * @param srcFile Enso source file to consider
    * @return a list of triples representing the name of submodule along the path, what submodule it exports and its contents
    */
  private def inferSyntheticModules(
    srcFile: SourceFile[TruffleFile]
  ): List[(QualifiedName, QualifiedName, String)] = {
    def listAllIntermediateModules(
      namespace: String,
      name: String,
      elements: List[String],
      exportItem: String
    ): List[(QualifiedName, QualifiedName, String)] = {
      elements match {
        case Nil =>
          Nil
        case lastModuleName :: parts =>
          val pathElems = elements.reverse
          val modName =
            s"${namespace}.$name.${pathElems.mkString(".")}.$exportItem"
          val modSource =
            s"""|import $modName
                |export $modName
                |""".stripMargin
          val syntheticModuleInfo = (
            QualifiedName(namespace :: name :: parts.reverse, lastModuleName),
            QualifiedName(namespace :: name :: pathElems, exportItem),
            modSource
          )
          syntheticModuleInfo :: listAllIntermediateModules(
            namespace,
            name,
            parts,
            lastModuleName
          )
      }
    }
    srcFile.qualifiedName.path match {
      case namespace :: name :: rest =>
        listAllIntermediateModules(
          namespace,
          name,
          rest.reverse,
          srcFile.qualifiedName.item
        )
      case _ =>
        Nil
    }
  }

  /** This package modifies the [[loadedPackages]], so it should be only
    * called from within synchronized sections.
    */
  private def loadPackage(
    libraryName: LibraryName,
    libraryVersion: LibraryVersion,
    root: LibraryRoot
  ): Either[PackageRepository.Error, Package[TruffleFile]] = Try {
    logger.debug(
      s"Loading library $libraryName from " +
      s"[${MaskedPath(root.location).applyMasking()}]."
    )
    val rootFile = context.findLibraryRootPath(root)
    val pkg      = packageManager.loadPackage(rootFile).get
    registerPackageInternal(
      libraryName    = libraryName,
      libraryVersion = libraryVersion,
      pkg            = pkg,
      isLibrary      = true
    )
    pkg
  }.toEither.left.map { error =>
    PackageRepository.Error.PackageLoadingError(error.getMessage)
  }

  /** @inheritdoc */
  override def initialize(): Either[PackageRepository.Error, Unit] =
    this.synchronized {
      val unprocessedPackages =
        loadedPackages.keySet
          .diff(loadedComponents.keySet)
          .flatMap(loadedPackages(_))
      unprocessedPackages.foldLeft[Either[PackageRepository.Error, Unit]](
        Right(())
      ) { (accumulator, pkg) =>
        for {
          _ <- accumulator
          _ <- resolveComponentGroups(pkg)
        } yield ()
      }
    }

  private def resolveComponentGroups(
    pkg: Package[TruffleFile]
  ): Either[PackageRepository.Error, Unit] =
    if (loadedComponents.contains(pkg.libraryName)) Right(())
    else {
      pkg.getConfig().componentGroups match {
        case None => Right(())
        case Some(componentGroups) =>
          registerComponentGroups(pkg.libraryName, componentGroups.newGroups)
          componentGroups.extendedGroups
            .foldLeft[Either[PackageRepository.Error, Unit]](Right(())) {
              (accumulator, componentGroup) =>
                for {
                  _ <- accumulator
                  extendedLibraryName = componentGroup.group.libraryName
                  _ <- ensurePackageIsLoaded(extendedLibraryName)
                  pkgOpt = loadedPackages(extendedLibraryName)
                  _ <- pkgOpt.fold[Either[PackageRepository.Error, Unit]](
                    Right(())
                  )(
                    resolveComponentGroups
                  )
                  _ = registerExtendedComponentGroup(
                    pkg.libraryName,
                    componentGroup
                  )
                } yield ()
            }
      }
    }

  /** Register the list of component groups defined by a library.
    *
    * @param library the library name
    * @param newGroups the list of component groups that the library defines
    */
  private def registerComponentGroups(
    library: LibraryName,
    newGroups: List[ComponentGroup]
  ): Unit =
    loadedComponents.updateWith(library) {
      case Some(groups) =>
        Some(groups.copy(newGroups = groups.newGroups ::: newGroups))
      case None =>
        Some(ComponentGroups(newGroups, List()))
    }

  /** Register a component group extended by a library.
    *
    * @param library the library name
    * @param group the extended component group
    */
  private def registerExtendedComponentGroup(
    library: LibraryName,
    group: ExtendedComponentGroup
  ): Unit =
    loadedComponents.updateWith(library) {
      case Some(groups) =>
        Some(groups.copy(extendedGroups = groups.extendedGroups :+ group))
      case None =>
        Some(ComponentGroups(List(), List(group)))
    }

  /** @inheritdoc */
  override def ensurePackageIsLoaded(
    libraryName: LibraryName
  ): Either[PackageRepository.Error, Unit] =
    ensureLoaded(libraryName, fromImport = false)

  /** @inheritdoc */
  override def ensurePackageIsLoadedForImport(
    libraryName: LibraryName
  ): Either[PackageRepository.Error, Unit] =
    ensureLoaded(libraryName, fromImport = true)

  /** Note [A Failed Library Is Remembered].
    *
    * @param fromImport whether an import asks for the library; only then is a
    *                   failure reported to the notification handler
    */
  private def ensureLoaded(
    libraryName: LibraryName,
    fromImport: Boolean
  ): Either[PackageRepository.Error, Unit] =
    if (loadedPackages.contains(libraryName)) Right(())
    else
      failedPackages.get(libraryName) match {
        case Some(failed) =>
          if (fromImport) report(libraryName, failed)
          Left(failed.error)
        case None => resolveAndLoadPackage(libraryName, fromImport)
      }

  private def resolveAndLoadPackage(
    libraryName: LibraryName,
    fromImport: Boolean
  ): Either[PackageRepository.Error, Unit] = {
    logger.trace(s"Resolving library $libraryName.")
    val resolvedLibrary =
      libraryProvider
        .findLibrary(libraryName)
        .left
        .map {
          case ResolvingLibraryProvider.Error.NotResolved(details) =>
            Failed(
              PackageRepository.Error.PackageCouldNotBeResolved(details),
              None,
              Api.LibraryLoadFailed.NotInEdition,
              details.getMessage
            )
          case ResolvingLibraryProvider.Error.DownloadFailed(version, reason) =>
            Failed(
              PackageRepository.Error.PackageDownloadFailed(reason),
              Some(version),
              Api.LibraryLoadFailed.DownloadFailed,
              reason.getMessage
            )
          case ResolvingLibraryProvider.Error.RequestedLocalLibraryDoesNotExist =>
            val message = "The local library has not been found on the " +
              "local libraries search paths."
            Failed(
              PackageRepository.Error.PackageLoadingError(message),
              Some(LibraryVersion.Local),
              Api.LibraryLoadFailed.LocalMissing,
              message
            )
        }
    resolvedLibrary match {
      case Left(failed) =>
        logger.warn(s"Resolution failed with [${failed.error}].")
      case Right(resolved) =>
        logger.debug(
          s"Found library ${resolved.toString(HostEnsoUtils.isAot())} " +
          s"at [${MaskedPath(resolved.root.location).applyMasking()}]."
        )
    }

    this.synchronized {
      // We check again inside of the monitor, in case that some other
      // thread has just added this library.
      if (loadedPackages.contains(libraryName)) Right(())
      else
        resolvedLibrary
          .flatMap { library =>
            loadPackage(library.name, library.version, library.root).left
              .map { error =>
                Failed(
                  error,
                  Some(library.version),
                  Api.LibraryLoadFailed.LoadingError,
                  error.toString
                )
              }
          }
          .left
          .map(rememberFailure(libraryName, fromImport, _))
          .flatMap { pkg =>
            reportedFailures.remove(libraryName)
            resolveComponentGroups(pkg)
          }
    }
  }

  /** A library that could not be loaded, with what the language server is
    * told about it.
    */
  private case class Failed(
    error: PackageRepository.Error,
    version: Option[LibraryVersion],
    kind: String,
    message: String
  )

  /* Note [A Failed Library Is Remembered]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A library that the edition does not define, or that cannot be downloaded,
   * fails the same way for every module that imports it. Without a memory,
   * each import would resolve it again, and a library missing from the caches
   * would be downloaded again every time: a project of N modules on an
   * unreachable repository made N identical failed requests (#600). So those
   * two failures (`NotInEdition`, `DownloadFailed`) are kept for the lifetime
   * of the repository (until `shutdown`, so a reopened project tries again),
   * and later lookups get the same error. A missing local library and one that
   * could not be loaded from disk are cheap to try and can be fixed while the
   * project is open (the library created, or its files repaired), so they are
   * tried again on every lookup; so is a library the edition does not define in
   * a project that prefers local libraries, which may yet create one.
   *
   * Only a failure an import meets is reported to the notification handler,
   * once per library and failure (again only if it changes, or after the
   * library loaded): the language server tells the IDE which libraries the
   * project's code could not load. Other lookups (a module asked for by name,
   * such as a visualization's, a cache's dependencies, service discovery) fail
   * quietly, as before; their callers report their own errors.
   */
  private def rememberFailure(
    libraryName: LibraryName,
    fromImport: Boolean,
    failed: Failed
  ): PackageRepository.Error = {
    val remembered = failed.kind match {
      case Api.LibraryLoadFailed.DownloadFailed => true
      // A project that prefers local libraries may yet get one of that name.
      case Api.LibraryLoadFailed.NotInEdition => !preferLocalLibraries
      case _                                  => false
    }
    val kept =
      if (remembered)
        failedPackages.putIfAbsent(libraryName, failed).getOrElse(failed)
      else failed
    if (fromImport) report(libraryName, kept)
    kept.error
  }

  private def report(libraryName: LibraryName, failed: Failed): Unit = {
    val same = reportedFailures.get(libraryName).exists { earlier =>
      earlier.kind == failed.kind && earlier.message == failed.message
    }
    if (!same) {
      reportedFailures.put(libraryName, failed)
      notificationHandler.libraryLoadFailed(
        libraryName,
        failed.version,
        failed.kind,
        failed.message
      )
    }
  }

  /** @inheritdoc */
  def isPackageLoaded(libraryName: LibraryName): Boolean = {
    loadedPackages.keySet.contains(libraryName)
  }

  /** @inheritdoc */
  override def getLoadedModules: Seq[CompilerContext.Module] =
    loadedModules.values.toSeq

  /** @inheritdoc */
  override def getLoadedPackages: Seq[Package[TruffleFile]] =
    loadedPackages.values.toSeq.flatten

  def getLoadedPackagesJava: java.lang.Iterable[Package[TruffleFile]] =
    loadedPackages.flatMap(_._2).asJava

  /** The installed libraries' packages, set once by [[installedPackages]]. */
  private val installedPackagesRef =
    new java.util.concurrent.atomic.AtomicReference[Seq[Package[TruffleFile]]]()

  /** The installed libraries' packages: their `package.yaml` is read, nothing
    * is registered or compiled. Computed once per context, on the first service
    * lookup (Note [Service Discovery Over Installed Libraries] in
    * `LookupServicesNode`).
    *
    * Not a `lazy val`: that would initialise under this object's monitor, which
    * `ensurePackageIsLoaded` also takes, while the listing takes cache locks and
    * reads every installed `package.yaml`. Two threads may compute it at once;
    * the first result is kept. A failure is logged and yields no packages.
    */
  private def installedPackages: Seq[Package[TruffleFile]] =
    Option(installedPackagesRef.get()).getOrElse {
      val computed =
        try {
          libraryProvider.findInstalledLibraries().flatMap { library =>
            Try(
              packageManager
                .loadPackage(context.findLibraryRootPath(library.root))
                .get
            ) match {
              case Success(pkg) => Some(pkg)
              case Failure(error) =>
                logger.warn(
                  s"Library ${library.name} is left out of service discovery: " +
                  error.getMessage
                )
                None
            }
          }
        } catch {
          case NonFatal(error) =>
            logger.warn(
              "Service discovery cannot list the installed libraries: " +
              error.getMessage,
              error
            )
            Nil
        }
      installedPackagesRef.compareAndSet(null, computed)
      installedPackagesRef.get()
    }

  /** The installed libraries that are not loaded yet, sorted by name. */
  def getInstalledUnloadedPackagesJava: java.util.List[Package[TruffleFile]] =
    installedPackages.filterNot(pkg => isPackageLoaded(pkg.libraryName)).asJava

  /** @inheritdoc */
  override def getLoadedModule(
    qualifiedName: String
  ): Option[CompilerContext.Module] =
    loadedModules.get(qualifiedName)

  /** @inheritdoc */
  override def registerModuleCreatedInRuntime(
    module: CompilerContext.Module
  ): Unit =
    registerModule(module)

  private def registerModule(module: CompilerContext.Module): Unit = {
    loadedModules.put(module.getName.toString, module)
  }

  override def registerSyntheticPackage(
    namespace: String,
    name: String
  ): Unit =
    loadedPackages.put(LibraryName(namespace, name), None)

  /** Registering synthetic module, unlike the non-compiler generated one, is conditional
    * in a sense that if a module already exists with a given name we only update its
    * list of synthetic modules that it should export.
    * If no module exists under the given name, we register the synthetic one.
    *
    * @param syntheticModule a synthetic module to register
    * @param refs list of names of modules that should be exported by the module under the given name
    */
  private def registerSyntheticModule(
    syntheticModule: Module,
    refs: List[QualifiedName]
  ): Unit = {
    org.enso.common.Asserts.assertInJvm(syntheticModule.isSynthetic)
    if (!loadedModules.contains(syntheticModule.getName.toString)) {
      loadedModules.put(
        syntheticModule.getName.toString,
        syntheticModule.asCompilerModule()
      )
    } else {
      val loaded = loadedModules(syntheticModule.getName.toString)
      org.enso.common.Asserts.assertInJvm(!loaded.isSynthetic)
      loaded
        .asInstanceOf[TruffleCompilerContext.Module]
        .unsafeModule()
        .setDirectModulesRefs(refs.asJava)
    }
  }

  override def deregisterModule(qualifiedName: String): Unit =
    loadedModules.remove(qualifiedName)

  /** @inheritdoc */
  override def renameProject(
    namespace: String,
    oldName: String,
    newName: String
  ): Unit = this.synchronized {
    renamePackages(namespace, oldName, newName)
    renameModules(namespace, oldName, newName)
  }

  private def renamePackages(
    namespace: String,
    oldName: String,
    newName: String
  ): Unit = {
    val toChange = loadedPackages.toSeq.filter { case (name, _) =>
      name.namespace == namespace && name.name == oldName
    }

    for ((key, _) <- toChange) {
      loadedPackages.remove(key)
    }

    for ((key, pkgOption) <- toChange) {
      val newPkg = pkgOption.map(_.setPackageName(newName))
      val newKey = key.copy(name = newName)
      loadedPackages.put(newKey, newPkg)
    }
  }

  private def renameModules(
    namespace: String,
    oldName: String,
    newName: String
  ): Unit = {
    val separator: String = QualifiedName.separator
    val keys = loadedModules.keySet.filter(name =>
      name.startsWith(namespace + separator + oldName + separator)
    )

    for {
      key    <- keys
      module <- loadedModules.remove(key)
    } {
      module
        .asInstanceOf[TruffleCompilerContext.Module]
        .unsafeModule()
        .renameProject(newName)
      loadedModules.put(module.getName.toString, module)
    }
  }

  override def isNamespaceRegistered(namespace: String): Boolean =
    loadedPackages.keySet.exists(_.namespace == namespace)

  override def getPackageForLibrary(
    libraryName: LibraryName
  ): Option[Package[TruffleFile]] =
    loadedPackages.get(libraryName).flatten

  override def getModulesForLibrary(
    libraryName: LibraryName
  ): List[CompilerContext.Module] =
    getPackageForLibrary(libraryName)
      .map(pkg => loadedModules.values.filter(_.getPackage == pkg).toList)
      .getOrElse(Nil)

  override def getLibraryBindings(
    libraryName: LibraryName,
    moduleName: QualifiedName,
    context: CompilerContext
  ): Option[IRModule] = {
    val cache = ensurePackageIsLoaded(libraryName).toOption.flatMap { _ =>
      if (dependenciesLoaded.add(libraryName)) {
        loadedPackages.get(libraryName).flatten.foreach(loadDependencies(_))
      }
      // Note [One Bindings Cache Read Per Library] in TruffleCompilerContext.
      context
        .asInstanceOf[TruffleCompilerContext]
        .libraryBindings(libraryName)
    }
    // A module missing from the cache is `None`, so that it is parsed: a cache rewritten by a run
    // holds only the modules it compiled (Note [A Rejected Bindings Cache Is Rewritten] in
    // TruffleCompilerContext).
    cache.flatMap(c => Option(c.bindings.findForModule(moduleName)))
  }

  private def loadDependencies(pkg: Package[TruffleFile]): Unit = {
    val manifestFile = fs.getChild(pkg.root, LibraryManifest.filename)
    readManifest(manifestFile)
      .flatMap(LibraryManifest.fromYaml(_))
      .foreach(
        _.dependencies.foreach(ensurePackageIsLoaded)
      )
  }

  private def readManifest(file: TruffleFile): Try[String] = {
    if (file.exists())
      Using(file.newBufferedReader) { reader =>
        StringUtils.join(reader.lines().iterator(), "\n")
      }
    else Failure(PackageManager.PackageNotFound("manifest"))
  }

  override def shutdown(): Unit = {
    loadedPackages.clear()
    loadedModules.clear()
    loadedComponents.clear()
    dependenciesLoaded.clear()
    failedPackages.clear()
    reportedFailures.clear()
    // Note [One Bindings Cache Read Per Library] in TruffleCompilerContext.
    context.getCompiler.context match {
      case truffle: TruffleCompilerContext => truffle.clearLibraryBindings()
      case _                               =>
    }
  }
}

private object DefaultPackageRepository {

  /** Creates a [[PackageRepository]] for the run.
    *
    * It tries to load and resolve the edition used in the project (or the
    * default edition), so that any libraries to be loaded can be resolved using
    * that edition.
    *
    * Edition and library search paths are based on the distribution and
    * language home (if it is provided).
    *
    * @param projectPackage      the package of the current project (if ran inside of a project)
    * @param languageHome        the language home (if set)
    * @param distributionManager the distribution manager
    * @param resourceManager     the resource manager instance
    * @param context             the context reference, needed to add polyglot libraries to
    *                            the classpath
    * @param builtins            the builtins that are always preloaded
    * @param notificationHandler a handler for library addition and progress
    *                            notifications
    * @return an initialized [[PackageRepository]]
    */
  def initializeRepository(
    projectPackage: Option[Package[TruffleFile]],
    languageHome: Option[String],
    editionOverride: Option[String],
    distributionManager: DistributionManager,
    resourceManager: ResourceManager,
    context: EnsoContext,
    builtins: Builtins,
    notificationHandler: NotificationHandler
  ): DefaultPackageRepository = {
    val rawEdition = editionOverride
      .map(v => Editions.Raw.Edition(parent = Some(v)))
      .orElse(
        projectPackage
          .flatMap(_.getConfig().edition)
      )
      .getOrElse(DefaultEdition.getDefaultEdition)

    val homeManager    = languageHome.map { home => LanguageHome(Path.of(home)) }
    val editionManager = EditionManager(distributionManager, homeManager)
    val logger         = LoggerFactory.getLogger(classOf[DefaultPackageRepository])
    val edition = editionManager
      .resolveEdition(rawEdition)
      .transform(
        e => Success(e),
        { err =>
          logger
            .warn(
              "Failed to resolve original edition. Trying fallback to the default one",
              err
            )
          editionManager.resolveEdition(DefaultEdition.getDefaultEdition)
        }
      )

    edition.failed.foreach { err =>
      logger.error(
        "Failed to resolve original edition. Fallback failed. Aborting",
        err
      )
    }

    val projectRoot = projectPackage.map { pkg =>
      val root = pkg.root
      Path.of(root.getCanonicalFile().toUri)
    }

    val resolvingLibraryProvider =
      DefaultLibraryProvider.make(
        distributionManager = distributionManager,
        resourceManager     = resourceManager,
        lockUserInterface   = notificationHandler,
        progressReporter    = notificationHandler,
        languageHome        = homeManager,
        edition             = edition.get,
        preferLocalLibraries =
          projectPackage.exists(_.getConfig().preferLocalLibraries),
        projectRoot = projectRoot,
        checkAot    = HostEnsoUtils.isAot()
      )
    new DefaultPackageRepository(
      resolvingLibraryProvider,
      context,
      builtins,
      notificationHandler,
      projectPackage.exists(_.getConfig().preferLocalLibraries)
    )
  }
}
