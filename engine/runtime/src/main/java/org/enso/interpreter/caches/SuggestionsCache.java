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
import java.util.logging.Level;
import org.enso.editions.LibraryName;
import org.enso.interpreter.caches.SuggestionsCache.CachedSuggestions;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.persist.Persistable;
import org.enso.pkg.QualifiedName;
import org.enso.polyglot.Suggestion;
import org.enso.version.BuildVersion;

@Persistable(clazz = CachedSuggestions.class, id = 30301)
@Persistable(clazz = Suggestion.Constructor.class, id = 30303)
@Persistable(clazz = Suggestion.Conversion.class, id = 30304)
@Persistable(clazz = Suggestion.DefinedMethod.class, id = 30305)
@Persistable(clazz = Suggestion.Function.class, id = 30306)
@Persistable(clazz = Suggestion.Getter.class, id = 30307)
@Persistable(clazz = Suggestion.Local.class, id = 30308)
@Persistable(clazz = Suggestion.Module.class, id = 30309)
@Persistable(clazz = Suggestion.Type.class, id = 30310)
@Persistable(clazz = Suggestion.Argument.class, id = 30311)
@Persistable(clazz = LibraryName.class, id = 30312)
public final class SuggestionsCache
    implements Cache.Spi<SuggestionsCache.CachedSuggestions, SuggestionsCache.Metadata> {
  private static final String SUGGESTIONS_CACHE_DATA_EXTENSION = ".suggestions";
  private static final String SUGGESTIONS_CACHE_METADATA_EXTENSION = ".suggestions.meta";

  final LibraryName libraryName;

  private SuggestionsCache(LibraryName libraryName) {
    this.libraryName = libraryName;
  }

  public static Cache<SuggestionsCache.CachedSuggestions, SuggestionsCache.Metadata> create(
      LibraryName libraryName) {
    var impl = new SuggestionsCache(libraryName);
    var logName = "Suggestions(" + libraryName + ")";
    return Cache.create(impl, Level.FINE, logName, true, false);
  }

  @Override
  public String metadataSuffix() {
    return SUGGESTIONS_CACHE_METADATA_EXTENSION;
  }

  @Override
  public String dataSuffix() {
    return SUGGESTIONS_CACHE_DATA_EXTENSION;
  }

  @Override
  public String entryName() {
    return libraryName.name();
  }

  /**
   * Records no other libraries: suggestions name other libraries' types only as text. See Note [A
   * Cache Records The Libraries It Refers To] in {@link LibraryDependencies}.
   */
  @Override
  public byte[] metadata(
      EnsoContext context,
      String sourceDigest,
      String blobDigest,
      CachedSuggestions entry,
      Set<QualifiedName> referencedModules,
      TruffleLogger logger)
      throws IOException {
    return new Metadata(sourceDigest, blobDigest).toBytes();
  }

  @Override
  public byte[] serialize(
      EnsoContext context, CachedSuggestions entry, Set<QualifiedName> referencedModules)
      throws IOException {
    var pool = CacheUtils.createPool(context.getCompiler().context(), true);
    return pool.write(entry);
  }

  @Override
  public CachedSuggestions deserialize(
      EnsoContext context, ByteBuffer data, Metadata meta, TruffleLogger logger)
      throws IOException {
    var pool = CacheUtils.createPool(context.getCompiler().context(), true);
    var ref = pool.read(data);
    var cachedSuggestions = ref.get(CachedSuggestions.class);
    return cachedSuggestions;
  }

  @Override
  public Metadata metadataFromBytes(byte[] bytes, TruffleLogger logger) throws IOException {
    return Metadata.read(bytes);
  }

  /** See Note [Library Caches Are Keyed By The Sources] in {@link LibrarySourceHashes}. */
  @Override
  public Optional<String> computeDigest(
      EnsoContext context, CachedSuggestions entry, TruffleLogger logger) {
    return CacheUtils.librarySourceHash(context, entry.libraryName(), logger);
  }

  @Override
  public Optional<String> computeDigestFromSource(EnsoContext context, TruffleLogger logger) {
    return CacheUtils.librarySourceHash(context, libraryName, logger);
  }

  @Override
  public Iterable<TruffleFile> getCacheRoots(EnsoContext context) {
    var pkg = context.getPackageRepository().getPackageForLibraryJava(libraryName);
    if (pkg.isEmpty()) {
      return Collections.emptyList();
    } else {
      var bindingsCacheRoot =
          pkg.get().getSuggestionsCacheRootForPackage(BuildVersion.ensoVersion());
      var distributionRoot = bindingsCacheRoot.resolve(libraryName.namespace());
      return Collections.singletonList(distributionRoot);
    }
  }

  @Override
  public String sourceHash(Metadata meta) {
    return meta.sourceHash();
  }

  @Override
  public String blobHash(Metadata meta) {
    return meta.blobHash();
  }

  /**
   * @param libraryName
   * @param suggestions Must not be null.
   */
  public record CachedSuggestions(LibraryName libraryName, List<Suggestion> suggestions) {}

  public record Metadata(String sourceHash, String blobHash) {
    byte[] toBytes() throws IOException {
      try (var os = new ByteArrayOutputStream();
          var dos = new DataOutputStream(os)) {
        dos.writeUTF(sourceHash());
        dos.writeUTF(blobHash());
        return os.toByteArray();
      }
    }

    static Metadata read(byte[] arr) throws IOException {
      try (var is = new ByteArrayInputStream(arr);
          var dis = new DataInputStream(is)) {
        return new Metadata(dis.readUTF(), dis.readUTF());
      }
    }
  }
}
