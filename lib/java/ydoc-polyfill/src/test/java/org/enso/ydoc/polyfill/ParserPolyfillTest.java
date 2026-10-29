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
import java.util.LinkedHashMap;
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

    Assert.assertEquals("b3e28b3039d1c052b34614ba4dd10ccd", result.asString());
  }

  /**
   * The GUI hashes with {@code hash-wasm}'s {@code xxhash128} ({@code ydoc-shared/src/ast/ffi.ts});
   * these digests come from {@code hash-wasm} 4.12.0, so the two sides cannot drift (#394).
   */
  @Test
  public void xxHash128MatchesHashWasm() throws Exception {
    var longInput = new StringBuilder();
    for (var i = 0; i < 300; i++) {
      longInput.append("line ").append(i).append(": main = 1 + 2 ## é 😀\n");
    }
    var cases = new LinkedHashMap<String, String>();
    cases.put("", "99aa06d3014798d86001c324468d497f");
    cases.put("a", "a96faf705af16834e6c632b61e964e1f");
    cases.put("main = 1 + 2", "b3e28b3039d1c052b34614ba4dd10ccd");
    cases.put("Größe ñ 日本語", "33b9ef08583c475755be1135a98833b8");
    cases.put("😀👍🏽", "7d8503939196d2b93fbb407fe858fce7");
    // An unpaired surrogate: TextEncoder and Node's Buffer encode it as U+FFFD.
    cases.put("a\uD800b", "dc54facfa0efca3f3676d7ab9e9a7a45");
    // Lengths either side of XXH3's 16-, 128- and 240-byte code-path boundaries.
    cases.put("0123456789abcdef", "ccba8085a0434e9e0befb4873dbe58f8");
    cases.put("0123456789abcdefg", "d54994a55733db61c7401fb9f6fbf86b");
    cases.put("x".repeat(128), "fd990d088a9365ae7813452547ab9912");
    cases.put("x".repeat(129), "e7f1abc92bce4135ae9ec8f29e5baa27");
    cases.put("y".repeat(240), "131d6bf413b4bef2dc6070e1c666a217");
    cases.put("y".repeat(241), "9542183325e41bab97295e4657a9e196");
    cases.put(longInput.toString(), "8ccecd16163cc4f83835da693dbd714f");
    for (var entry : cases.entrySet()) {
      var input = entry.getKey();
      var label =
          input.length() > 40 ? input.substring(0, 40) + "... (" + input.length() + ")" : input;
      assertEquals(label, entry.getValue(), call("xxHash128", input).asString());
    }
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
