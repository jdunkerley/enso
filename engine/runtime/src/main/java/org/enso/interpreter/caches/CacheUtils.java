package org.enso.interpreter.caches;

import com.oracle.truffle.api.TruffleLogger;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Function;
import org.enso.compiler.context.CompilerContext;
import org.enso.compiler.data.BindingsMap$ModuleReference$Abstract;
import org.enso.compiler.pass.IRPass;
import org.enso.editions.LibraryName;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.persist.Persistance;
import org.enso.pkg.QualifiedName;
import org.enso.text.Hex;

final class CacheUtils {
  private CacheUtils() {}

  static Persistance.Pool createPool(CompilerContext context, boolean keepUUIDs) {
    return createPool(context, keepUUIDs, null);
  }

  /**
   * @param referencedModules if not {@code null}, collects every module the written objects refer
   *     to. See Note [A Cache Records The Libraries It Refers To] in {@link LibraryDependencies}.
   */
  static Persistance.Pool createPool(
      CompilerContext context, boolean keepUUIDs, Set<QualifiedName> referencedModules) {
    return createPool(context, keepUUIDs, referencedModules, null);
  }

  /**
   * @param abandoned if not {@code null}, checked for every object written; once it is {@code true}
   *     the write stops with {@link WriteAbandoned}
   */
  static Persistance.Pool createPool(
      CompilerContext context,
      boolean keepUUIDs,
      Set<QualifiedName> referencedModules,
      BooleanSupplier abandoned) {
    return PersistUtils.POOL
        .withReadResolve(readResolve(context))
        .withWriteReplace(writeReplace(context, keepUUIDs, referencedModules, abandoned));
  }

  /** A write stopped because its result is no longer wanted (the process is exiting). */
  static final class WriteAbandoned extends RuntimeException {
    WriteAbandoned() {
      super("the cache write was abandoned", null, false, false);
    }
  }

  private static Function<Object, Object> writeReplace(
      CompilerContext context,
      boolean keepUUIDs,
      Set<QualifiedName> referencedModules,
      BooleanSupplier abandoned) {
    return (obj) -> {
      if (abandoned != null && abandoned.getAsBoolean()) {
        throw new WriteAbandoned();
      }
      return switch (obj) {
        case IRPass.IRMetadata metadata -> metadata.prepareForSerialization(context);
        case UUID id -> keepUUIDs ? id : null;
        case BindingsMap$ModuleReference$Abstract ref -> {
          if (referencedModules != null) {
            referencedModules.add(ref.name());
          }
          yield ref;
        }
        case null -> null;
        default -> obj;
      };
    };
  }

  private static Function<Object, Object> readResolve(CompilerContext context) {
    return (obj) ->
        switch (obj) {
          case IRPass.IRMetadata metadata -> {
            var option = metadata.restoreFromSerialization(context);
            if (option.nonEmpty()) {
              yield option.get();
            } else {
              throw raise(RuntimeException.class, new IOException("Cannot convert " + metadata));
            }
          }
          case null -> null;
          default -> obj;
        };
  }

  /**
   * Returns a default hashing algorithm used for Enso caches.
   *
   * @return digest used for computing hashes
   */
  private static MessageDigest messageDigest() {
    try {
      return MessageDigest.getInstance("SHA-1");
    } catch (NoSuchAlgorithmException ex) {
      throw raise(RuntimeException.class, ex);
    }
  }

  /**
   * Computes digest from an array of bytes using a default hashing algorithm.
   *
   * @param bytes bytes for which hash will be computed
   * @return string representation of bytes' hash
   */
  static String computeDigestFromBytes(ByteBuffer bytes) {
    var sha = messageDigest();
    sha.update(bytes);
    return Hex.toHexString(sha.digest());
  }

  /**
   * The source hash of a loaded library, which keys its caches. See Note [Library Caches Are Keyed
   * By The Sources] in {@link LibrarySourceHashes}.
   *
   * @return empty if the library is not loaded or its sources cannot be read
   */
  static Optional<String> librarySourceHash(
      EnsoContext context, LibraryName libraryName, TruffleLogger logger) {
    return context
        .getPackageRepository()
        .getPackageForLibraryJava(libraryName)
        .flatMap(pkg -> context.getLibrarySourceHashes().of(pkg, logger));
  }

  @SuppressWarnings("unchecked")
  static <T extends Exception> T raise(Class<T> cls, Exception e) throws T {
    throw (T) e;
  }
}
