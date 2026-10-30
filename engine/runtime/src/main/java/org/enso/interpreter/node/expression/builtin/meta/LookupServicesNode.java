package org.enso.interpreter.node.expression.builtin.meta;

import com.oracle.truffle.api.CompilerDirectives;
import com.oracle.truffle.api.TruffleFile;
import com.oracle.truffle.api.exception.AbstractTruffleException;
import com.oracle.truffle.api.interop.TruffleObject;
import com.oracle.truffle.api.nodes.Node;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import java.util.logging.Level;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.node.callable.InteropApplicationNode;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.UnresolvedConversion;
import org.enso.interpreter.runtime.control.ThreadInterruptedException;
import org.enso.interpreter.runtime.data.EnsoObject;
import org.enso.interpreter.runtime.data.Type;
import org.enso.interpreter.runtime.data.text.Text;
import org.enso.interpreter.runtime.data.vector.ArrayLikeHelpers;
import org.enso.interpreter.runtime.error.DataflowError;
import org.enso.interpreter.runtime.error.PanicException;
import org.enso.pkg.Package;
import org.enso.pkg.QualifiedName;
import org.enso.scala.wrapper.ScalaConversions;

/*
 * Note [Service Discovery Over Installed Libraries]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `Meta.lookup_services` returns the providers of every library the project can resolve without a
 * download (`ResolvingLibraryProvider.findInstalledLibraries`), not only of the loaded ones, so a
 * backend appears in `Database.connect`'s dropdown and a SQLite file reads without an import.
 * - Order: the loaded libraries' providers first, in loading order, then the others by library
 *   name, so results are stable.
 * - Cost: the installed libraries' `package.yaml` files are read once per context, on the first
 *   lookup (`DefaultPackageRepository.getInstalledUnloadedPackagesJava`), outside the repository's
 *   lock; nothing is compiled until a provider of the requested service is resolved, which loads
 *   its library and compiles the provider's module. `loaded_only` skips the installed ones, for
 *   callers that stop at their first match.
 * - Staleness: that list is fixed for the context's lifetime, so a library installed or created
 *   while a project is open is discovered after the project is reopened. The language server's
 *   `library/listPublicTypes` uses the same listing (`InstalledLibraries.find`) but recomputes it
 *   on each request, so the two agree on what counts as installed, not at every moment.
 * - Failures: anything that goes wrong with a provider of a library discovery itself loads (the
 *   library fails to load, its module fails to compile, the type or its conversion is missing, or
 *   the conversion throws) is logged at WARNING and the provider is skipped; so is a failure to
 *   list the installed libraries at all. A loaded library's broken registration stays a dataflow
 *   error (a warning on the result), as before.
 */

@BuiltinMethod(
    type = "Meta",
    name = "lookup_services",
    description = "Looks services registered by a name up")
public abstract class LookupServicesNode extends Node {
  /** Protected for mocking purposes */
  protected LookupServicesNode() {}

  public static LookupServicesNode build() {
    return new LookupServicesNode() {
      @Override
      protected Iterable<Implementation> findImplementationsFor(Type service, boolean loadedOnly) {
        return super.defaultImplementationsFor(service, loadedOnly);
      }
    };
  }

  /**
   * One registration of a service provider.
   *
   * @param type supplies the provider's type; see {@link #findImplementationsFor}
   * @param installed whether the provider belongs to a library that discovery loads (Note [Service
   *     Discovery Over Installed Libraries]): its failures are logged and skipped rather than
   *     reported as dataflow errors
   */
  protected record Implementation(Supplier<Type> type, boolean installed) {
    /** A provider of a library that is already loaded. */
    public static Implementation loaded(Supplier<Type> type) {
      return new Implementation(type, false);
    }
  }

  @CompilerDirectives.TruffleBoundary
  private final Type findType(QualifiedName fqn, String namespace, String name) {
    var ensoCtx = EnsoContext.get(this);

    var path = fqn.pathAsJava();
    if (path.size() < 2 || !namespace.equals(path.get(0)) || !name.equals(path.get(1))) {
      var err = ensoCtx.getBuiltins().error().makeModuleNotInPackageError();
      throw new PanicException(err, this);
    }

    var module =
        switch (fqn.getParent().isDefined() ? 1 : 0) {
          case 1 -> {
            var moduleName = fqn.getParent().get();
            yield ensoCtx.getTopScope().getModule(moduleName.toString()).orElse(null);
          }
          default -> null;
        };
    if (module == null) {
      var err = ensoCtx.getBuiltins().error().makeModuleDoesNotExistError(fqn.toString());
      throw new PanicException(err, this);
    }
    var scope = module.compileScope(ensoCtx);
    assert !module.needsCompilation() : "Unsufficient stage of " + module;

    var typeName = fqn.item();
    var implType = scope.getType(typeName, true);
    if (implType == null) {
      var sb = new StringBuilder();
      sb.append("Cannot find type ")
          .append(typeName)
          .append(" in ")
          .append(module.getName())
          .append(" module");
      var sep = ". Only found ";
      for (var typ : scope.getAllTypes()) {
        sb.append(sep);
        sb.append(typ.getName());
        sep = ", ";
      }
      var err = ensoCtx.getBuiltins().error().makeModuleDoesNotExistError(sb.toString());
      throw new PanicException(err, this);
    }
    return implType;
  }

