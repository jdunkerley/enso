package org.enso.interpreter.caches;

import com.oracle.truffle.api.TruffleFile;
import com.oracle.truffle.api.TruffleLogger;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.logging.Level;
import org.enso.compiler.data.BindingsMap;
import org.enso.compiler.data.BindingsMap.DefinedEntity;
import org.enso.compiler.data.BindingsMap.ModuleReference;
import org.enso.editions.LibraryName;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.persist.Persistable;
import org.enso.persist.Persistance;
import org.enso.pkg.Package;
import org.enso.pkg.QualifiedName;
import org.enso.version.BuildVersion;

/**
 * A cache for import/export information about a library. import/export is represented by {@link
 * org.enso.compiler.core.ir.Module IR}.
 */
public final class ImportExportCache
    implements Cache.Spi<ImportExportCache.CachedBindings, ImportExportCache.Metadata> {

  private final LibraryName libraryName;
  private final boolean userCacheOnly;

  /** Stops a write once it is no longer wanted; {@code null} for a write that must finish. */
  private final BooleanSupplier abandoned;

  private ImportExportCache(
      LibraryName libraryName, boolean userCacheOnly, BooleanSupplier abandoned) {
    this.libraryName = libraryName;
    this.userCacheOnly = userCacheOnly;
    this.abandoned = abandoned;
  }

  /**
   * The library's bindings cache: read from the library's own (shipped) location, then from the
   * user cache; written to the library's location, or to the user cache if that is not writable.
   * See Note [A Rejected Bindings Cache Is Rewritten] in {@code TruffleCompilerContext}.
   */
  public static Cache<ImportExportCache.CachedBindings, ImportExportCache.Metadata> create(
      LibraryName libraryName) {
    var impl = new ImportExportCache(libraryName, false, null);
    return Cache.create(impl, Level.FINEST, libraryName.toString(), true, false);
  }

  /**
   * The library's bindings cache in the user cache only, for the rewrite of a rejected cache. See
   * Note [A Rejected Bindings Cache Is Rewritten] in {@code TruffleCompilerContext}.
   *
   * @param abandoned once {@code true}, a write in progress stops with an unchecked exception and
   *     leaves the cache as it was
   */
  public static Cache<ImportExportCache.CachedBindings, ImportExportCache.Metadata>
      createInUserCache(LibraryName libraryName, BooleanSupplier abandoned) {
    var impl = new ImportExportCache(libraryName, true, abandoned);
    return Cache.create(impl, Level.FINEST, libraryName.toString(), true, false);
  }

  @Override
  public String metadataSuffix() {
    return bindingsCacheMetadataExtension;
  }

  @Override
  public String dataSuffix() {
    return bindingsCacheDataExtension;
  }

  @Override
  public String entryName() {
    return libraryName.name();
  }

  @Override
  public byte[] metadata(
      EnsoContext context,
      String sourceDigest,
      String blobDigest,
      CachedBindings entry,
      Set<QualifiedName> referencedModules,
      TruffleLogger logger)
      throws IOException {
    var dependencies =
        LibraryDependencies.of(context, referencedModules, libraryName, logger)
            .orElseThrow(
                () -> new IOException("unable to hash the libraries " + libraryName + " uses"));
    return new Metadata(sourceDigest, blobDigest, dependencies).toBytes();
  }

  @Override
  public byte[] serialize(
      EnsoContext context, CachedBindings entry, Set<QualifiedName> referencedModules)
      throws IOException {
    var pool =
        CacheUtils.createPool(context.getCompiler().context(), true, referencedModules, abandoned);
    var arr = pool.write(entry.bindings());
    return arr;
  }

  /** See Note [A Cache Records The Libraries It Refers To] in {@link LibraryDependencies}. */
  @Override
  public boolean dependenciesAreCurrent(EnsoContext context, Metadata meta, TruffleLogger logger) {
    return meta.dependencies().areCurrent(context, libraryName.toString(), logger);
  }

  @Override
  public CachedBindings deserialize(
      EnsoContext context, ByteBuffer data, Metadata meta, TruffleLogger logger)
      throws IOException {
    var pool = CacheUtils.createPool(context.getCompiler().context(), true);
    var ref = pool.read(data);
    var bindings = ref.get(MapToBindings.class);
    return new CachedBindings(libraryName, bindings);
  }

  @Override
  public Metadata metadataFromBytes(byte[] bytes, TruffleLogger logger) throws IOException {
    return Metadata.read(bytes);
  }

  /** See Note [Library Caches Are Keyed By The Sources] in {@link LibrarySourceHashes}. */
  @Override
  public Optional<String> computeDigest(
      EnsoContext context, CachedBindings entry, TruffleLogger logger) {
    return CacheUtils.librarySourceHash(context, entry.libraryName(), logger);
  }

  @Override
  public Optional<String> computeDigestFromSource(EnsoContext context, TruffleLogger logger) {
    return CacheUtils.librarySourceHash(context, libraryName, logger);
  }

  @Override
  @SuppressWarnings("unchecked")
  public Iterable<TruffleFile> getCacheRoots(EnsoContext context) {
    var pkg = context.getPackageRepository().getPackageForLibraryJava(libraryName);

    if (pkg.isPresent()) {
      var userRoot = userCacheRoot(context, pkg.get());
      if (userCacheOnly) {
        return List.of(userRoot);
      }
      TruffleFile bindingsCacheRoot =
          pkg.get().getBindingsCacheRootForPackage(BuildVersion.ensoVersion());
      var libraryRoot = bindingsCacheRoot.resolve(libraryName.namespace());
      // The library's own location first: `enso --compile` writes the whole library there, while
      // a rewrite in the user cache holds only the modules a run compiled.
      return List.of(libraryRoot, userRoot);
    }
    return Collections.emptyList();
  }

  /**
   * Whether the library's own bindings-cache directory exists: `enso --compile` wrote a cache there
   * once, even if it has since been rejected and deleted. See Note [A Rejected Bindings Cache Is
   * Rewritten] in {@code TruffleCompilerContext}.
   *
   * @param context the language context
   * @param libraryName the library
   * @return {@code true} if the directory exists
   */
  public static boolean wasCompiled(EnsoContext context, LibraryName libraryName) {
    var pkg = context.getPackageRepository().getPackageForLibraryJava(libraryName);
    if (pkg.isEmpty()) {
      return false;
    }
    try {
      return pkg.get()
          .getBindingsCacheRootForPackage(BuildVersion.ensoVersion())
          .resolve(libraryName.namespace())
          .isDirectory();
    } catch (SecurityException e) {
      return false;
    }
  }

  /**
   * The user-cache location of the library's bindings cache: next to its per-module IR caches
   * (`ModuleCache`), which sit one level deeper, under the module's namespace.
   */
  private static TruffleFile userCacheRoot(EnsoContext context, Package<TruffleFile> pkg) {
    var path =
        context
            .getDistributionManager()
            .LocallyInstalledDirectories()
            .irCacheDirectory()
            .resolve(pkg.namespace())
            .resolve(pkg.normalizedName())
            .resolve(pkg.getConfig().version())
            .resolve(BuildVersion.ensoVersion());
    return context.getTruffleFile(path.toFile());
  }

  @Override
  public String sourceHash(Metadata meta) {
    return meta.sourceHash();
  }

  @Override
  public String blobHash(Metadata meta) {
    return meta.blobHash();
  }

  public static final class MapToBindings {
    private final java.util.Map<QualifiedName, org.enso.compiler.core.ir.Module> entries;

    public MapToBindings(java.util.Map<QualifiedName, org.enso.compiler.core.ir.Module> entries) {
      this.entries = entries;
    }

    public org.enso.compiler.core.ir.Module findForModule(QualifiedName moduleName) {
      return entries.get(moduleName);
    }
  }

  @Persistable(id = 3642)
  public static final class PersistMapToBindings extends Persistance<MapToBindings> {
    public PersistMapToBindings() {
      super(MapToBindings.class, false, 3642);
    }

    @Override
    protected void writeObject(MapToBindings obj, Output out) throws IOException {
      out.writeInline(java.util.Map.class, obj.entries);
    }

    @Override
    @SuppressWarnings("unchecked")
    protected MapToBindings readObject(Input in) throws IOException, ClassNotFoundException {
      var map = in.readInline(java.util.Map.class);
      return new MapToBindings(map);
    }
  }

  public static record CachedBindings(LibraryName libraryName, MapToBindings bindings) {}

  /** The source hash comes first: {@code ShippedCataloguesSpec} reads it. */
  public record Metadata(String sourceHash, String blobHash, LibraryDependencies dependencies) {
    byte[] toBytes() throws IOException {
      try (var os = new ByteArrayOutputStream();
          var dos = new DataOutputStream(os)) {
        dos.writeUTF(sourceHash());
        dos.writeUTF(blobHash());
        dependencies().write(dos);
        return os.toByteArray();
      }
    }

    static Metadata read(byte[] arr) throws IOException {
      try (var is = new ByteArrayInputStream(arr);
          var dis = new DataInputStream(is)) {
        return new Metadata(dis.readUTF(), dis.readUTF(), LibraryDependencies.read(dis));
      }
    }
  }

  private static final String bindingsCacheDataExtension = ".bindings";

  private static final String bindingsCacheMetadataExtension = ".bindings.meta";

  @Persistable(clazz = BindingsMap.PolyglotSymbol.class, id = 33006)
  @Persistable(
      clazz = org.enso.compiler.data.BindingsMap$ModuleReference$Abstract.class,
      id = 33007)
  @Persistable(clazz = BindingsMap.ResolvedImport.class, id = 33010)
  @Persistable(clazz = BindingsMap.Cons.class, id = 33011)
  @Persistable(clazz = BindingsMap.ResolvedModule.class, id = 33012)
  @Persistable(clazz = BindingsMap.ResolvedType.class, id = 33013)
  @Persistable(clazz = BindingsMap.ResolvedModuleMethod.class, id = 33014)
  @Persistable(clazz = BindingsMap.ResolvedExtensionMethod.class, id = 33015)
  @Persistable(clazz = BindingsMap.ResolvedConversionMethod.class, id = 33016)
  @Persistable(clazz = BindingsMap.ExportedModule.class, id = 33017)
  @Persistable(clazz = BindingsMap.Resolution.class, id = 33018)
  @Persistable(clazz = BindingsMap.ResolvedConstructor.class, id = 33019)
  @Persistable(clazz = BindingsMap.ResolvedPolyglotSymbol.class, id = 33020)
  @Persistable(clazz = BindingsMap.ResolvedPolyglotField.class, id = 33021)
  @Persistable(clazz = BindingsMap.ModuleMethod.class, id = 33022)
  @Persistable(clazz = BindingsMap.ExtensionMethod.class, id = 33023)
  @Persistable(clazz = BindingsMap.ConversionMethod.class, id = 33024)
  @Persistable(clazz = BindingsMap.Argument.class, id = 33025)
  @Persistable(clazz = BindingsMap.Type.class, id = 33026)
  @Persistable(id = 33055)
  public static final class PersistBindingsMap extends Persistance<BindingsMap> {
    public PersistBindingsMap() {
      super(BindingsMap.class, false, 33055);
    }

    @Override
    protected void writeObject(BindingsMap obj, Output out) throws IOException {
      out.writeObject(obj.definedEntities());
      out.writeObject(obj.currentModule());
      out.writeInline(scala.collection.immutable.List.class, obj.resolvedImports());
      out.writeInline(scala.collection.immutable.Map.class, obj.exportedSymbols());
    }

    @Override
    @SuppressWarnings("unchecked")
    protected BindingsMap readObject(Input in) throws IOException, ClassNotFoundException {
      var de = (scala.collection.immutable.List<DefinedEntity>) in.readObject();
      var cm = (ModuleReference) in.readObject();
      var imp = in.readInline(scala.collection.immutable.List.class);
      var sym = in.readInline(scala.collection.immutable.Map.class);
      var map = new BindingsMap(de, cm);
      map.resolvedImports(imp);
      map.exportedSymbols(sym);
      return map;
    }
  }
}
