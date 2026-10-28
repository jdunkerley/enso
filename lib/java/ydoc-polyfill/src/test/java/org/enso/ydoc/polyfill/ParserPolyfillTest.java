package org.enso.ydoc.polyfill;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;
import org.enso.ydoc.polyfill.web.WebEnvironment;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Value;
import org.graalvm.polyglot.io.ByteSequence;
import org.junit.After;
import org.junit.Assert;
import org.junit.Before;
import org.junit.Test;

public class ParserPolyfillTest extends ExecutorSetup {

  private Context context;
  private ParserPolyfill parser;

  public ParserPolyfillTest() {}

  @Before
  public void setup() throws Exception {
    super.setup();
    parser = new ParserPolyfill();
    var contextBuilder = WebEnvironment.createContext();

    context =
        CompletableFuture.supplyAsync(
                () -> {
                  var ctx = contextBuilder.build();
                  parser.initialize(ctx);
                  return ctx;
                },
                executor)
            .get();
  }

  @After
  public void tearDown() throws InterruptedException {
    super.tearDown();
    context.close();
  }

  @Test
  public void parseModule() throws Exception {
    var code =
        """
        const arr = parse_module(`main = 1 + 2`)
        arr.buffer
        """;

    var result = CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    Assert.assertTrue(result.as(ByteSequence.class).length() > 0);
  }

  @Test
  public void parseBlock() throws Exception {
    var code =
        """
        const arr = parse_block(`value = 1 + 2`)
        arr.buffer
        """;

    var result = CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    Assert.assertTrue(result.as(ByteSequence.class).length() > 0);
  }

  @Test
  public void xxHash128() throws Exception {
    var code =
        """
        xxHash128(`main = 1 + 2`)
        """;

    var result = CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    Assert.assertEquals("6930bc04", result.asString());
  }

  @Test
  public void isIdentOrOperator() throws Exception {
    var code =
        """
        is_ident_or_operator(`ident`)
        """;

    var result = CompletableFuture.supplyAsync(() -> context.eval("js", code), executor).get();

    Assert.assertEquals(1, result.asLong());
  }

  @Test
  public void isIdentOrOperatorCases() throws Exception {
    // Mirrors `test_is_ident_or_operator` in lib/rust/parser/src/queries.rs.
    assertEquals(1, call("is_ident_or_operator", "abc").asLong());
    assertEquals(1, call("is_ident_or_operator", "Abc").asLong());
    assertEquals(0, call("is_ident_or_operator", "abc 14").asLong());
    assertEquals(2, call("is_ident_or_operator", "+").asLong());
    assertEquals(0, call("is_ident_or_operator", "+ 2").asLong());
    assertEquals(0, call("is_ident_or_operator", "[]").asLong());
  }

  @Test
  public void selfArgSeparator() throws Exception {
    // Mirrors `test_self_arg_separator` in lib/rust/parser/src/queries.rs.
    assertEquals(-1, call("self_arg_separator", "abc").asInt());
    assertEquals(-1, call("self_arg_separator", "abc 14").asInt());
    assertEquals(1, call("self_arg_separator", "+").asInt());
    assertEquals(1, call("self_arg_separator", "+ 2").asInt());
    assertEquals(0, call("self_arg_separator", "+2").asInt());
    assertEquals(1, call("self_arg_separator", "- 2").asInt());
    assertEquals(0, call("self_arg_separator", "-2").asInt());
    assertEquals(-1, call("self_arg_separator", "[]").asInt());
  }

  @Test
  public void isNumericLiteral() throws Exception {
    // Mirrors `test_is_numeric_literal` in lib/rust/parser/src/queries.rs.
    assertTrue(call("is_numeric_literal", "1234").asBoolean());
    assertTrue(call("is_numeric_literal", "-1234").asBoolean());
    assertFalse(call("is_numeric_literal", "").asBoolean());
    assertFalse(call("is_numeric_literal", "-").asBoolean());
    assertFalse(call("is_numeric_literal", "1-234").asBoolean());
    assertFalse(call("is_numeric_literal", "1234!").asBoolean());
    assertFalse(call("is_numeric_literal", "1234e5").asBoolean());
  }

  /**
   * Every name that {@code app/ydoc-server-polyglot/src/ffiPolyglot.ts} takes from {@code
   * globalThis} must be a function once the polyfill is initialized; a missing one is {@code
   * undefined} in the JVM-hosted ydoc server and throws only when a code path calls it (#360).
   */
  @Test
  public void definesEveryFunctionFfiPolyglotExpects() throws Exception {
    var names = ffiPolyglotNames();
    var missing = new ArrayList<String>();
    for (var name : names) {
      var type =
          CompletableFuture.supplyAsync(
                  () -> context.eval("js", "typeof globalThis." + name).asString(), executor)
              .get();
      if (!"function".equals(type)) missing.add(name + " (" + type + ")");
    }
    assertEquals("Not defined by parser.js: " + missing, List.of(), missing);
  }

  private Value call(String function, String argument) throws Exception {
    return CompletableFuture.supplyAsync(
            () -> context.getBindings("js").getMember(function).execute(argument), executor)
        .get();
  }

  private static List<String> ffiPolyglotNames() throws IOException {
    var file =
        new File(
            repositoryRoot(),
            "app/ydoc-server-polyglot/src/ffiPolyglot.ts".replace('/', File.separatorChar));
    var source = Files.readString(file.toPath(), StandardCharsets.UTF_8);
    var matcher =
        Pattern.compile("export\\s+const\\s*\\{([^}]*)\\}\\s*=\\s*globalThis").matcher(source);
    assertTrue("No `export const { ... } = globalThis` in " + file, matcher.find());
    var names = new ArrayList<String>();
    for (var name : matcher.group(1).split(",")) {
      name = name.strip();
      if (!name.isEmpty()) names.add(name);
    }
    assertFalse("No names destructured in " + file, names.isEmpty());
    return names;
  }

  private static File repositoryRoot() {
    var dir = new File("").getAbsoluteFile();
    while (dir != null && !new File(dir, "build.sbt").isFile()) dir = dir.getParentFile();
    assertNotNull("The repository root (with build.sbt) is above the working directory", dir);
    return dir;
  }
}