  /**
   * Implements the lookup of all type registrations for given {@code service} type. This method is
   * protected to allow unit testing with mocks. The expected implementation is supposed to find all
   * possible registrations and return them as {@link Iterable}. Each element's supplier can either
   * return the Type implementing the service or yield {@link AbstractTruffleException} (like {@link
   * PanicException}) to signal that the registration is there, but broken. A supplier may also
   * return {@code null}: a provider of an installed library that could not be loaded, already
   * logged and to be skipped.
   *
   * @param service the type to find implementations for
   * @param loadedOnly only the libraries already loaded, so that nothing new is loaded
   * @return iterable with the registrations
   */
  protected abstract Iterable<Implementation> findImplementationsFor(
      Type service, boolean loadedOnly);

  private Iterable<Implementation> defaultImplementationsFor(Type service, boolean loadedOnly) {
    var found = new ArrayList<Implementation>();
    var repository = EnsoContext.get(this).getPackageRepository();
    var serviceName = service.getQualifiedName();
    for (var p : repository.getLoadedPackagesJava()) {
      for (var with : providersOf(p, serviceName)) {
        found.add(Implementation.loaded(() -> findType(with, p.namespace(), p.name())));
      }
    }
    if (!loadedOnly) {
      for (var p : repository.getInstalledUnloadedPackagesJava()) {
        for (var with : providersOf(p, serviceName)) {
          found.add(new Implementation(() -> loadAndFindType(p, with), true));
        }
      }
    }
    return found;
  }

  private static List<QualifiedName> providersOf(Package<?> p, QualifiedName service) {
    var providers = new ArrayList<QualifiedName>();
    for (var registration : ScalaConversions.asJava(p.getConfig().services())) {
      if (service.equals(registration.provides())) {
        providers.add(registration.with());
      }
    }
    return providers;
  }

  /**
   * Loads {@code p} and finds the provider {@code with} in it.
   *
   * <p>This path runs only for libraries discovery itself loads, so any failure in it (a library
   * that fails to load, a module that fails to compile, a missing type, or an unexpected runtime
   * exception from the compiler) is logged and the provider skipped.
   *
   * @return the provider's type, or {@code null} (logged) when the library cannot be loaded or the
   *     type cannot be found or compiled
   */
  @CompilerDirectives.TruffleBoundary
  private Type loadAndFindType(Package<TruffleFile> p, QualifiedName with) {
    try {
      var loaded =
          EnsoContext.get(this).getPackageRepository().ensurePackageIsLoaded(p.libraryName());
      if (loaded.isLeft()) {
        logSkipped("Skipping the services of {0}: {1}", p.libraryName(), loaded);
        return null;
      }
      return findType(with, p.namespace(), p.name());
    } catch (ThreadInterruptedException ex) {
      throw ex;
    } catch (RuntimeException ex) {
      // A panic, a CompilerError or anything else the loading and the compiler throw.
      logSkipped("Skipping the service provider {0}: {1}", with, ex.getMessage());
      return null;
    }
  }

  @CompilerDirectives.TruffleBoundary
  private void logSkipped(String message, Object subject, Object reason) {
    EnsoContext.get(this)
        .getLogger(LookupServicesNode.class)
        .log(Level.WARNING, message, new Object[] {subject, reason});
  }

  @CompilerDirectives.TruffleBoundary
  public final EnsoObject execute(Type fqn, boolean loadedOnly) {
    var ensoCtx = EnsoContext.get(this);
    var collect = new ArrayList<Object>();
    for (var implementation : findImplementationsFor(fqn, loadedOnly)) {
      Type implType = null;
      try {
        // the get() call may yield AbstractTruffleException
        implType = implementation.type().get();
        if (implType == null) {
          continue;
        }
        var conversion = UnresolvedConversion.build(implType.getDefinitionScope());
        var state = ensoCtx.currentState();
        var node = InteropApplicationNode.getUncached();
        var fn = conversion.resolveFor(ensoCtx, fqn, implType);
        if (fn == null) {
          var msg =
              "No conversion from "
                  + implType.getQualifiedName()
                  + " to "
                  + fqn.getQualifiedName()
                  + " found";
          if (implementation.installed()) {
            logSkipped("Skipping the service provider {0}: {1}", implType.getQualifiedName(), msg);
          } else {
            collect.add(DataflowError.withDefaultTrace(Text.create(msg), this));
          }
          continue;
        }
        var obj = node.execute(fn, state, new Object[] {fqn, implType});
        collect.add(obj);
      } catch (AbstractTruffleException ex) {
        if (implementation.installed()) {
          var provider = implType == null ? fqn.getQualifiedName() : implType.getQualifiedName();
          logSkipped("Skipping the service provider {0}: {1}", provider, ex.getMessage());
        } else {
          collect.add(DataflowError.withDefaultTrace(Text.create(ex.getMessage()), this));
        }
      }
    }
    var arr = collect.toArray(TruffleObject[]::new);
    return ArrayLikeHelpers.asVectorWithCheckAt((Object[]) arr);
  }
}
