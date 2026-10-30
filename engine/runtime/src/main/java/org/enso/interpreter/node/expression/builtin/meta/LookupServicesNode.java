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
import org.enso.compiler.core.CompilerError;
import org.enso.interpreter.dsl.BuiltinMethod;
import org.enso.interpreter.node.callable.InteropApplicationNode;
import org.enso.interpreter.runtime.EnsoContext;
import org.enso.interpreter.runtime.callable.UnresolvedConversion;
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
 * - Cost: the installed libraries' `package.yaml` files are read once per context
 *   (`DefaultPackageRepository.installedPackages`); nothing is compiled until a provider of the
 *   requested service is resolved, which loads its library and compiles the provider's module.
 *   `loaded_only` skips the installed ones, for callers that stop at their first match.
 * - Failures: a library that discovery loads and that fails to load or compile is skipped with a
 *   logged warning; a loaded library's broken registration stays a dataflow error, as before.
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
      protected Iterable<Supplier<Type>> findImplementationsFor(Type service, boolean loadedOnly) {
        return super.defaultImplementationsFor(service, loadedOnly);
      }
    };
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
   * possible registrations and return them as {@link Iterable}. Each element of the iterable is
   * "supplier" that can either return the Type implementing the service or yield {@link
   * AbstractTruffleException} (like {@link PanicException}) to signal that the registration is
   * there, but broken. A supplier may also return {@code null}: a provider of an installed library
   * that could not be loaded, already logged and to be skipped.
   *
   * @param service the type to find implementations for
   * @param loadedOnly only the libraries already loaded, so that nothing new is loaded
   * @return iterable with suppliers of types
   */
  protected abstract Iterable<Supplier<Type>> findImplementationsFor(
      Type service, boolean loadedOnly);

  private Iterable<Supplier<Type>> defaultImplementationsFor(Type service, boolean loadedOnly) {
    var found = new ArrayList<Supplier<Type>>();
    var repository = EnsoContext.get(this).getPackageRepository();
    var serviceName = service.getQualifiedName();
    for (var p : repository.getLoadedPackagesJava()) {
      for (var with : providersOf(p, serviceName)) {
        found.add(() -> findType(with, p.namespace(), p.name()));
      }
    }
    if (!loadedOnly) {
      for (var p : repository.getInstalledUnloadedPackagesJava()) {
        for (var with : providersOf(p, serviceName)) {
          found.add(() -> loadAndFindType(p, with));
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
   * @return the provider's type, or {@code null} (logged) when the library cannot be loaded or the
   *     type cannot be found or compiled
   */
  @CompilerDirectives.TruffleBoundary
  private Type loadAndFindType(Package<TruffleFile> p, QualifiedName with) {
    var ensoCtx = EnsoContext.get(this);
    var logger = ensoCtx.getLogger(LookupServicesNode.class);
    var loaded = ensoCtx.getPackageRepository().ensurePackageIsLoaded(p.libraryName());
    if (loaded.isLeft()) {
      logger.log(
          Level.WARNING,
          "Skipping the services of {0}: {1}",
          new Object[] {p.libraryName(), loaded});
      return null;
    }
    try {
      return findType(with, p.namespace(), p.name());
    } catch (AbstractTruffleException | CompilerError ex) {
      logger.log(
          Level.WARNING,
          "Skipping the service provider {0}: {1}",
          new Object[] {with, ex.getMessage()});
      return null;
    }
  }

  @CompilerDirectives.TruffleBoundary
  public final EnsoObject execute(Type fqn, boolean loadedOnly) {
    var ensoCtx = EnsoContext.get(this);
    var collect = new ArrayList<Object>();
    for (var supplierOfType : findImplementationsFor(fqn, loadedOnly)) {
      try {
        // the get() call may yield AbstractTruffleException
        var implType = supplierOfType.get();
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
          collect.add(DataflowError.withDefaultTrace(Text.create(msg), this));
          continue;
        }
        var obj = node.execute(fn, state, new Object[] {fqn, implType});
        collect.add(obj);
      } catch (AbstractTruffleException ex) {
        collect.add(DataflowError.withDefaultTrace(Text.create(ex.getMessage()), this));
      }
    }
    var arr = collect.toArray(TruffleObject[]::new);
    return ArrayLikeHelpers.asVectorWithCheckAt((Object[]) arr);
  }
}
