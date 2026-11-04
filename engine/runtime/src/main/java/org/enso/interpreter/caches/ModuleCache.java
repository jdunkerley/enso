package org.enso.interpreter.caches;

import com.oracle.truffle.api.TruffleFile;
import com.oracle.truffle.api.TruffleLogger;
import com.oracle.truffle.api.source.Source;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Optional;
import java.util.Set;
import java.util.logging.Level;
import org.apache.commons.lang3.StringUtils;
import org.enso.common.CompilationStage;
import org.enso.compiler.core.ir.Module;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.pkg.QualifiedName;
import org.enso.version.BuildVersion;

public final class ModuleCache
    implements Cache.Spi<ModuleCache.CachedModule, ModuleCache.Metadata> {
  private final org.enso.interpreter.runtime.Module module;

  private ModuleCache(org.enso.interpreter.runtime.Module module) {
    this.module = module;
  }

  public static Cache<ModuleCache.CachedModule, ModuleCache.Metadata> create(
      org.enso.interpreter.runtime.Module module) {
    var mc = new ModuleCache(module);
    return Cache.create(mc, Level.FINEST, module.getName().toString(), true, false);
  }

  @Override
  public String metadataSuffix() {
    return irCacheMetadataExtension;
  }

  @Override
  public String dataSuffix() {
    return irCacheDataExtension;
  }

  @Override
  public String entryName() {
    return module.getName().item();
  }

  @Override
  public byte[] metadata(
      EnsoContext context,
      String sourceDigest,
      String blobDigest,
      CachedModule entry,
      Set<QualifiedName> referencedModules,
      TruffleLogger logger)
      throws IOException {
    var own = LibraryDependencies.libraryOf(module.getName()).orElse(null);
    var dependencies =
        LibraryDependencies.of(context, referencedModules, own, logger)
            .orElseThrow(
                () ->
                    new IOException("unable to hash the libraries " + module.getName() + " uses"));
    return new Metadata(sourceDigest, blobDigest, entry.compilationStage().toString(), dependencies)
        .toBytes();
  }

  @Override
  public byte[] serialize(
      EnsoContext context, CachedModule entry, Set<QualifiedName> referencedModules)
      throws IOException {
    var pool = CacheUtils.createPool(context.getCompiler().context(), true, referencedModules);
    var arr = pool.write(entry.moduleIR());
    return arr;
  }

  /** See Note [A Cache Records The Libraries It Refers To] in {@link LibraryDependencies}. */
  @Override
  public boolean dependenciesAreCurrent(EnsoContext context, Metadata meta, TruffleLogger logger) {
    return meta.dependencies().areCurrent(context, module.getName().toString(), logger);
  }

  @Override
  public CachedModule deserialize(
      EnsoContext context, ByteBuffer data, Metadata meta, TruffleLogger logger)
      throws IOException {
    var pool = CacheUtils.createPool(context.getCompiler().context(), true);
    var ref = pool.read(data);
    var mod = ref.get(Module.class);
    return new CachedModule(
        mod, CompilationStage.valueOf(meta.compilationStage()), module.getSource());
  }

  @Override
  public Metadata metadataFromBytes(byte[] bytes, TruffleLogger logger) throws IOException {
    return Metadata.read(bytes);
  }

  private Optional<String> computeDigestOfModuleSources(Source source) {
    if (source != null) {
      byte[] sourceBytes;
      if (source.hasBytes()) {
        sourceBytes = source.getBytes().toByteArray();
      } else {
        sourceBytes = source.getCharacters().toString().getBytes(StandardCharsets.UTF_8);
      }
      return Optional.of(CacheUtils.computeDigestFromBytes(ByteBuffer.wrap(sourceBytes)));
    } else {
      return Optional.empty();
    }
  }

  /**
   * The digest of the module's own source. What its names resolved to in the modules it imports is
   * not part of it: see Note [A Cached Module Follows Its Library's Imports] in {@code Compiler}
   * and, for other libraries, Note [A Cache Records The Libraries It Refers To] in {@link
   * LibraryDependencies}.
   */
  @Override
  public Optional<String> computeDigest(
      EnsoContext context, CachedModule entry, TruffleLogger logger) {
    return computeDigestOfModuleSources(entry.source());
  }

  @Override
  public Optional<String> computeDigestFromSource(EnsoContext context, TruffleLogger logger) {
    try {
      return computeDigestOfModuleSources(module.getSource());
    } catch (IOException e) {
      logger.log(Level.FINEST, "failed to retrieve the source of " + module.getName(), e);
      return Optional.empty();
    }
  }

  @Override
  public Iterable<TruffleFile> getCacheRoots(EnsoContext context) {
    if (module != context.getBuiltins().getModule()) {
      var pkg = context.getPackageOf(module.getSourceFile());
      if (pkg.isPresent()) {
        var qualName = module.getName();
        var distribution = context.getDistributionManager();
        var pathSegmentsJava = new ArrayList<String>();
        pathSegmentsJava.addAll(
            Arrays.asList(
                pkg.get().namespace(),
                pkg.get().normalizedName(),
                pkg.get().getConfig().version(),
                BuildVersion.ensoVersion()));
        pathSegmentsJava.addAll(qualName.pathAsJava());
        var path =
            distribution.LocallyInstalledDirectories()
                .irCacheDirectory()
                .resolve(StringUtils.join(pathSegmentsJava, "/"));
        var perUser = context.getTruffleFile(path.toFile());
        return Collections.singletonList(perUser);
      }
    }
    return Collections.emptyList();
  }

  @Override
  public String sourceHash(Metadata meta) {
    return meta.sourceHash();
  }

  @Override
  public String blobHash(Metadata meta) {
    return meta.blobHash();
  }

  public record CachedModule(Module moduleIR, CompilationStage compilationStage, Source source) {}

  public record Metadata(
      String sourceHash,
      String blobHash,
      String compilationStage,
      LibraryDependencies dependencies) {
    byte[] toBytes() throws IOException {
      try (var os = new ByteArrayOutputStream();
          var dos = new DataOutputStream(os)) {
        dos.writeUTF(sourceHash());
        dos.writeUTF(blobHash());
        dos.writeUTF(compilationStage());
        dependencies().write(dos);
        return os.toByteArray();
      }
    }

    static Metadata read(byte[] arr) throws IOException {
      try (var is = new ByteArrayInputStream(arr);
          var dis = new DataInputStream(is)) {
        return new Metadata(
            dis.readUTF(), dis.readUTF(), dis.readUTF(), LibraryDependencies.read(dis));
      }
    }
  }

  private static final String irCacheDataExtension = ".ir";

  private static final String irCacheMetadataExtension = ".meta";
}
