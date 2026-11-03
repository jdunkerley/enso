package org.enso.interpreter.caches;

import com.oracle.truffle.api.TruffleFile;
import com.oracle.truffle.api.TruffleLogger;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import org.enso.pkg.Package;

/**
 * The source hashes ({@link Package#sourceHash()}) of the libraries a context's caches have asked
 * about, each computed once. See Note [Library Caches Are Keyed By The Sources].
 */
public final class LibrarySourceHashes {
  /** By the package's root directory: the same library name may be at another root. */
  private final ConcurrentHashMap<String, String> hashes = new ConcurrentHashMap<>();

  /**
   * The library's source hash, computed on the first request.
   *
   * @return empty if the sources cannot be read; the caches are then neither read nor written
   */
  public Optional<String> of(Package<TruffleFile> pkg, TruffleLogger logger) {
    var key = pkg.root().getAbsoluteFile().getPath();
    try {
      return Optional.of(
          hashes.computeIfAbsent(
              key,
              k -> {
                var start = System.nanoTime();
                var hash = pkg.sourceHash();
                logger.log(
                    Level.FINE,
                    "Hashed the sources of [{0}] in {1} ms.",
                    new Object[] {pkg.libraryName(), (System.nanoTime() - start) / 1_000_000});
                return hash;
              }));
    } catch (RuntimeException e) {
      logger.log(Level.WARNING, "Cannot hash the sources of [" + pkg.libraryName() + "]", e);
      return Optional.empty();
    }
  }

  /** Forgets the library's hash, so that the next request reads its sources again. */
  public void forget(Package<TruffleFile> pkg) {
    hashes.remove(pkg.root().getAbsoluteFile().getPath());
  }

  /* Note [Library Caches Are Keyed By The Sources]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A library's bindings cache (`ImportExportCache`) and suggestions cache
   * (`SuggestionsCache`) record the library's `Package.sourceHash` (the hash
   * its `catalogue.json` records too) as their source digest, and are used only
   * while it matches the library's sources. A module's IR cache (`ModuleCache`)
   * records the digest of the module's own source together with that hash: the
   * IR holds what the module's names resolved to in the other modules of its
   * library, which its own source does not determine. (`Compiler.runInternal`
   * recompiles a cached module whose import was compiled from source, but not
   * under `--no-compile-dependencies`, which is how `indexStdLibs` compiles.)
   *
   * Before #473 the two library caches were keyed by the library's name, and
   * the IR cache by the module's source alone. Two trees of a library with the
   * same name and version then used each other's caches (every checkout of a
   * development build shares the per-user IR caches, and a bindings cache
   * travels with a copied tree), and a library edited on disk kept loading its
   * old IR until its `.enso` directory was deleted. A cache written before
   * records another digest, so it is discarded and rebuilt once, never read.
   *
   * The hash is computed once per library per context (Base, about 200 files
   * and 1.6 MB: ~40 ms warm, ~170 ms in a cold JVM) and then kept. So the IR
   * caches written in a session that edited a library's files record the hash
   * the library had when the session first asked, and the next session
   * rebuilds them once: a stale hash makes a cache miss, never a wrong hit.
   * `serializeLibrary` forgets the hash first, so that `enso --compile`
   * records the sources it compiled.
   *
   * Not covered: a cache records its own library's sources, not those of the
   * libraries it depends on.
   *
   * The standard libraries ship their bindings and suggestions caches, written
   * by `indexStdLibs` from the files that ship; `ShippedCataloguesSpec` checks
   * that each records its library's hash.
   */
}
