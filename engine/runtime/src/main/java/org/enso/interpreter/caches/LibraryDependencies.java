package org.enso.interpreter.caches;

import com.oracle.truffle.api.TruffleLogger;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.logging.Level;
import org.enso.editions.LibraryName;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.pkg.QualifiedName;

/**
 * The other libraries a cache's IR refers to, each with the source hash ({@link
 * LibrarySourceHashes}) it had when the cache was written, and the modules in them that the IR
 * names. See Note [A Cache Records The Libraries It Refers To].
 *
 * @param libraries sorted by name
 * @param modules sorted
 */
public record LibraryDependencies(List<Library> libraries, List<String> modules) {
  public record Library(LibraryName name, String sourceHash) {}

  /** No other library: what a cache that refers to none records. */
  public static final LibraryDependencies NONE = new LibraryDependencies(List.of(), List.of());

  /* Note [A Cache Records The Libraries It Refers To]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A module's IR records what its names resolved to: `BindingsMap` and
   * `Resolution` metadata name the modules they point at
   * (`ModuleReference.Abstract`). When such a module is in another library,
   * the IR is only as good as that library's sources were when it was written.
   * The IR caches (`ModuleCache`, per module, and `ImportExportCache`, a
   * library's modules together) therefore record, next to their own digest,
   * the source hash of every other library their IR names, and are used only
   * while each still matches (#542, `CrossLibraryCacheTest`). Before, a
   * project's IR written while SQLite lived in `Standard.Database` failed after
   * the move (#468) with `Cannot convert Resolution(...)`, at run time, when a
   * method body was first called (bodies are read lazily).
   *
   * - The modules are collected while the IR is written: `CacheUtils`'s
   *   `writeReplace` sees every `ModuleReference.Abstract` that goes into the
   *   blob, so nothing a later read could trip over is missed, and no separate
   *   walk of the IR is needed.
   * - The cache's own library is left out. Inside it, a module's IR cache stays
   *   keyed by its own source and follows its imports (Note [A Cached Module
   *   Follows Its Library's Imports] in `Compiler`), so an edit costs that
   *   module and its importers, not the whole library or project (#541's
   *   review). A bindings cache is keyed by its own library's hash already.
   * - A library without a package (`Standard.Builtins`) is left out: it changes
   *   only with the engine, whose version keys the cache directories.
   * - The check is cheap. Each library is hashed once per context, and every
   *   imported library's bindings cache is checked against the same hash
   *   anyway. A library not loaded yet is loaded first, as resolving the cached
   *   IR would do a moment later.
   *
   * Why the hash, and not only checking that the named modules still exist:
   * `readResolve` fails ("Cannot convert") only when a named module is gone, but
   * a module that is still there may have lost the method the IR resolved to,
   * or gained a name that now resolves differently.
   *
   * The named modules are recorded and checked as well. A module can only go
   * away when its library's sources change, so with matching hashes the check
   * never fails; it is the safety net that makes "a cache that does not resolve
   * is a miss" hold for method bodies too, which are read long after the load
   * (Note [A Cache That Does Not Load Is A Miss] in `Cache`).
   *
   * Granularity: an edit anywhere in a library costs the caches that name it.
   * Released libraries never change; a standard-library developer recompiles
   * what depends on the library being edited.
   *
   * A cache written before this records neither; its metadata no longer reads,
   * so it is a miss and is rewritten.
   */

  /**
   * The other libraries the IR just written refers to, with their current source hashes.
   *
   * @param referenced the modules {@link CacheUtils#createPool} saw in the IR
   * @param own the cache's own library, left out
   * @return empty if the hash of one of them cannot be computed: the cache must not be written then
   */
  static Optional<LibraryDependencies> of(
      EnsoContext context, Set<QualifiedName> referenced, LibraryName own, TruffleLogger logger) {
    var hashes = new TreeMap<String, Library>();
    var modules = new ArrayList<String>();
    for (var module : referenced) {
      var library = libraryOf(module);
      if (library.isEmpty() || library.get().equals(own)) {
        continue;
      }
      var key = library.get().qualifiedName();
      if (!hashes.containsKey(key)) {
        var pkg = context.getPackageRepository().getPackageForLibraryJava(library.get());
        if (pkg.isEmpty()) {
          continue;
        }
        var hash = context.getLibrarySourceHashes().of(pkg.get(), logger);
        if (hash.isEmpty()) {
          return Optional.empty();
        }
        hashes.put(key, new Library(library.get(), hash.get()));
      }
      modules.add(module.toString());
    }
    modules.sort(Comparator.naturalOrder());
    return Optional.of(new LibraryDependencies(List.copyOf(hashes.values()), List.copyOf(modules)));
  }

  /**
   * The library a module belongs to, from its qualified name.
   *
   * @return empty for a name too short to have one
   */
  static Optional<LibraryName> libraryOf(QualifiedName module) {
    var path = module.pathAsJava();
    return path.size() >= 2
        ? Optional.of(new LibraryName(path.get(0), path.get(1)))
        : Optional.empty();
  }

  /**
   * Whether every library still has the sources the cache was written from, and every module the
   * cache names still exists.
   *
   * @param cacheName names the cache in the log
   */
  boolean areCurrent(EnsoContext context, String cacheName, TruffleLogger logger) {
    var repository = context.getPackageRepository();
    for (var library : libraries) {
      var name = library.name();
      if (!repository.isPackageLoaded(name) && repository.ensurePackageIsLoaded(name).isLeft()) {
        logger.log(
            Level.FINE,
            "The cache of [{0}] refers to [{1}], which cannot be loaded.",
            new Object[] {cacheName, name});
        return false;
      }
      var current =
          repository
              .getPackageForLibraryJava(name)
              .flatMap(pkg -> context.getLibrarySourceHashes().of(pkg, logger));
      if (current.isEmpty() || !current.get().equals(library.sourceHash())) {
        logger.log(
            Level.FINE,
            "The cache of [{0}] refers to [{1}], whose sources changed.",
            new Object[] {cacheName, name});
        return false;
      }
    }
    for (var module : modules) {
      if (repository.getLoadedModule(module).isEmpty()) {
        logger.log(
            Level.FINE,
            "The cache of [{0}] refers to the module [{1}], which no longer exists.",
            new Object[] {cacheName, module});
        return false;
      }
    }
    return true;
  }

  void write(DataOutputStream out) throws IOException {
    out.writeInt(libraries.size());
    for (var library : libraries) {
      out.writeUTF(library.name().namespace());
      out.writeUTF(library.name().name());
      out.writeUTF(library.sourceHash());
    }
    out.writeInt(modules.size());
    for (var module : modules) {
      out.writeUTF(module);
    }
  }

  static LibraryDependencies read(DataInputStream in) throws IOException {
    var librariesSize = checkedSize(in.readInt());
    var libraries = new ArrayList<Library>(librariesSize);
    for (var i = 0; i < librariesSize; i++) {
      var name = new LibraryName(in.readUTF(), in.readUTF());
      libraries.add(new Library(name, in.readUTF()));
    }
    var modulesSize = checkedSize(in.readInt());
    var modules = new ArrayList<String>(modulesSize);
    for (var i = 0; i < modulesSize; i++) {
      modules.add(in.readUTF());
    }
    return new LibraryDependencies(List.copyOf(libraries), List.copyOf(modules));
  }

  private static int checkedSize(int size) throws IOException {
    if (size < 0 || size > 1_000_000) {
      throw new IOException("Corrupted cache metadata: " + size + " entries");
    }
    return size;
  }
}
