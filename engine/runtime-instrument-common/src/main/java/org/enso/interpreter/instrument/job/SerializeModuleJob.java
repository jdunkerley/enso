package org.enso.interpreter.instrument.job;

import java.io.File;
import org.enso.interpreter.instrument.execution.RuntimeContext;
import org.enso.interpreter.runtime.Module;
import org.enso.pkg.QualifiedName;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** The job that serializes module. */
public final class SerializeModuleJob extends BackgroundJob<Void> {

  private static final Logger logger = LoggerFactory.getLogger(SerializeModuleJob.class);

  private final QualifiedName moduleName;

  private static final int SERIALIZE_MODULE_JOB_PRIORITY = 1000;

  public SerializeModuleJob(QualifiedName moduleName) {
    super(SERIALIZE_MODULE_JOB_PRIORITY);
    this.moduleName = moduleName;
  }

  @Override
  public Void runImpl(RuntimeContext ctx) {
    var ensoContext = ctx.executionService().getContext();
    var compiler = ensoContext.getCompiler();
    ctx.locking()
        .withReadCompilationLock(
            this.getClass(),
            () -> {
              ensoContext
                  .findModule(moduleName.toString())
                  .ifPresent(
                      module -> {
                        var path = module.getPath();
                        if (path == null) {
                          serialize(compiler, module);
                        } else {
                          ctx.locking()
                              .withFileLock(
                                  new File(path),
                                  this.getClass(),
                                  () -> {
                                    serialize(compiler, module);
                                    return null;
                                  });
                        }
                      });
              return null;
            });
    return null;
  }

  /* Note [Serialising A Module That Changed Since It Was Compiled]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * The compiler asks for this job when it has compiled a module, but the job
   * runs later, in the background. In between, opening or closing the module's
   * file gives it new sources and resets it to `INITIAL`, while its IR stays the
   * compiled one until it is compiled again. Serialising it then would store
   * that compiled IR labelled `INITIAL`; the next compilation loads the cache
   * and runs every pass again over IR that has already been through them, and
   * fails (`MatchError` in the first mini pass), so the program does not run.
   *
   * A client can do this without doing anything wrong: the IDE pushes its
   * execution context and its ydoc server opens the file over two connections,
   * so the push, which compiles the module from disk, can come first.
   *
   * So the module is skipped when it needs compilation, and no cache is written
   * this time (the old `assert` caught this only in builds run with `-ea`;
   * release builds wrote the bad cache). The file lock is held across the
   * check and the snapshot `serializeModule` takes, since open and close
   * change the sources under the read compilation lock and that file lock.
   */
  private void serialize(org.enso.compiler.Compiler compiler, Module module) {
    if (module.needsCompilation()) {
      logger.debug(
          "Not serializing module [{}]: it changed since it was compiled", module.getName());
      return;
    }
    compiler.context().serializeModule(compiler, module.asCompilerModule(), false);
  }

  @Override
  public String toString() {
    return "SerializeModuleJob(" + moduleName.toString() + ")";
  }
}
