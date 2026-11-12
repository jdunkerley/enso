package org.enso.interpreter.runtime;

import com.oracle.truffle.api.CompilerDirectives;
import com.oracle.truffle.api.interop.ArityException;
import com.oracle.truffle.api.interop.InteropException;
import com.oracle.truffle.api.interop.InteropLibrary;
import com.oracle.truffle.api.interop.TruffleObject;
import com.oracle.truffle.api.interop.UnsupportedTypeException;
import com.oracle.truffle.api.library.ExportLibrary;
import com.oracle.truffle.api.library.ExportMessage;
import com.oracle.truffle.api.source.Source;
import java.io.File;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.enso.common.HostEnsoUtils;
import org.enso.interpreter.runtime.util.TruffleFileSystem;
import org.enso.pkg.NativeLibraryFinder;
import org.enso.pkg.Package;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Handles a polyglot Java system for loading classes from a single source. <em>Single source</em>
 * is a collection of Java modules/libraries/JARs that belong together.
 */
final class EnsoPolyglotJava {
  private static final Logger logger = LoggerFactory.getLogger(EnsoPolyglotJava.class);
  private static final EnsoContext.Extra<CtxData> KEY =
      new EnsoContext.Extra<>(CtxData.class, CtxData::new);

  private final EnsoContext ctx;

  /**
   * Current classpath. This list can grow over time, but already added entries to the list shall
   * not be modified. Processing of the elemetns works in orchestration with {@link #classPathSize}.
   */
  private final List<File> classPath;

  /**
   * The amount of elements from {@link #classPath} already processed and added to {@link
   * #polyglotJava}. @GuardedBy("classPath").
   *
   * @see #ensureClassPathIsUpToDate
   */
  private int classPathSize;

  /**
   * Few state object encapsulating communication with the Java {@link TruffleObject} to communicate
   * with.
   *
   * <ul>
   *   <li>{@code this} - not yet initialized
   *   <li>some {@code Throwable} - there was an error initializing
   *   <li>non-{@code null} value - the actual object to talk with
   *   <li>{@code null} - the runtime is (being) closed
   * </ul>
   *
   * @GuardedBy("this")
   */
  private Object polyglotJava = this;

  /**
   * @param ctx associated conext
   * @param growingPath classpath that may receive new entries incrementally - just make sure the
   *     list is ready for multi threaded read access
   */
  private EnsoPolyglotJava(EnsoContext ctx, List<File> growingPath) {
    this.ctx = ctx;
    this.classPath = growingPath;
  }

  /**
   * Performs a lookup for a Java class.
   *
   * @param className the {@code .} separated class name to look for
   * @param collectExceptions reported exceptions are put into this array
   * @return {@code null} on failure or an object representing the {@code className}
   */
  final TruffleObject lookupJavaClass(
      Package<?> requestedBy, String className, Collection<? super Exception> collectExceptions) {
    var binaryName = new StringBuilder(className);
    for (; ; ) {
      var fqn = binaryName.toString();
      try {
        var hostSymbol = loadClass(fqn, requestedBy);

        if (hostSymbol != null) {
          return hostSymbol;
        }

      } catch (RuntimeException | InteropException ex) {
        collectExceptions.add(ex);
      }
      var at = fqn.lastIndexOf('.');
      if (at < 0) {
        break;
      }
      binaryName.setCharAt(at, '$');
    }
    return null;
  }

  /**
   * Finds the "polyglot Java" for the given context. Every library loads its Java through the host
   * class loader: on the JVM any library can, and in the native image only the libraries whose Java
   * is compiled into the image (see {@link #javaNotInImage}).
   *
   * @param ctx the context to query for
   * @return instance of "polyglot Java" for further queries
   */
  static EnsoPolyglotJava find(EnsoContext ctx) {
    return KEY.get(ctx).hosted;
  }

  /* Note [A Library's Java Must Be In The Native Image]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * The native engine can load only the Java compiled into its image: the libraries marked AOT
   * ready by `EnsoLibraryFeature`, and the JDK classes the image registers. Other libraries
   * used to run their Java in a guest JVM started inside the process (`jvm-interop`); that is gone
   * (docs/superpowers/specs/2026-11-09-remove-native-image-design.md, A1). A class such a library
   * asks for, and the image does not have, is an error naming the library and the way to run it
   * on the JVM instead. On the JVM every library's Java loads, so this never applies there.
   */

  /**
   * The error to report when a class {@code pkgOrNull} asked for could not be loaded, because the
   * library's Java is not part of the native image (Note [A Library's Java Must Be In The Native
   * Image]).
   *
   * @param aot whether this is the native image ({@link HostEnsoUtils#isAot()})
   * @param pkgOrNull the library that asked for the class, or {@code null} for code outside of any
   * @return the message, or {@code null} when the library's Java is available
   */
  static String javaNotInImage(boolean aot, Package<?> pkgOrNull) {
    if (!aot || pkgOrNull == null || pkgOrNull.isAotReady()) {
      return null;
    }
    return pkgOrNull.libraryName().qualifiedName()
        + "'s Java is not part of the native engine. Run on the JVM: `enso --jvm`, `jvm: true` in"
        + " package.yaml, or `ENSO_ENGINE_MODE=jvm` in the IDE.";
  }

