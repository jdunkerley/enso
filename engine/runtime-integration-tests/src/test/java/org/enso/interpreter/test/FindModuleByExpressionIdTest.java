package org.enso.interpreter.test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Optional;
import java.util.UUID;
import org.enso.interpreter.runtime.Module;
import org.enso.test.utils.ContextUtils;
import org.enso.test.utils.ModuleUtils;
import org.enso.test.utils.ProjectUtils;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/**
 * {@code EnsoContext.findModuleByExpressionId} looks in the project's modules first, then in every
 * other module (Note [Look For An Expression Id In The Project First]).
 */
public class FindModuleByExpressionIdTest {
  @Rule public final TemporaryFolder tmp = new TemporaryFolder();

  private static final String CODE = "main =\n    x = 6\n    x\n";

  /** Decorates {@link #CODE} with an id on its {@code 6}. */
  private static final class Decorated {
    final Metadata metadata = new Metadata("");
    final UUID id = metadata.addItem(15, 1, null);
    final String code = metadata.appendToCode(CODE);
  }

  @Test
  public void findsAnIdInTheProjectOutsideItAndNowhere() throws Exception {
    var inProject = new Decorated();
    var outside = new Decorated();
    var projDir = tmp.newFolder("Lookup_Test").toPath();
    ProjectUtils.createProject("Lookup_Test", inProject.code, projDir);
    try (var ctx = ContextUtils.newBuilder().withProjectRoot(projDir).build()) {
      var ensoContext = ctx.ensoContext();
      ctx.context().enter();
      try {
        assertTrue(
            "the test runs with a main project",
            ensoContext.getPackageRepository().getMainProjectPackage().isDefined());
        var main = ModuleUtils.getLoadedModule(ctx, "local.Lookup_Test.Main");
        main.compileScope(ensoContext);
        ctx.compileModule(outside.code, "Outside");

        assertModule("local.Lookup_Test.Main", ensoContext.findModuleByExpressionId(inProject.id));
        assertModule("Outside", ensoContext.findModuleByExpressionId(outside.id));
        assertFalse(
            "an id in no module is found nowhere",
            ensoContext.findModuleByExpressionId(UUID.randomUUID()).isPresent());
      } finally {
        ctx.context().leave();
      }
    }
  }

  @Test
  public void findsAnIdWithoutAMainProject() {
    var decorated = new Decorated();
    try (var ctx = ContextUtils.newBuilder().build()) {
      var ensoContext = ctx.ensoContext();
      ctx.context().enter();
      try {
        assertFalse(
            "the test runs without a main project",
            ensoContext.getPackageRepository().getMainProjectPackage().isDefined());
        ctx.compileModule(decorated.code, "Lone");

        assertModule("Lone", ensoContext.findModuleByExpressionId(decorated.id));
        assertFalse(
            "an id in no module is found nowhere",
            ensoContext.findModuleByExpressionId(UUID.randomUUID()).isPresent());
      } finally {
        ctx.context().leave();
      }
    }
  }

  private static void assertModule(String expectedName, Optional<Module> found) {
    assertTrue("a module is found for " + expectedName, found.isPresent());
    assertEquals(expectedName, found.get().getName().toString());
  }
}