  static void close(EnsoContext ctx) {
    KEY.get(ctx).hosted.close();
  }

  @CompilerDirectives.TruffleBoundary
  private TruffleObject findPolyglotJava() throws InteropException {
    while (true) {
      Object pj;
      synchronized (this) {
        pj = polyglotJava;
      }
      if (pj instanceof Throwable t) {
        throw ctx.raiseAssertionPanic(null, t.getMessage(), t);
      }
      if (pj instanceof TruffleObject polyJava) {
        ensureClassPathIsUpToDate(polyJava);
        return polyJava;
      }
      pj = createPolyglotJava(ctx);
      assert pj != null;
      try {
        InteropLibrary.getUncached().invokeMember(pj, "findLibraries", new LibraryResolver());
      } catch (InteropException ex) {
        logger.warn("Cannot register findLibraries", ex);
      }
      synchronized (this) {
        if (polyglotJava == this) {
          polyglotJava = pj;
        }
      }
    }
  }

  /**
   * Makes sure all the entries from {@link #classPath} are added to {@code polyJava} runtime. Call
   * this method before trying to load a class from the runtime.
   *
   * @param polyJava the runtime for loading Java classes
   * @throws InteropException
   */
  private void ensureClassPathIsUpToDate(TruffleObject polyJava) throws InteropException {
    var iop = InteropLibrary.getUncached();
    while (true) {
      int indexToAdd;
      synchronized (classPath) {
        indexToAdd = classPathSize;
        if (indexToAdd >= classPath.size()) {
          // all elements of classPath already added to associated runtime
          return;
        }
      }

      var elem = classPath.get(indexToAdd);
      // multiple concurrent threads can add the same classpath element
      // that's OK, classpath elements can be duplicated
      iop.invokeMember(polyJava, "addPath", elem.toString());

      synchronized (classPath) {
        // only after an indexToAdd element is added
        // we make sure the classPathSize is at least one higher than the index
        if (classPathSize <= indexToAdd) {
          classPathSize = indexToAdd + 1;
        }
      }
    }
  }

  /** Adds {@code path} to the classpath every library loads its Java from. */
  static void addToClassPath(EnsoContext ctx, Object whoIsIgnored, File path)
      throws InteropException {
    var data = KEY.get(ctx);
    data.classPath.add(path);
  }

  @CompilerDirectives.TruffleBoundary
  private final void close() {
    TruffleObject toClose = null;
    synchronized (this) {
      if (polyglotJava == null) {
        return;
      }
      if (polyglotJava instanceof TruffleObject closeJava) {
        toClose = closeJava;
      }
      polyglotJava = null;
    }
    // one thread is selected {@code toClose}
    if (toClose != null) {
      try {
        InteropLibrary.getUncached().invokeMember(toClose, "close");
      } catch (InteropException ex) {
        logger.warn("Cannot close " + toClose, ex);
      }
    }
  }

  private Object createPolyglotJava(EnsoContext ctx) throws IllegalStateException {
    var src = Source.newBuilder("epb", "java:0#hosted", "<Bindings>").build();
    var target = ctx.parseInternal(src);
    return target.call();
  }

  private final TruffleObject loadClass(String fqn, Package<?> requestedBy)
      throws InteropException {
    var raw = InteropLibrary.getUncached().readMember(findPolyglotJava(), fqn);
    logger.debug(
        "Classloading of {} as {} requested by {}",
        fqn,
        raw,
        requestedBy == null ? "null" : requestedBy.libraryName());
    return (TruffleObject) raw;
  }

  @ExportLibrary(InteropLibrary.class)
  static final class LibraryResolver implements TruffleObject {

    @ExportMessage
    @CompilerDirectives.TruffleBoundary
    Object execute(Object[] args) throws ArityException, UnsupportedTypeException {
      if (args.length != 1) {
        throw ArityException.create(1, 1, args.length);
      }
      if (args[0] instanceof String libname) {
        var pkgRepo = EnsoContext.get(null).getPackageRepository();
        for (var pkg : pkgRepo.getLoadedPackagesJava()) {
          var libPath =
              NativeLibraryFinder.findNativeLibrary(libname, pkg, TruffleFileSystem.INSTANCE);
          if (libPath != null) {
            return libPath;
          }
        }
      }
      throw UnsupportedTypeException.create(args);
    }

    @ExportMessage
    boolean isExecutable() {
      return true;
    }
  }

  private static final class CtxData {
    private final List<File> classPath;
    private final EnsoPolyglotJava hosted;

    CtxData(EnsoContext ctx) {
      this.classPath = new CopyOnWriteArrayList<>();
      this.hosted = new EnsoPolyglotJava(ctx, classPath);
    }
  }
}
