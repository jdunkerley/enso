# Widgets PR 0: Conversions From Type Objects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a type position, `X.type` names X's eigentype (the type of the type
object `X`): a conversion `W.from (that : X.type) = …` dispatches on the type
object, extra defaulted arguments included, a plain ascription `(t : X.type)`
accepts `X` and rejects its values, `SomeModule.type` is a compile error, and
the suggestion database records the source as `….X.type`.

**Architecture:** `X.type` is recognised once, where names in type positions are
resolved (`MethodDefinitions` for a conversion's source, `TypeNames` for
ascriptions), and becomes an ordinary `BindingsMap.Resolution` of X carrying a
new flag, `isEigentype = true`. Everything that only asks which symbol a name
refers to (imports, the unused-import lint) still sees X; the four consumers
that turn a type position into a type (scope building, runtime type checks, the
suggestion builder, the API-signature generator) read the flag. No consumer
looks at the name's spelling again (the spike's weak spot), and runtime dispatch
is unchanged.

**Tech Stack:** Scala 2.13 and Java 21+ under sbt (engine compiler and runtime,
GraalVM Truffle), JUnit 4 and ScalaTest, Enso (`test/Base_Tests`), one Vitest
pin in the GUI (TypeScript).

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md

## Global Constraints

- Windows worktree `C:\Repos\Enso\ide-widgets-pr0`, branch
  `feature/eigentype-conversions`, created from `origin/develop`.
- Linux: WSL distro `Ubuntu-24.04`, worktree `~/enso-pr0` (a `git worktree` of
  `~/enso`); never build in, check out or reset `~/enso` itself (another task's
  commit `wip e2e` is on it).
- Never `git stash`. Never `gh pr merge --delete-branch` (it deletes the local
  worktree's branch).
- No `CHANGELOG.md` entry; the PR carries the label `CI: No changelog needed`.
- No change under `distribution/lib/Standard/`, and no widget change.
- Metadata flag:
  `BindingsMap.Resolution(target: ResolvedName, isEigentype: Boolean)`;
  `Resolution(target)` still means `isEigentype = false`.
- Helper: `org.enso.compiler.pass.resolve.EigentypeReference` (the only code
  that looks at the spelling `X.type`).
- Error reason:
  `org.enso.compiler.core.ir.expression.errors.Resolution.NotAType(String kind)`,
  text
  `The name <X>.type is not valid: `.type` must follow a type, but <X> is <kind>`
  (diagnostics append `.`).
- `kind` values: `a module`, `a constructor`, `a polyglot symbol`,
  `a polyglot field`, `a method`, otherwise `not a type`.
- Runtime type-check hook:
  `protected abstract R forEigentypeName(CompilerContext.Module module, String name) throws E`
  on `TypeCheckAlgorithm`.
- Suggestion `reprType` for `that : X.type`: X's qualified name + `.type` (e.g.
  `Test.Foo.type`).
- The Note is `Note [Eigentype References]`, in `EigentypeReference.java`; every
  consumer cites it.
- `PerMap.serialVersionUID` becomes this PR's number (the persisted layout of
  `Resolution` changes).
- Commit messages end with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Use `corepack pnpm`, never bare `pnpm`.

### The two commands every test step uses

**SYNC** ships the Windows worktree's state (commits and uncommitted edits, new
files included) to `~/enso-pr0`. Git cannot read a Windows worktree from WSL, so
the diff is made on Windows. Run it from Git Bash before every WSL command:

```bash
cd /c/Repos/Enso/ide-widgets-pr0 \
  && BASE=$(git merge-base HEAD origin/develop) \
  && git add -A -N \
  && git diff --binary "$BASE" > /c/Repos/Enso/pr0-sync.diff \
  && wsl -d Ubuntu-24.04 -e bash -lc "set -e; cd ~/enso-pr0; git reset -q --hard; git clean -fdq; git fetch -q /mnt/c/Repos/Enso/ide refs/remotes/origin/develop; git checkout -q --detach $BASE; git apply /mnt/c/Repos/Enso/pr0-sync.diff; git status --short | wc -l"
```

(`git add -A -N` only records new files as intent-to-add so `git diff` shows
them; it stages no content. `git clean -fd` keeps ignored build output.)

**WSL-SBT** runs sbt in the Linux worktree with the pinned toolchain
(`~/.bashrc` returns early in non-interactive shells, hence the explicit
`. ~/.enso-toolchain.sh`):

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "<sbt command>"'
```

Each step below gives the full command. sbt stops at the first failing command
of a batch, so a step expecting a failure runs one class per invocation.

---

## File Structure

| File                                                                                                                       | Change | Responsibility                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/resolve/EigentypeReference.java`                             | Create | Recognises `X.type`, resolves X, requires a type, returns `Resolution(X, true)` or a `NotAType` reason; holds the Note |
| `engine/runtime-parser/src/main/java/org/enso/compiler/core/ir/expression/errors/Resolution.java`                          | Modify | New reason `NotAType(String kind)` with the user-facing message                                                        |
| `engine/runtime-compiler/src/main/scala/org/enso/compiler/data/BindingsMap.scala`                                          | Modify | `Resolution` gains `isEigentype` and `referencedName`; companion `apply(target)` keeps the one-argument form           |
| `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/resolve/MethodDefinitions.java`                              | Modify | A conversion's `X.type` source resolves through `EigentypeReference`                                                   |
| `engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/TypeNames.scala`                                    | Modify | `X.type` in an ascription or signature resolves through `EigentypeReference`                                           |
| `engine/runtime-compiler/src/main/java/org/enso/compiler/common/BuildScopeFromModuleAlgorithm.java`                        | Modify | `getTypeResolution` registers a conversion from the eigentype when the flag is set                                     |
| `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/analyse/types/TypeCheckAlgorithm.java`                       | Modify | Abstract `forEigentypeName`, called when the flag is set                                                               |
| `engine/runtime/src/main/java/org/enso/interpreter/runtime/IrTruffleUtils.java`                                            | Modify | `forEigentypeName`: a check that only the type object passes                                                           |
| `engine/runtime-suggestions/src/main/scala/org/enso/compiler/suggestions/SuggestionBuilder.scala`                          | Modify | `buildTypeSignature` reports an eigentype as `TypeArg.Value(<qn>.type)`                                                |
| `engine/runtime-compiler/src/main/java/org/enso/compiler/docs/DocsUtils.java`                                              | Modify | API signatures print `….X.type`                                                                                        |
| `lib/java/persistance/src/main/java/org/enso/persist/PerMap.java`                                                          | Modify | `serialVersionUID` = this PR's number, so caches with the old `Resolution` layout are rejected                         |
| 15 extractor sites (Task 1, Step 6)                                                                                        | Modify | One-argument `Resolution(x)` patterns become `Resolution(x, _)`                                                        |
| `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeConversionTest.java`                    | Create | Conversions from type objects: every spike case, extra arguments, `Any`, rejections, cross-module with static analysis |
| `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeAscriptionTest.java`                    | Create | `(t : X.type)`: accepts the type object, rejects values, unions, rejects modules                                       |
| `engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/pass/resolve/MethodDefinitionsTest.scala`          | Modify | The flag on a conversion source; module and constructor rejected                                                       |
| `engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/pass/resolve/TypeNamesTest.scala`                  | Modify | The flag on a signature name; module rejected                                                                          |
| `engine/runtime-compiler/src/test/java/org/enso/compiler/test/UnusedImportsTest.java`                                      | Modify | An import used only as `X.type` is not reported unused                                                                 |
| `engine/runtime-integration-tests/src/test/java/org/enso/compiler/test/SerdeCompilerTest.java`                             | Modify | IR cache round trip of a `.type` conversion                                                                            |
| `engine/runtime-integration-tests/src/test/resources/Eigentype_Test/package.yaml`, `src/Main.enso`, `src/Conversions.enso` | Create | The project that round trip compiles                                                                                   |
| `engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/context/SuggestionBuilderTest.scala`               | Modify | The suggestion records `that` as `Test.Foo.type`, apart from the value conversion's `Test.Foo`                         |
| `engine/runtime-integration-tests/src/test/java/org/enso/compiler/dump/test/DocsGenerateTest.java`                         | Modify | The generated signature reads `that:Main.Source.type`                                                                  |
| `app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/conversionSources.test.ts`                              | Modify | Pins that a `….Foo.type` source does not match Foo values (no guard needed)                                            |
| `test/Base_Tests/src/Semantic/Conversion_Spec.enso`                                                                        | Modify | Enso-level group "Conversion from a type object", run against the built distribution                                   |
| `engine/runtime-compiler/CLAUDE.md`, `lib/java/CLAUDE.md`                                                                  | Modify | The eigentype convention; the persistance version-stamp trap                                                           |
| `engine/runtime-suggestions/CLAUDE.md`                                                                                     | Create | The module had none (project rule); records the `reprType` convention                                                  |

Why a flag on `Resolution` and not a new `ResolvedName` variant: the resolved
symbol _is_ the type X (the import of X is used, the docs FQN is X's), only the
type-position meaning differs. A new sealed variant would never be produced by
`resolveName`, yet every exhaustive match over `ResolvedName` (several in
`IrToTruffle`, `Patterns`, `BindingsMap.ResolutionAmbiguous.explain`) would need
an "impossible" case under `-Xfatal-warnings`, and every generic
`target.qualifiedName` reader (`UsedSymbolsCollector`, `DocsUtils`) would need
to decide again. The flag costs 15 one-token pattern edits and a cache-stamp
bump, both mechanical.

---

## Task 0: Set up both worktrees

**Files:** none changed.

**Interfaces:** Produces the branch `feature/eigentype-conversions`, the Windows
worktree and `~/enso-pr0`.

- [ ] **Step 1: Create the Windows worktree and install the TypeScript tree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add -b feature/eigentype-conversions /c/Repos/Enso/ide-widgets-pr0 origin/develop
cd /c/Repos/Enso/ide-widgets-pr0 && corepack pnpm install
```

Expected: the worktree exists; `pnpm install` ends without errors (its
postinstall builds the Rust parser to WASM).

- [ ] **Step 2: Check disk space and create the Linux worktree**

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'df -h ~ | tail -1 && cd ~/enso && git fetch -q /mnt/c/Repos/Enso/ide refs/remotes/origin/develop && git worktree add --detach ~/enso-pr0 FETCH_HEAD && git -C ~/enso-pr0 log --oneline -1'
```

Expected: at least 60 GB free (stop and ask if not); the last line is
`origin/develop`'s head commit.

- [ ] **Step 3: Warm the Linux build** (first build of a fresh worktree: Rust
      parser, annotation processors; 20–40 minutes, run in the background)

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-compiler/Test/compile; runtime-integration-tests/Test/compile"'
```

Expected: `[success]` twice. Proves only that develop builds in the new
worktree.

---

## Task 1: `X.type` as a conversion source resolves to X's eigentype

The metadata itself: the helper, the reason, the flag on `Resolution`, the
conversion-source resolution, and the cache stamp the new field requires.

**Files:**

- Create:
  `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/resolve/EigentypeReference.java`
- Modify:
  `engine/runtime-parser/src/main/java/org/enso/compiler/core/ir/expression/errors/Resolution.java`
  (insert after `UnexpectedModule`, ~line 183)
- Modify:
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/data/BindingsMap.scala`
  (`Resolution`, ~lines 1150–1180)
- Modify:
  `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/resolve/MethodDefinitions.java`
  (~lines 135–150, 243–249, new method after `resolveType` ~line 288)
- Modify (extractors):
  `engine/runtime/src/main/scala/org/enso/interpreter/runtime/IrToTruffle.scala`
  (lines 1437, 1455, 1490, 1520, 1546, 1600, 1608, 1616, 1683, 1719, 1762);
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/analyse/AutomaticParallelism.scala:532`;
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/FullyAppliedFunctionUses.scala:59`;
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/GlobalNames.scala:354`;
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/MethodCalls.scala:76`
- Modify: `lib/java/persistance/src/main/java/org/enso/persist/PerMap.java:9`
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeConversionTest.java`
  (create)
- Test:
  `engine/runtime-compiler/src/test/java/org/enso/compiler/test/UnusedImportsTest.java`
  (insert after `unusedSymbols_ConversionMethod`, ~line 347)
- Test:
  `engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/pass/resolve/MethodDefinitionsTest.scala`
  (insert after the first `should` block, ~line 184)

**Interfaces:**

- Consumes:
  `BindingsMap.resolveQualifiedName(List[String]): Either[ResolutionError, List[ResolvedName]]`;
  `MetadataInteropHelpers.updateMetadata(IR, ProcessingPass, Metadata)`;
  `errors.Resolution.create(Name, Reason): errors.Resolution`.
- Produces:
  - `EigentypeReference.TYPE_SEGMENT: String = "type"`
  - `EigentypeReference.isEigentypeReference(Name): boolean`
  - `EigentypeReference.resolve(Name.Qualified, BindingsMap): scala.util.Either<errors.Resolution.Reason, BindingsMap.Resolution>`
  - `errors.Resolution.NotAType(String kind)` (record, implements `Reason`)
  - `BindingsMap.Resolution(target: ResolvedName, isEigentype: Boolean)`;
    `BindingsMap.Resolution.apply(target: ResolvedName)`;
    `Resolution#referencedName: QualifiedName`; Java accessor `isEigentype()`
  - Conversion sources spelt `X.type` carry `MethodDefinitions` metadata
    `Resolution(ResolvedType X, true)`.

- [ ] **Step 1: Write the failing runtime and lint tests**

Create `EigentypeConversionTest.java`:

```java
package org.enso.interpreter.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertThrows;

import org.enso.test.utils.ContextUtils;
import org.junit.After;
import org.junit.ClassRule;
import org.junit.Test;

/**
 * Conversions keyed on a type object, {@code W.from (that : X.type)}. See Note [Eigentype
 * References] in {@code org.enso.compiler.pass.resolve.EigentypeReference}.
 */
public class EigentypeConversionTest {
  @ClassRule public static final ContextUtils ctx = ContextUtils.createDefault();

  @After
  public void resetOutput() {
    ctx.resetOut();
  }

  @Test
  public void moduleBeforeDotTypeIsRejected() {
    var src =
        """
        import Standard.Base.Data.Numbers

        type W
            Value tag

        W.from (that : Numbers.type) = W.Value "module"

        main = 42
        """;
    assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ctx.getOut(),
        containsString(
            "error: The name Numbers.type is not valid: `.type` must follow a type, but Numbers is"
                + " a module."));
  }

  @Test
  public void constructorBeforeDotTypeIsRejected() {
    var src =
        """
        type W
            Value tag

        W.from (that : W.Value.type) = W.Value "constructor"

        main = 42
        """;
    assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ctx.getOut(),
        containsString(
            "error: The name W.Value.type is not valid: `.type` must follow a type, but W.Value is"
                + " a constructor."));
  }
}
```

In `UnusedImportsTest.java`, after `unusedSymbols_ConversionMethod`:

```java
  @Test
  public void usedSymbols_EigentypeConversionSource() {
    compilerCtx.createModule(
        QualifiedName.fromString("local.Proj.Module"),
        """
        type T
        type U
            Value x
        """);
    var mainMod =
        compilerCtx.createModule(
            QualifiedName.fromString("local.Proj.Main"),
            """
            from project.Module import T, U
            T.from (that:U.type) = 42
            """);
    compilerCtx.getCompiler().run(mainMod);
    expectNoWarnings(mainMod.getIr());
  }
```

- [ ] **Step 2: Run them and watch them fail**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EigentypeConversionTest"'
```

Expected: FAIL, both tests, with
`Expected: a string containing "error: The name Numbers.type is not valid: …" but: was "…error: The name `Numbers.type` could not be found.…"`
(and the same with `W.Value.type` for the constructor test).

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-compiler/testOnly org.enso.compiler.test.UnusedImportsTest"'
```

Expected: FAIL, `usedSymbols_EigentypeConversionSource` only, with
`java.lang.UnsupportedOperationException` from
`MockCompilerContext.throwAbortedException` (strict errors abort on
`The name `U.type` could not be found`).

- [ ] **Step 3: Write the failing compiler-pass test**

In `MethodDefinitionsTest.scala`, after the closing `}` of
`"Method definition resolution" should { … }` (~line 184):

```scala
  "Method definition resolution of `.type` conversion sources" should {
    implicit val ctx: ModuleContext = mkModuleContext

    val ir =
      """
        |type Foo
        |    Value x
        |type Bar
        |
        |Bar.from (that : Foo.type) = undefined
        |Bar.from (that : Test_Module.type) = undefined
        |Bar.from (that : Foo.Value.type) = undefined
        |""".stripMargin.preprocessModule.analyse

    val conversions = ir.bindings.collect {
      case c: definition.Method.Conversion => c
    }

    "resolve `X.type` to the eigentype of X" in {
      conversions.length shouldEqual 3
      conversions(0).sourceTypeName.getMetadata(
        MethodDefinitions.INSTANCE,
        classOf[BindingsMap.Resolution]
      ) match {
        case Some(
              BindingsMap.Resolution(tp: BindingsMap.ResolvedType, true)
            ) =>
          tp.tp.name shouldEqual "Foo"
        case other =>
          fail(s"Expected the eigentype of Foo, got $other")
      }
    }

    "reject a module before `.type`" in {
      val err =
        conversions(1).sourceTypeName.asInstanceOf[errors.Resolution]
      err.reason() shouldBe a[errors.Resolution.NotAType]
      err.reason().explain(err.originalName()) shouldEqual
      "The name Test_Module.type is not valid: `.type` must follow a type, but Test_Module is a module"
    }

    "reject a constructor before `.type`" in {
      val err =
        conversions(2).sourceTypeName.asInstanceOf[errors.Resolution]
      err.reason().explain(err.originalName()) shouldEqual
      "The name Foo.Value.type is not valid: `.type` must follow a type, but Foo.Value is a constructor"
    }
  }
```

- [ ] **Step 4: Run it and watch it fail**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.test.pass.resolve.MethodDefinitionsTest"'
```

Expected: FAIL at test compilation:
`wrong number of arguments for pattern Resolution(target: org.enso.compiler.data.BindingsMap.ResolvedName)`
and `type NotAType is not a member of object …errors.Resolution`.

- [ ] **Step 5: Implement the reason, the flag and the helper**

In `errors/Resolution.java`, after the `UnexpectedModule` record:

```java
  /**
   * {@code X.type} where {@code X} is not a type: only a type has an eigentype. See Note
   * [Eigentype References] in {@code org.enso.compiler.pass.resolve.EigentypeReference}.
   *
   * @param kind what {@code X} is instead, e.g. "a module"
   */
  public record NotAType(String kind) implements Reason {
    @Override
    public String explain(Name originalName) {
      var name = originalName.name();
      var prefix = name.substring(0, name.lastIndexOf('.'));
      return "The name "
          + name
          + " is not valid: `.type` must follow a type, but "
          + prefix
          + " is "
          + kind;
    }
  }
```

In `BindingsMap.scala`, replace the `Resolution` header and add the companion
(the members `metadataName`, `prepareForSerialization`,
`restoreFromSerialization` and `duplicate` stay as they are: `copy(target = …)`
keeps the flag):

```scala
  /** A metadata-friendly storage for resolutions.
    *
    * @param target the symbol the name resolved to
    * @param isEigentype `true` when the name is `X.type` in a type position: it
    *   denotes the eigentype of `target` (the type of the type object `X`), not
    *   the type of `X`'s values. Only ever `true` with a [[ResolvedType]]
    *   target. See Note [Eigentype References] in `EigentypeReference.java`.
    */
  case class Resolution(target: ResolvedName, isEigentype: Boolean)
      extends IRPass.IRMetadata {

    /** The qualified name this resolution denotes: the target's, with `type`
      * appended for an eigentype (`Standard.Base.Data.Locale.Locale.type`).
      */
    def referencedName: QualifiedName =
      if (isEigentype) target.qualifiedName.createChild("type")
      else target.qualifiedName
```

and, directly after the class's closing brace:

```scala
  object Resolution {

    /** A resolution of a name to `target` itself, not to its eigentype. */
    def apply(target: ResolvedName): Resolution =
      Resolution(target, isEigentype = false)
  }
```

Create `EigentypeReference.java`:

```java
package org.enso.compiler.pass.resolve;

import org.enso.compiler.core.ir.Name;
import org.enso.compiler.core.ir.expression.errors.Resolution;
import org.enso.compiler.data.BindingsMap;
import scala.collection.immutable.List;
import scala.util.Either;
import scala.util.Left;
import scala.util.Right;

/**
 * Resolution of {@code X.type}, the eigentype of the type {@code X}, in a type position. See Note
 * [Eigentype References].
 */
public final class EigentypeReference {
  /** The last segment of an eigentype reference. */
  public static final String TYPE_SEGMENT = "type";

  private EigentypeReference() {}

  /**
   * Whether {@code name} is spelt {@code X.type}. This is the only place that looks at the
   * spelling: the resolution it leads to carries {@link BindingsMap.Resolution#isEigentype()}.
   */
  public static boolean isEigentypeReference(Name name) {
    return name instanceof Name.Qualified q
        && q.parts().size() >= 2
        && TYPE_SEGMENT.equals(q.parts().last().name());
  }

  /**
   * Resolves {@code X.type}: {@code X} must resolve to exactly one type.
   *
   * @param name a name for which {@link #isEigentypeReference} holds
   * @param bindings the bindings of the module the name is in
   * @return the resolution of {@code X}, marked as its eigentype, or why there is none
   */
  public static Either<Resolution.Reason, BindingsMap.Resolution> resolve(
      Name.Qualified name, BindingsMap bindings) {
    assert isEigentypeReference(name) : name;
    List<String> typeParts = name.parts().init().map(Name::name);
    var found = bindings.resolveQualifiedName(typeParts);
    if (found.isLeft()) {
      return new Left<>(new Resolution.ResolverError(found.swap().toOption().get()));
    }
    var targets = found.toOption().get();
    if (targets.size() != 1) {
      return new Left<>(
          new Resolution.ResolverError(new BindingsMap.ResolutionAmbiguous(targets)));
    }
    if (targets.head() instanceof BindingsMap.ResolvedType type) {
      return new Right<>(new BindingsMap.Resolution(type, true));
    }
    return new Left<>(new Resolution.NotAType(describe(targets.head())));
  }

  private static String describe(BindingsMap.ResolvedName found) {
    return switch (found) {
      case BindingsMap.ResolvedModule ignored -> "a module";
      case BindingsMap.ResolvedConstructor ignored -> "a constructor";
      case BindingsMap.ResolvedPolyglotSymbol ignored -> "a polyglot symbol";
      case BindingsMap.ResolvedPolyglotField ignored -> "a polyglot field";
      case BindingsMap.ResolvedMethod ignored -> "a method";
      default -> "not a type";
    };
  }

  /* Note [Eigentype References]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A type `X` with constructors has two runtime types: `X`, the type of its
   * values, and `X.type`, its eigentype: the type of the type object `X`.
   * Static methods live on the eigentype. A type without constructors is a
   * singleton: the type object is its only inhabitant and `X.type` is `X`.
   *
   * In a type position (a conversion's source, `W.from (that : X.type)`, or an
   * ascription, `(t : X.type)`) the parser gives `X.type` as a qualified name.
   * `MethodDefinitions` (conversion sources) and `TypeNames` (ascriptions)
   * resolve it here, once: `X` must be a type, anything else is `NotAType`.
   * The result is an ordinary `BindingsMap.Resolution` of `X` with
   * `isEigentype = true`, so whatever only asks which symbol a name refers to
   * (imports, the unused-import lint) sees `X`, and nothing downstream looks at
   * the spelling again. The consumers that turn a type position into a type
   * read the flag:
   *
   * - `BuildScopeFromModuleAlgorithm.getTypeResolution`: a conversion is
   *   registered from the eigentype, the route static methods already take;
   * - `TypeCheckAlgorithm.extractAscribedType` (`forEigentypeName`): only the
   *   type object passes the check;
   * - `SuggestionBuilder.buildTypeSignature` and `DocsUtils.extractFqnOrNull`
   *   (through `Resolution.referencedName`): the name is reported as
   *   `….X.type`, so the IDE does not mistake a conversion from the type object
   *   for one from X's values.
   *
   * Dispatch needs no change: a conversion is looked up on the type of `that`,
   * and the type of the object `X` is `X.type`. So `W.from (that : X)` and
   * `W.from (that : X.type)` never see each other's arguments, and a
   * `W.from (that : Any)` catch-all still catches every type object that has
   * no conversion of its own. For a singleton type both name the same runtime
   * type: declaring both in one module fails when the module loads with "You
   * have already overloaded conversion from X to W".
   *
   * `Resolution`'s persisted layout includes the flag; the IR cache round trip
   * is covered by `SerdeCompilerTest.testEigentypeConversionSurvivesCache`.
   */
}
```

- [ ] **Step 6: Update the 15 one-argument extractors**

`Resolution` now has two fields, so a one-argument pattern no longer compiles.
None of these sites ever sees the flag set (they read `GlobalNames`, `Patterns`
and `MethodCalls` metadata), so each gains `, _` after its inner pattern.
Single-line example (`IrToTruffle.scala:1762`):

```scala
            case Some(BindingsMap.Resolution(resolved, _)) =>
```

Multi-line example (`IrToTruffle.scala:1455`):

```scala
                case Some(
                      BindingsMap.Resolution(
                        BindingsMap.ResolvedConstructor(tp, resolvedCons),
                        _
                      )
                    ) =>
```

The full list, inner pattern → with `, _`:

| Site                                | Inner pattern                                       |
| ----------------------------------- | --------------------------------------------------- |
| `IrToTruffle.scala:1437`            | `BindingsMap.ResolvedModule(mod)`                   |
| `IrToTruffle.scala:1455`            | `BindingsMap.ResolvedConstructor(tp, resolvedCons)` |
| `IrToTruffle.scala:1490`            | `binding @ BindingsMap.ResolvedType(_, _)`          |
| `IrToTruffle.scala:1520`            | `BindingsMap.ResolvedPolyglotSymbol(mod, symbol)`   |
| `IrToTruffle.scala:1546`            | `BindingsMap.ResolvedPolyglotField(typ, symbol)`    |
| `IrToTruffle.scala:1600`            | `BindingsMap.ResolvedModuleMethod(_, _)`            |
| `IrToTruffle.scala:1608`            | `BindingsMap.ResolvedExtensionMethod(_, _)`         |
| `IrToTruffle.scala:1616`            | `BindingsMap.ResolvedConversionMethod(_, _)`        |
| `IrToTruffle.scala:1683`            | `binding @ BindingsMap.ResolvedType(_, _)`          |
| `IrToTruffle.scala:1719`            | `BindingsMap.ResolvedPolyglotSymbol(mod, symbol)`   |
| `IrToTruffle.scala:1762`            | `resolved`                                          |
| `AutomaticParallelism.scala:532`    | `method: ResolvedModuleMethod`                      |
| `FullyAppliedFunctionUses.scala:59` | `ResolvedConstructor(_, cons)`                      |
| `GlobalNames.scala:354`             | `resMethod @ ResolvedModuleMethod(mod, _)`          |
| `MethodCalls.scala:76`              | `ResolvedModule(module)`                            |

Constructions (`Resolution(x)`, about 30 sites, and the existing tests'
`shouldEqual Some(BindingsMap.Resolution(…))`) need no change: they reach the
companion's one-argument `apply`.

- [ ] **Step 7: Resolve conversion sources through the helper**

In `MethodDefinitions.java`, the conversion case:

```java
                        case Method.Conversion conversionMethod -> {
                          var sourceTypeExpr = conversionMethod.sourceTypeName();
                          Name resolvedName =
                              switch (sourceTypeExpr) {
                                // Note [Eigentype References]
                                case Name.Qualified eigen
                                    when EigentypeReference.isEigentypeReference(eigen) ->
                                    resolveEigentype(eigen, bindingsMap);
                                case Name name -> resolveType(name, bindingsMap);
                                default ->
                                    Conversion.create(
                                        sourceTypeExpr, UnsupportedSourceType.INSTANCE);
                              };
```

The two existing constructions in `resolveType` (lines 244 and 248) become:

```java
            MetadataInteropHelpers.updateMetadata(
                typePointer, INSTANCE, new Resolution(resMod, false));
```

```java
            MetadataInteropHelpers.updateMetadata(
                typePointer, INSTANCE, new Resolution(resType, false));
```

and, after `resolveType`, inside `Mini`:

```java
    /** Resolves a conversion source spelt {@code X.type}. Note [Eigentype References]. */
    private static Name resolveEigentype(
        Name.Qualified eigenName, BindingsMap availableSymbolsMap) {
      var resolved = EigentypeReference.resolve(eigenName, availableSymbolsMap);
      if (resolved.isLeft()) {
        return org.enso.compiler.core.ir.expression.errors.Resolution.create(
            eigenName, resolved.swap().toOption().get());
      }
      MetadataInteropHelpers.updateMetadata(eigenName, INSTANCE, resolved.toOption().get());
      return eigenName;
    }
```

- [ ] **Step 8: Run the new tests and watch them pass**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-compiler/testOnly org.enso.compiler.test.UnusedImportsTest; runtime-integration-tests/testOnly org.enso.compiler.test.pass.resolve.MethodDefinitionsTest org.enso.interpreter.test.EigentypeConversionTest"'
```

Expected: PASS (UnusedImportsTest 37 tests; MethodDefinitionsTest including the
3 new; EigentypeConversionTest 2). If compilation instead reports
`wrong number of arguments for pattern Resolution(…)` at a site missing from the
Step 6 table, add `, _` there too and rerun.

- [ ] **Step 9: Run the suites the extractor edits touch**

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.test.pass.* org.enso.compiler.test.passes.* org.enso.interpreter.test.semantic.PatternMatchTest org.enso.interpreter.test.semantic.CaseTest org.enso.interpreter.test.semantic.MethodsTest org.enso.interpreter.test.ConversionMethodTests"'
```

Expected: PASS. Proves pattern codegen, global names, method calls and the
analyse passes behave as before; does not prove the full
`runtime-integration-tests` suite (CI runs it).

- [ ] **Step 10: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-compiler/src/main/java/org/enso/compiler/pass/resolve/EigentypeReference.java \
  engine/runtime-parser/src/main/java/org/enso/compiler/core/ir/expression/errors/Resolution.java \
  engine/runtime-compiler/src/main/scala/org/enso/compiler/data/BindingsMap.scala \
  engine/runtime-compiler/src/main/java/org/enso/compiler/pass/resolve/MethodDefinitions.java \
  engine/runtime/src/main/scala/org/enso/interpreter/runtime/IrToTruffle.scala \
  engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/analyse/AutomaticParallelism.scala \
  engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/FullyAppliedFunctionUses.scala \
  engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/GlobalNames.scala \
  engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/MethodCalls.scala \
  engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeConversionTest.java \
  engine/runtime-compiler/src/test/java/org/enso/compiler/test/UnusedImportsTest.java \
  engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/pass/resolve/MethodDefinitionsTest.scala
git commit -m "$(cat <<'EOF'
Resolve a conversion source `X.type` to X's eigentype

`BindingsMap.Resolution` gains `isEigentype`. `EigentypeReference` is the only
code that looks at the spelling `X.type`; X must be a type, and a module,
constructor or method before `.type` is a compile error (`NotAType`). See
Note [Eigentype References].

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Open the draft PR to learn its number**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git push -u origin feature/eigentype-conversions
gh pr create --draft --base develop \
  --title "Engine: conversions and type checks on type objects (X.type)" \
  --label "CI: No changelog needed" \
  --body "Draft. PR 0 of docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md; the description comes with the last commit."
PR=$(gh pr view --json number --jq .number) && echo "$PR"
```

- [ ] **Step 12: Invalidate caches written with the old `Resolution` layout**

`PerMap`'s version stamp hashes the registered `@Persistable` ids, not their
fields: without this, caches from a develop build would be read with the new
two-field layout.

```bash
cd /c/Repos/Enso/ide-widgets-pr0
PR=$(gh pr view --json number --jq .number)
sed -i "s|private static final int serialVersionUID = [0-9]*; // Use PR number|private static final int serialVersionUID = $PR; // Use PR number|" lib/java/persistance/src/main/java/org/enso/persist/PerMap.java
git diff --stat
git add lib/java/persistance/src/main/java/org/enso/persist/PerMap.java
git commit -m "$(cat <<'EOF'
Invalidate IR caches written before `Resolution.isEigentype`

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Expected: `git diff --stat` shows one line changed in `PerMap.java`.

---

## Task 2: `X.type` in an ascription or signature resolves to X's eigentype

**Files:**

- Modify:
  `engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/TypeNames.scala`
  (`resolveSignature`, ~lines 188–211)
- Test:
  `engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/pass/resolve/TypeNamesTest.scala`
  (imports ~lines 6–8; insert after "should report failures when type name is
  unknown", ~line 134)
- Test:
  `engine/runtime-compiler/src/test/java/org/enso/compiler/test/UnusedImportsTest.java`
  (after `usedSymbols_EigentypeConversionSource`)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeAscriptionTest.java`
  (create)

**Interfaces:**

- Consumes: `EigentypeReference.isEigentypeReference`,
  `EigentypeReference.resolve`, `errors.Resolution.NotAType`.
- Produces: names spelt `X.type` in `TypeSignatures` metadata carry `TypeNames`
  metadata `Resolution(ResolvedType X, true)`, or become an `errors.Resolution`
  with `NotAType`.

- [ ] **Step 1: Write the failing tests**

`TypeNamesTest.scala`: extend the imports

```scala
import org.enso.compiler.core.ir.{Diagnostic, Expression, Module, Name}
import org.enso.compiler.data.BindingsMap
import org.enso.compiler.data.BindingsMap.ResolutionNotFound
```

and add, after "should report failures when type name is unknown":

```scala
    "should resolve `X.type` to the eigentype of X" in {
      val ir =
        """
          |type A
          |    Value x
          |
          |foo : A.type -> A
          |foo t = A.Value 1
          |""".stripMargin.preprocessModule.resolve

      val meta = ir.bindings.last
        .getMetadata(TypeSignatures, classOf[TypeSignatures.Metadata])
      meta shouldBe defined
      meta.get.signature.preorder.collect { case err: Diagnostic =>
        err
      } shouldBe Nil
      val eigen = meta.get.signature.preorder.collect {
        case q: Name.Qualified => q
      }
      eigen.length shouldEqual 1
      eigen.head.getMetadata(TypeNames, classOf[TypeNames.Metadata]) match {
        case Some(
              BindingsMap.Resolution(tp: BindingsMap.ResolvedType, true)
            ) =>
          tp.tp.name shouldEqual "A"
        case other =>
          fail(s"Expected the eigentype of A, got $other")
      }
    }

    "should report a module before `.type`" in {
      val ir =
        """
          |type A
          |
          |foo : Test_Module.type -> A
          |foo t = t
          |""".stripMargin.preprocessModule.resolve

      val meta = ir.bindings.last
        .getMetadata(TypeSignatures, classOf[TypeSignatures.Metadata])
      val diagnostics = meta.get.signature.preorder.collect {
        case err: Diagnostic => err
      }
      diagnostics.length shouldEqual 1
      val failure = diagnostics.head.asInstanceOf[errors.Resolution]
      failure.reason() shouldBe a[errors.Resolution.NotAType]
      failure.reason().explain(failure.originalName()) shouldEqual
      "The name Test_Module.type is not valid: `.type` must follow a type, but Test_Module is a module"
    }
```

`UnusedImportsTest.java`:

```java
  @Test
  public void usedSymbols_EigentypeAscription() {
    compilerCtx.createModule(
        QualifiedName.fromString("local.Proj.Module"),
        """
        type U
            Value x
        """);
    var mainMod =
        compilerCtx.createModule(
            QualifiedName.fromString("local.Proj.Main"),
            """
            from project.Module import U
            foo (x:U.type) = x
            """);
    compilerCtx.getCompiler().run(mainMod);
    expectNoWarnings(mainMod.getIr());
  }
```

Create `EigentypeAscriptionTest.java`:

```java
package org.enso.interpreter.test;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertThrows;

import org.enso.test.utils.ContextUtils;
import org.junit.After;
import org.junit.ClassRule;
import org.junit.Test;

/**
 * Ascriptions of a type object, {@code (t : X.type)}. See Note [Eigentype References] in {@code
 * org.enso.compiler.pass.resolve.EigentypeReference}.
 */
public class EigentypeAscriptionTest {
  @ClassRule public static final ContextUtils ctx = ContextUtils.createDefault();

  @After
  public void resetOutput() {
    ctx.resetOut();
  }

  @Test
  public void moduleBeforeDotTypeIsRejected() {
    var src =
        """
        import Standard.Base.Data.Numbers

        takes (t : Numbers.type) = t

        main = takes 1
        """;
    assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ctx.getOut(),
        containsString(
            "error: The name Numbers.type is not valid: `.type` must follow a type, but Numbers is"
                + " a module."));
  }
}
```

- [ ] **Step 2: Run them and watch them fail**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.test.pass.resolve.TypeNamesTest"'
```

Expected: FAIL, the two new tests: `Expected the eigentype of A, got None` (or
`0 did not equal 1`: the name is still replaced by "could not be found"), and
`ResolverError(ResolutionNotFound) was not an instance of …NotAType`.

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EigentypeAscriptionTest"'
```

Expected: FAIL with
`Expected: a string containing "error: The name Numbers.type is not valid: …" but: was "…The name `Numbers.type` could not be found.…"`.

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-compiler/testOnly org.enso.compiler.test.UnusedImportsTest"'
```

Expected: FAIL, `usedSymbols_EigentypeAscription` with
`java.lang.UnsupportedOperationException` (strict errors abort).

- [ ] **Step 3: Implement**

In `TypeNames.scala`, `resolveSignature`, add this case **before** the existing
`case n: Name.Qualified =>`:

```scala
      case n: Name.Qualified if EigentypeReference.isEigentypeReference(n) =>
        // Note [Eigentype References]
        EigentypeReference.resolve(n, bindingsMap) match {
          case Right(resolution) =>
            n.updateMetadata(new MetadataPair(this, resolution))
            n
          case Left(reason) =>
            errors.Resolution.create(n, reason)
        }
```

- [ ] **Step 4: Run them and watch them pass**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-compiler/testOnly org.enso.compiler.test.UnusedImportsTest; runtime-integration-tests/testOnly org.enso.compiler.test.pass.resolve.TypeNamesTest org.enso.compiler.test.pass.resolve.TypeSignaturesTest org.enso.interpreter.test.EigentypeAscriptionTest"'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-compiler/src/main/scala/org/enso/compiler/pass/resolve/TypeNames.scala \
  engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/pass/resolve/TypeNamesTest.scala \
  engine/runtime-compiler/src/test/java/org/enso/compiler/test/UnusedImportsTest.java \
  engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeAscriptionTest.java
git commit -m "$(cat <<'EOF'
Resolve `X.type` in type signatures to X's eigentype

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: A type check on `X.type` accepts the type object only

**Files:**

- Modify:
  `engine/runtime-compiler/src/main/java/org/enso/compiler/pass/analyse/types/TypeCheckAlgorithm.java`
  (new abstract method after `forName`, ~line 31; `extractAscribedType` default
  branch, ~lines 116–120)
- Modify:
  `engine/runtime/src/main/java/org/enso/interpreter/runtime/IrTruffleUtils.java`
  (new override after `forName`, ~line 56)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeAscriptionTest.java`

**Interfaces:**

- Consumes: `BindingsMap.Resolution#isEigentype()`;
  `TruffleCompilerModuleScopeBuilder.fromCompilerModule(module).getType(name, true)`;
  `Type#getEigentype()`; `TypeCheckValueNode.single(AscriptionReason, Type)`.
- Produces:
  `protected abstract R forEigentypeName(CompilerContext.Module module, String name) throws E`
  on `TypeCheckAlgorithm`; its `IrTruffleUtils.CreateTypeCheckNodes`
  implementation.

- [ ] **Step 1: Write the failing tests**

In `EigentypeAscriptionTest.java` add the imports

```java
import static org.junit.Assert.assertEquals;

import java.util.List;
import org.graalvm.polyglot.TypeLiteral;
import org.graalvm.polyglot.Value;
```

and the tests:

```java
  private static List<String> texts(Value v) {
    return v.as(new TypeLiteral<List<String>>() {});
  }

  @Test
  public void acceptsTheTypeObjectAndRejectsItsValues() {
    var src =
        """
        from Standard.Base import all

        type Foo
            A

        takes_type (t : Foo.type) = "ok " + t.to_text
        takes_int_type (t : Integer.type) = "ok " + t.to_text

        run ~action = Panic.recover Any action . catch Any e-> "ERROR " + e.to_display_text

        main = [run (takes_type Foo), run (takes_type Foo.A), run (takes_int_type 1), run (takes_int_type Integer)]
        """;
    assertEquals(
        List.of(
            "ok Foo",
            "ERROR Type error: expected `t` to be Foo.type, but got Foo.",
            "ERROR Type error: expected `t` to be Integer.type, but got Integer.",
            "ok Integer"),
        texts(ctx.evalModule(src)));
  }

  @Test
  public void eigentypeInAUnion() {
    var src =
        """
        from Standard.Base import all

        type Foo
            A

        takes (t : Foo.type | Integer) = "ok " + t.to_text

        run ~action = Panic.recover Any action . catch Any _-> "ERROR"

        main = [run (takes Foo), run (takes 1), run (takes Foo.A)]
        """;
    assertEquals(List.of("ok Foo", "ok 1", "ERROR"), texts(ctx.evalModule(src)));
  }
```

- [ ] **Step 2: Run them and watch them fail**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EigentypeAscriptionTest"'
```

Expected: FAIL, both new tests: the check still asks for a value of X, e.g.
`expected:<[ok Foo, ERROR Type error: expected `t`to be Foo.type, but got Foo., …]> but was:<[ERROR Type error: expected`t`to be Foo, but got Foo.type., ok A, ok 1, ERROR Type error: expected`t` to be Integer, but got Integer.type.]>`
and `expected:<[ok Foo, ok 1, ERROR]> but was:<[ERROR, ok 1, ok A]>`.

- [ ] **Step 3: Implement**

`TypeCheckAlgorithm.java`, after `forName`:

```java
  /**
   * Finds a representation of a type check for the eigentype of a named type, {@code X.type}: only
   * the type object {@code X} satisfies it. See Note [Eigentype References] in {@code
   * EigentypeReference}.
   *
   * @param module the module
   * @param name the name of a type inside of that module
   */
  protected abstract R forEigentypeName(CompilerContext.Module module, String name) throws E;
```

and in `extractAscribedType`'s default branch:

```java
            case BindingsMap.ResolvedType binding -> {
              var module = binding.module().unsafeAsModule("convert to module");
              var name = binding.tp().name();
              yield res.isEigentype() ? forEigentypeName(module, name) : forName(module, name);
            }
```

`IrTruffleUtils.java`, in `CreateTypeCheckNodes` after `forName` (no `Any`
shortcut: `Any.type` checks for the type object `Any`):

```java
    @Override
    protected TypeCheckValueNode forEigentypeName(CompilerContext.Module module, String name) {
      var sb = TruffleCompilerModuleScopeBuilder.fromCompilerModule(module);
      var typ = sb.getType(name, true);
      return TypeCheckValueNode.single(comment, typ.getEigentype());
    }
```

- [ ] **Step 4: Run them and watch them pass**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EigentypeAscriptionTest org.enso.compiler.test.semantic.TypeSignaturesTest org.enso.compiler.test.SelfParameterTest"'
```

Expected: PASS (`EigentypeAscriptionTest` 3 tests; `SelfParameterTest` covers
`extractAscribedEigenType`, the synthetic-`self` path that shares
`CreateTypeCheckNodes`).

- [ ] **Step 5: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-compiler/src/main/java/org/enso/compiler/pass/analyse/types/TypeCheckAlgorithm.java \
  engine/runtime/src/main/java/org/enso/interpreter/runtime/IrTruffleUtils.java \
  engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeAscriptionTest.java
git commit -m "$(cat <<'EOF'
Type-check `X.type` ascriptions against the type object

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Conversions dispatch on type objects

**Files:**

- Modify:
  `engine/runtime-compiler/src/main/java/org/enso/compiler/common/BuildScopeFromModuleAlgorithm.java`
  (`getTypeResolution`, ~lines 150–169)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeConversionTest.java`
- Test: `test/Base_Tests/src/Semantic/Conversion_Spec.enso` (definitions after
  line 109; group after line 754)

**Interfaces:**

- Consumes: `BindingsMap.Resolution#isEigentype()`;
  `associatedTypeFromResolvedType(ResolvedType, boolean isStatic)` (runtime:
  `Type#getEigentype()`; static analysis:
  `TypeScopeReference.atomType(qn, true)`).
- Produces: `W.from (that : X.type)` registered with `fromType` = X's eigentype,
  in both `IrToTruffle` and `StaticModuleScopeAnalysis`.

- [ ] **Step 1: Write the failing tests**

`EigentypeConversionTest.java`: extend the imports to

```java
import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.IOException;
import java.util.List;
import java.util.Set;
import org.enso.common.RuntimeOptions;
import org.enso.pkg.QualifiedName;
import org.enso.test.utils.ContextUtils;
import org.enso.test.utils.ProjectUtils;
import org.enso.test.utils.SourceModule;
import org.graalvm.polyglot.TypeLiteral;
import org.graalvm.polyglot.Value;
import org.junit.After;
import org.junit.ClassRule;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
```

and add:

```java
  @Rule public final TemporaryFolder dir = new TemporaryFolder();

  private static List<String> texts(Value v) {
    return v.as(new TypeLiteral<List<String>>() {});
  }

  @Test
  public void conversionsFromTypeObjects() {
    var src =
        """
        from Standard.Base import all

        type W
            Value tag

        type Foo
            A
            B x

        type Statics
            make = 42

        W.from (that : Locale.type) = W.Value "Locale.type"
        W.from (that : Integer.type) = W.Value "Integer.type"
        W.from (that : Text.type) = W.Value "Text.type"
        W.from (that : Foo) = W.Value "Foo value"
        W.from (that : Foo.type) = W.Value "Foo.type"
        W.from (that : Statics.type) = W.Value "Statics.type"

        main =
            t = Foo
            [(W.from Locale).tag, (W.from Integer).tag, (W.from Text).tag, (W.from Foo).tag, (W.from t).tag, (W.from Statics).tag, (W.from Foo.A).tag, (W.from (Foo.B 1)).tag, (Foo.to W).tag]
        """;
    assertEquals(
        List.of(
            "Locale.type",
            "Integer.type",
            "Text.type",
            "Foo.type",
            "Foo.type",
            "Statics.type",
            "Foo value",
            "Foo value",
            "Foo.type"),
        texts(ctx.evalModule(src)));
  }

  @Test
  public void valuesDoNotReachTypeConversionsNorTypesValueConversions() {
    var src =
        """
        from Standard.Base import all
        import Standard.Base.Errors.Common.No_Such_Conversion

        type W
            Value tag

        type Foo
            A

        type Bar
            C

        W.from (that : Locale.type) = W.Value "Locale.type"
        W.from (that : Integer.type) = W.Value "Integer.type"
        W.from (that : Foo.type) = W.Value "Foo.type"
        W.from (that : Bar) = W.Value "Bar value"

        tag_or_none ~action = Panic.catch No_Such_Conversion action.tag _-> "none"

        main = [tag_or_none (W.from 42), tag_or_none (W.from Locale.default), tag_or_none (W.from Foo.A), tag_or_none (W.from Bar), tag_or_none (W.from Bar.C)]
        """;
    assertEquals(
        List.of("none", "none", "none", "none", "Bar value"), texts(ctx.evalModule(src)));
  }

  @Test
  public void anyCatchAllAlsoCatchesTypeObjects() {
    var src =
        """
        from Standard.Base import all

        type V
            Value tag

        type Bar
            C

        type Foo
            A

        V.from (that : Any) = V.Value "Any"
        V.from (that : Bar.type) = V.Value "Bar.type"

        main = [(V.from Bar).tag, (V.from Foo).tag, (V.from Bar.C).tag, (V.from 1).tag]
        """;
    assertEquals(List.of("Bar.type", "Any", "Any", "Any"), texts(ctx.evalModule(src)));
  }

  @Test
  public void extraDefaultedArgumentsDirectlyAndThroughAVariable() {
    var src =
        """
        from Standard.Base import all

        type Filter
            Equals
            Contains

        type W
            Value include_text include_boolean

        W.from (that : Filter.type) (include_text : Boolean = True) (include_boolean : Boolean = True) = W.Value include_text include_boolean

        describe w = w.include_text.to_text + "/" + w.include_boolean.to_text

        main =
            t = Filter
            [describe (W.from Filter), describe (W.from Filter include_text=False), describe (W.from t), describe (W.from t include_boolean=False), describe (W.from t include_text=False include_boolean=False)]
        """;
    assertEquals(
        List.of("True/True", "False/True", "True/True", "True/False", "False/False"),
        texts(ctx.evalModule(src)));
  }

  /** Pins the singleton rule of Note [Eigentype References]; passes before and after this task. */
  @Test
  public void singletonTypeValueAndTypeConversionsCollide() {
    var src =
        """
        type W
            Value tag

        type Statics
            make = 42

        W.from (that : Statics) = W.Value "value"
        W.from (that : Statics.type) = W.Value "type"

        main = (W.from Statics).tag
        """;
    var ex = assertThrows(Exception.class, () -> ctx.evalModule(src));
    assertThat(
        ex.getMessage() + ctx.getOut(),
        containsString("You have already overloaded conversion from Statics to W"));
  }

  @Test
  public void dispatchAcrossModulesWithStaticAnalysis() throws IOException {
    var w =
        """
        from Standard.Base import all

        type W
            Value tag

        ## A conversion in the target type's module.
        W.from (that : Locale.type) = W.Value "Locale.type"
        """;
    var foo =
        """
        import project.W.W

        type Foo
            A
            B x

        ## Conversions in the source type's module.
        W.from (that : Foo) = W.Value "Foo value"
        W.from (that : Foo.type) = W.Value "Foo.type"
        """;
    var statics =
        """
        import project.W.W

        type Statics
            make = 42

        W.from (that : Statics.type) = W.Value "Statics.type"
        """;
    var nope =
        """
        type Nope
            N
        """;
    var resolver =
        """
        from Standard.Base import all
        import Standard.Base.Errors.Common.No_Such_Conversion
        import project.W.W

        ## Imports W only: none of the types it is given.
        resolve t = Panic.catch No_Such_Conversion (W.from t).tag _-> "No_Such_Conversion"
        """;
    var main =
        """
        from Standard.Base import all
        import project.Foo.Foo
        import project.Nope.Nope
        import project.Resolver
        import project.Statics.Statics
        import project.W.W

        main =
            resolved = [Foo, Statics, Locale, Nope].map t-> Resolver.resolve t
            resolved + [(W.from Foo).tag, (W.from Foo.A).tag]
        """;
    var prjDir = dir.newFolder();
    var sources =
        Set.of(
            new SourceModule(QualifiedName.fromString("W"), w),
            new SourceModule(QualifiedName.fromString("Foo"), foo),
            new SourceModule(QualifiedName.fromString("Statics"), statics),
            new SourceModule(QualifiedName.fromString("Nope"), nope),
            new SourceModule(QualifiedName.fromString("Resolver"), resolver),
            new SourceModule(QualifiedName.fromString("Main"), main));
    ProjectUtils.createProject("Eigentype_Dispatch", sources, prjDir.toPath());
    var ctxBuilder =
        ContextUtils.newBuilder()
            .withModifiedContext(
                b -> b.option(RuntimeOptions.ENABLE_STATIC_ANALYSIS, "true"));
    ProjectUtils.testProjectRun(
        ctxBuilder,
        prjDir.toPath(),
        res ->
            assertEquals(
                List.of(
                    "Foo.type",
                    "Statics.type",
                    "Locale.type",
                    "No_Such_Conversion",
                    "Foo.type",
                    "Foo value"),
                texts(res)));
  }
```

`Conversion_Spec.enso`, after `Blob.from (that:Any) = Blob.Json that` (line
109):

```
type Type_Default
    Value tag

Type_Default.from (that : Foo.type) (suffix : Text = "") = Type_Default.Value "Foo.type"+suffix
Type_Default.from (that : Integer.type) = Type_Default.Value "Integer.type"
```

and after the `"f5 d"` spec (line 754), still inside `add_specs`:

```
    suite_builder.group "Conversion from a type object" group_builder->
        group_builder.specify "should dispatch on the type object, not on its values" <|
            Type_Default.from Foo . tag . should_equal "Foo.type"
            Type_Default.from Integer . tag . should_equal "Integer.type"
            Panic.recover Any (Type_Default.from (Foo.Value 1)) . should_fail_with No_Such_Conversion
            Panic.recover Any (Type_Default.from 1) . should_fail_with No_Such_Conversion
            Panic.recover Any (Type_Default.from Bar) . should_fail_with No_Such_Conversion
        group_builder.specify "should take extra defaulted arguments, directly and through a variable" <|
            Type_Default.from Foo suffix="!" . tag . should_equal "Foo.type!"
            t = Foo
            Type_Default.from t . tag . should_equal "Foo.type"
            Type_Default.from t suffix="?" . tag . should_equal "Foo.type?"
        group_builder.specify "should be caught by a catch-all conversion from Any" <|
            Not_Foo.from Foo . notfoo . should_equal "ANY!!!"
```

(The Enso group runs against the built distribution in Task 9.)

- [ ] **Step 2: Run them and watch them fail**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EigentypeConversionTest"'
```

Expected: 5 FAIL, 3 PASS (the two rejections and the singleton pin). The
conversion is still registered from X's _values_: `conversionsFromTypeObjects`
and `dispatchAcrossModulesWithStaticAnalysis` fail loading the module with
`You have already overloaded conversion from Foo to W`; `valuesDoNotReach…` with
`expected:<[none, none, none, none, Bar value]> but was:<[none, none, Foo.type, none, Bar value]>`;
`anyCatchAll…` with
`expected:<[Bar.type, Any, Any, Any]> but was:<[Any, Any, Bar.type, Any]>`;
`extraDefaultedArguments…` with a `No_Such_Conversion` panic
(`Could not find a conversion from …Filter… to …W…`).

- [ ] **Step 3: Implement**

`BuildScopeFromModuleAlgorithm.java`, `getTypeResolution`:

```java
  /**
   * The type a conversion's source or target names. {@code X.type} (a resolution with {@link
   * BindingsMap.Resolution#isEigentype()}) names X's eigentype, the route static methods take. See
   * Note [Eigentype References] in {@code EigentypeReference}.
   */
  protected final TypeScopeReferenceType getTypeResolution(IR expr) {
    var resolution =
        MetadataInteropHelpers.getMetadataOrNull(
            expr, MethodDefinitions.INSTANCE, BindingsMap.Resolution.class);
    if (resolution == null) {
      return null;
    }

    return switch (resolution.target()) {
      case BindingsMap.ResolvedType resolvedType ->
          associatedTypeFromResolvedType(resolvedType, resolution.isEigentype());
      case BindingsMap.ResolvedModule resolvedModule ->
          associatedTypeFromResolvedModule(resolvedModule);
      default ->
          throw new IllegalStateException(
              "Unexpected target type: "
                  + resolution.target().getClass().getCanonicalName()
                  + ", should be caught by MethodDefinitions pass.");
    };
  }
```

- [ ] **Step 4: Run them and watch them pass**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.EigentypeConversionTest org.enso.interpreter.test.EigentypeAscriptionTest org.enso.interpreter.test.ConversionMethodTests org.enso.interpreter.test.EqualsConversionsTest org.enso.compiler.test.TypeInferenceTest"'
```

Expected: PASS (`EigentypeConversionTest` 8 tests). Proves dispatch for every
spike case, in the target's and the source's module, through a variable in a
module that imports none of the types, with static analysis on; does not prove
the Enso group (Task 9) or IR caches (Task 5).

- [ ] **Step 5: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-compiler/src/main/java/org/enso/compiler/common/BuildScopeFromModuleAlgorithm.java \
  engine/runtime-integration-tests/src/test/java/org/enso/interpreter/test/EigentypeConversionTest.java \
  test/Base_Tests/src/Semantic/Conversion_Spec.enso
git commit -m "$(cat <<'EOF'
Register a conversion from `X.type` on X's eigentype

`W.from (that : X.type)` now dispatches on the type object X, extra defaulted
arguments included; runtime dispatch itself is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: The eigentype flag survives the IR cache

**Files:**

- Create:
  `engine/runtime-integration-tests/src/test/resources/Eigentype_Test/package.yaml`
- Create:
  `engine/runtime-integration-tests/src/test/resources/Eigentype_Test/src/Conversions.enso`
- Create:
  `engine/runtime-integration-tests/src/test/resources/Eigentype_Test/src/Main.enso`
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/compiler/test/SerdeCompilerTest.java`
  (after `testAscriptionAsLastLineOfBlock`, ~line 48)

**Interfaces:**

- Consumes:
  `SerdeCompilerTest.parseSerializedModule(String projectName, String forbiddenMessage)`
  (compiles with caches off, serialises, reloads from the caches, runs `main`,
  which must return 42, and compares the IR); the generated persister of
  `BindingsMap.Resolution` (`@Persistable(id = 33018)` in `ImportExportCache`,
  built from the richest constructor `(ResolvedName, boolean)`).
- Produces: `SerdeCompilerTest.testEigentypeConversionSurvivesCache()`.

- [ ] **Step 1: Write the test project and the test**

`package.yaml`:

```yaml
name: Eigentype_Test
license: APLv2
enso-version: default
version: "0.0.1"
author: jdunkerley
maintainer: jdunkerley
```

`src/Conversions.enso` (no `Standard.Base`, like the other Serde projects):

```
type Source
    Value x

type Target
    Value tag

## Without the eigentype flag both conversions register from Source and the
   module fails to load.
Target.from (that : Source) = Target.Value 0
Target.from (that : Source.type) (tag = 42) = Target.Value tag
```

`src/Main.enso`:

```
import project.Conversions.Source
import project.Conversions.Target

main = (Target.from Source).tag
```

`SerdeCompilerTest.java`:

```java
  /**
   * A conversion from a type object, {@code Target.from (that : Source.type)}, keeps its eigentype
   * flag through the IR cache. Lose it and both conversions of the project register from {@code
   * Source}, so the reloaded module fails. See Note [Eigentype References].
   */
  @Test
  public void testEigentypeConversionSurvivesCache() throws Exception {
    parseSerializedModule("Eigentype_Test", null);
  }
```

- [ ] **Step 2: Run it**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.test.SerdeCompilerTest"'
```

Expected: PASS, all three tests. The generated persister already covers the new
constructor parameter, so this test guards rather than drives; Step 3 shows it
bites.

- [ ] **Step 3: Show the test catches a lost flag, then restore**

Temporarily make serialisation drop the flag. In `BindingsMap.scala`,
`Resolution.prepareForSerialization`:

```scala
      this.copy(target = this.target.toAbstract, isEigentype = false)
```

Run **SYNC** and the Step 2 command. Expected: FAIL in
`testEigentypeConversionSurvivesCache`, when the cached module loads, with
`You have already overloaded conversion from Source to Target` (or a type error
on `that`, if the `TypeNames` flag is read first). Then restore and confirm:

```bash
cd /c/Repos/Enso/ide-widgets-pr0 && git checkout -- engine/runtime-compiler/src/main/scala/org/enso/compiler/data/BindingsMap.scala && git diff --stat
```

Expected: no change to `BindingsMap.scala` left. Run **SYNC** and the Step 2
command again: PASS.

- [ ] **Step 4: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-integration-tests/src/test/resources/Eigentype_Test \
  engine/runtime-integration-tests/src/test/java/org/enso/compiler/test/SerdeCompilerTest.java
git commit -m "$(cat <<'EOF'
Test that a conversion from a type object survives the IR cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The suggestion database records the source as `….X.type`

**Files:**

- Modify:
  `engine/runtime-suggestions/src/main/scala/org/enso/compiler/suggestions/SuggestionBuilder.scala`
  (`buildTypeSignature`, `case tname: Name`, ~lines 552–556)
- Test:
  `engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/context/SuggestionBuilderTest.scala`
  (before `"build function simple"`, ~line 1647)
- Test:
  `app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/conversionSources.test.ts`
  (append)

**Interfaces:**

- Consumes: `BindingsMap.Resolution#isEigentype`, `#referencedName`;
  `TypeArg.Value(QualifiedName)`.
- Produces: `Suggestion.Argument.reprType == "<X's qualified name>.type"` (and
  `tagValues == None`) for an argument ascribed `X.type`, in conversions and
  every other suggestion with arguments. The GUI index `conversionSources` keys
  such a conversion's source as `….X.type`; no GUI code changes (no guard is
  needed: the key can only match a node whose value is the type object, which
  does convert).

- [ ] **Step 1: Write the failing test**

`SuggestionBuilderTest.scala`:

```scala
    "build conversion methods from a type object and from its values" in {
      val code =
        """type Foo
          |    Value foo
          |
          |type Bar
          |    Value bar
          |
          |Bar.from (that : Foo) = Bar.Value that.foo
          |Bar.from (that : Foo.type) = Bar.Value 0
          |""".stripMargin
      val module = code.preprocessModule()

      build(code, module) shouldEqual Tree.Root(
        Vector(
          ModuleNode,
          Tree.Node(
            Suggestion.Type(
              externalId    = None,
              module        = "Test",
              name          = "Foo",
              params        = Seq(),
              returnType    = "Test.Foo",
              parentType    = Some(SuggestionBuilder.Any),
              documentation = None
            ),
            Vector()
          ),
          Tree.Node(
            Suggestion.Constructor(
              externalId = None,
              module     = "Test",
              name       = "Value",
              arguments = Seq(
                Suggestion
                  .Argument("foo", SuggestionBuilder.Any, false, false, None)
              ),
              returnType    = "Test.Foo",
              documentation = None,
              annotations   = Seq()
            ),
            Vector()
          ),
          Tree.Node(
            Suggestion.Getter(
              externalId = None,
              module     = "Test",
              name       = "foo",
              arguments = List(
                Suggestion.Argument("self", "Test.Foo", false, false, None)
              ),
              selfType      = "Test.Foo",
              returnType    = SuggestionBuilder.Any,
              documentation = None,
              annotations   = Seq()
            ),
            Vector()
          ),
          Tree.Node(
            Suggestion.Type(
              externalId    = None,
              module        = "Test",
              name          = "Bar",
              params        = Seq(),
              returnType    = "Test.Bar",
              parentType    = Some(SuggestionBuilder.Any),
              documentation = None
            ),
            Vector()
          ),
          Tree.Node(
            Suggestion.Constructor(
              externalId = None,
              module     = "Test",
              name       = "Value",
              arguments = Seq(
                Suggestion
                  .Argument("bar", SuggestionBuilder.Any, false, false, None)
              ),
              returnType    = "Test.Bar",
              documentation = None,
              annotations   = Seq()
            ),
            Vector()
          ),
          Tree.Node(
            Suggestion.Getter(
              externalId = None,
              module     = "Test",
              name       = "bar",
              arguments = List(
                Suggestion.Argument("self", "Test.Bar", false, false, None)
              ),
              selfType      = "Test.Bar",
              returnType    = SuggestionBuilder.Any,
              documentation = None,
              annotations   = Seq()
            ),
            Vector()
          ),
          Tree.Node(
            Suggestion.Conversion(
              externalId = None,
              module     = "Test",
              arguments = Seq(
                Suggestion.Argument("that", "Test.Foo", false, false, None)
              ),
              selfType      = "Test.Bar",
              returnType    = "Test.Bar",
              documentation = None
            ),
            Vector()
          ),
          Tree.Node(
            Suggestion.Conversion(
              externalId = None,
              module     = "Test",
              arguments = Seq(
                Suggestion
                  .Argument("that", "Test.Foo.type", false, false, None)
              ),
              selfType      = "Test.Bar",
              returnType    = "Test.Bar",
              documentation = None
            ),
            Vector()
          )
        )
      )
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.test.context.SuggestionBuilderTest -- -z \"from a type object\""'
```

Expected: FAIL, `Root(…) did not equal Root(…)`: the last `Conversion`'s
argument has `reprType` `Test.Foo`, the same as the value conversion (the bug
the spec describes for the GUI's `conversionSources`).

- [ ] **Step 3: Implement**

`SuggestionBuilder.scala`, `buildTypeSignature`:

```scala
      case tname: Name =>
        tname
          .getMetadata(TypeNames, classOf[TypeNames.Metadata])
          .map { resolution =>
            // Note [Eigentype References]: `X.type` is the type object's
            // type, reported as `….X.type`, never as X.
            if (resolution.isEigentype) TypeArg.Value(resolution.referencedName)
            else buildResolvedTypeName(resolution.target)
          }
          .getOrElse(TypeArg.Value(QualifiedName.simpleName(tname.name)))
```

- [ ] **Step 4: Run the whole SuggestionBuilderTest**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.test.context.SuggestionBuilderTest"'
```

Expected: PASS, every test (the existing ones prove a value type's `reprType`
and `tagValues` are unchanged).

- [ ] **Step 5: Pin the GUI side**

Append to `conversionSources.test.ts`:

```ts
test("a conversion from a type object is keyed on `….Foo.type`, apart from Foo values", () => {
  const db = SuggestionDb.createMock([
    // `W.from (that : Foo.type)`: the engine reports the source as `….Foo.type`.
    makeMethod("local.Proj.W.W.from", {
      args: [makeArgument("that", "local.Proj.Foo.Foo.type")],
    }),
  ]);
  const target = parseAbsoluteProjectPathRaw("local.Proj.W.W");
  const typeSource = parseAbsoluteProjectPathRaw("local.Proj.Foo.Foo.type");
  const valueSource = parseAbsoluteProjectPathRaw("local.Proj.Foo.Foo");
  assert(target.ok && typeSource.ok && valueSource.ok);
  const sources = db.conversionSources.lookup(target.value.key());
  expect(sources).toEqual(new Set([typeSource.value.key()]));
  expect(sources?.has(valueSource.value.key())).toBe(false);
});
```

```bash
cd /c/Repos/Enso/ide-widgets-pr0 && corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/suggestionDatabase/__tests__/conversionSources.test.ts
```

Expected: PASS, 2 tests, with no GUI source change: this pins that the index
needs no guard. (It cannot fail first; it documents the conclusion. If vitest
reports a missing workspace build, run `corepack pnpm -r compile` once and
rerun.)

- [ ] **Step 6: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-suggestions/src/main/scala/org/enso/compiler/suggestions/SuggestionBuilder.scala \
  engine/runtime-integration-tests/src/test/scala/org/enso/compiler/test/context/SuggestionBuilderTest.scala \
  app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/conversionSources.test.ts
git commit -m "$(cat <<'EOF'
Record a `.type` conversion source as `….X.type` in suggestions

The GUI's `conversionSources` index no longer takes a conversion from the type
object for one from X's values; the index needs no guard (pinned by a test).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Generated API signatures print `….X.type`

**Files:**

- Modify:
  `engine/runtime-compiler/src/main/java/org/enso/compiler/docs/DocsUtils.java`
  (`extractFqnOrNull`, ~lines 205–212)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/compiler/dump/test/DocsGenerateTest.java`
  (after `conversionBlank`, ~line 520)

**Interfaces:**

- Consumes: `BindingsMap.Resolution#referencedName()` (Java accessor of the
  Scala `def`).
- Produces: signature lines such as
  `- Main.Target.from that:Main.Source.type -> Main.Target`.

- [ ] **Step 1: Write the failing test**

```java
  @Test
  public void conversionFromTypeObject() throws Exception {
    var code =
        """
        type Source
            Value x
        type Target
        Target.from (that:Source.type) = 42
        """;
    var sig = DumpTestUtils.generateSignatures(ctxRule, code, "Main");
    var sigLine = lastLine(sig);
    assertThat(
        "Conversion from the type object: " + sigLine,
        sigLine,
        containsString("Main.Target.from that:Main.Source.type -> Main.Target"));
  }
```

- [ ] **Step 2: Run it and watch it fail**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.dump.test.DocsGenerateTest -- --tests=conversionFromTypeObject"'
```

Expected: FAIL with
`Expected: a string containing "Main.Target.from that:Main.Source.type -> Main.Target" but: was "- Main.Target.from that:Main.Source -> Main.Target"`.

- [ ] **Step 3: Implement**

```java
  private static QualifiedName extractFqnOrNull(IR ir) {
    var typeNameOpt = ir.passData().get(TypeNames$.MODULE$);
    if (typeNameOpt.isDefined()) {
      var typeName = (BindingsMap.Resolution) typeNameOpt.get();
      // Note [Eigentype References]: `X.type` prints as `….X.type`.
      return typeName.referencedName();
    }
    return null;
  }
```

- [ ] **Step 4: Run the class and watch it pass**

Run **SYNC**, then:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-integration-tests/testOnly org.enso.compiler.dump.test.DocsGenerateTest"'
```

Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-compiler/src/main/java/org/enso/compiler/docs/DocsUtils.java \
  engine/runtime-integration-tests/src/test/java/org/enso/compiler/dump/test/DocsGenerateTest.java
git commit -m "$(cat <<'EOF'
Print `X.type` in generated API signatures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Document the convention and the cache-stamp trap

**Files:**

- Modify: `engine/runtime-compiler/CLAUDE.md` (Conventions, after the
  `PassPersistance.java` bullet)
- Modify: `lib/java/CLAUDE.md` (the `persistance/` bullet)
- Create: `engine/runtime-suggestions/CLAUDE.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Write the documentation**

`engine/runtime-compiler/CLAUDE.md`, after
`- Pass metadata that goes into IR caches is registered in …`:

```markdown
- **`X.type` names X's eigentype in a type position** (a conversion's source, an
  ascription). `pass/resolve/EigentypeReference.java` resolves it once to a
  `BindingsMap.Resolution` of X with `isEigentype = true`; read the flag (or
  `Resolution.referencedName`), never the name's spelling. Note [Eigentype
  References] lists the consumers.
```

`lib/java/CLAUDE.md`, replace (exact text, a nested item indented three spaces;
then run Prettier on the file, Step 2)

```text
   - `persistance/` + `persistance-dsl/` — custom serialization framework used
     by `engine/polyglot-api/` and IR caches. Annotation-driven.
```

with

```text
   - `persistance/` + `persistance-dsl/` — custom serialization framework used
     by `engine/polyglot-api/` and IR caches. Annotation-driven. The version
     stamp that rejects old caches hashes the registered `@Persistable` ids,
     not their fields: a new constructor parameter on a persisted class must
     also bump `serialVersionUID` in `persistance/…/PerMap.java` (to the PR
     number), or caches written by the previous build are read with the new
     layout.
```

Create `engine/runtime-suggestions/CLAUDE.md`:

```markdown
# engine/runtime-suggestions

Turns a compiled module's IR into the IDE's suggestion database entries.
`SuggestionBuilder` builds the types, constructors, getters, methods,
conversions and locals of a module, with each argument's `reprType` and
`tagValues`; `ExportsBuilder`, `ExportsMap` and `ModuleExportsDiff` track what
each module exports; `SuggestionDiff` and `SimpleUpdate` describe the changes
between two versions. The runtime's analysis jobs (`runtime-instrument-common`)
call it; the language server forwards the result to the GUI.

## Conventions

- A type position's `reprType` comes from the `TypeNames` resolution of the
  name, never from its spelling. `X.type`, X's eigentype (Note [Eigentype
  References] in `runtime-compiler`'s `EigentypeReference.java`), is reported as
  `<X's qualified name>.type`, so the GUI's `conversionSources` index keeps a
  conversion from the type object apart from one from X's values.

## Tests

`SuggestionBuilderTest` lives in `engine/runtime-integration-tests`
(`org.enso.compiler.test.context`), not here:

    sbt "runtime-integration-tests/testOnly org.enso.compiler.test.context.SuggestionBuilderTest"
```

- [ ] **Step 2: Check formatting**

```bash
cd /c/Repos/Enso/ide-widgets-pr0 && corepack pnpm exec prettier --check engine/runtime-compiler/CLAUDE.md lib/java/CLAUDE.md engine/runtime-suggestions/CLAUDE.md app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/conversionSources.test.ts
```

Expected: `All matched files use Prettier code style!` (if not, run the same
with `--write` and re-check).

- [ ] **Step 3: Commit**

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git add engine/runtime-compiler/CLAUDE.md lib/java/CLAUDE.md engine/runtime-suggestions/CLAUDE.md
git commit -m "$(cat <<'EOF'
Document eigentype references and the persistance version stamp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Verify on Linux

**Files:** none changed (fix and recommit if anything fails).

**Interfaces:** none.

- [ ] **Step 1: Sync the committed branch**

```bash
cd /c/Repos/Enso/ide-widgets-pr0 && git status --short
```

Expected: empty (everything committed). Then run **SYNC**; its last line prints
`0`.

- [ ] **Step 2: Formatting**

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "scalafmtCheckAll; javafmtCheckAll"'
```

Expected: `[success]`. Proves the Scala and Java are formatted as CI checks;
nothing else.

- [ ] **Step 3: Every test class this PR adds or touches**

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt "runtime-compiler/testOnly org.enso.compiler.test.UnusedImportsTest; runtime-integration-tests/testOnly org.enso.interpreter.test.EigentypeConversionTest org.enso.interpreter.test.EigentypeAscriptionTest org.enso.compiler.test.pass.* org.enso.compiler.test.passes.* org.enso.compiler.test.SerdeCompilerTest org.enso.compiler.test.SerializerTest org.enso.compiler.test.context.SuggestionBuilderTest org.enso.compiler.dump.test.DocsGenerateTest org.enso.compiler.test.TypeInferenceTest org.enso.interpreter.test.ConversionMethodTests org.enso.interpreter.test.semantic.PatternMatchTest org.enso.interpreter.test.semantic.CaseTest org.enso.interpreter.test.semantic.MethodsTest"'
```

Expected: `[success]` for both. Proves the new behaviour and the neighbours of
every edited site; does not prove the rest of `runtime-integration-tests` (CI
runs the full suite).

- [ ] **Step 4: Build the distribution**

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0 && sbt buildEngineDistribution'
```

Expected: `[success]`. Proves the standard libraries compile and index (and
their IR caches are written) with the new `Resolution` layout and stamp; runs no
tests. Does not exercise `gatherLicenses` or `bloopInstall`, which this PR
cannot affect (no dependency change).

- [ ] **Step 5: Base_Tests without caches**

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'set -o pipefail; export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0/test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Tests" 2>&1 | tee ~/pr0-base-tests.log | tail -5; grep -c "should dispatch on the type object, not on its values\|should take extra defaulted arguments, directly and through a variable\|should be caught by a catch-all conversion from Any" ~/pr0-base-tests.log'
```

Expected: `0 tests failed.` in the tail, and the count is at least `3` (the new
group ran: a filter-free run cannot silently skip it, but check anyway, per the
CLAUDE.md trap). Proves the standard library's own behaviour is unchanged and
the Enso-level group passes through the launcher.

- [ ] **Step 6: The conversion specs with caches on**

Without `--no-ir-caches` the run loads `Standard.Base` from the IR caches Step 4
wrote, so every `Resolution` in them is read back with the new layout.

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'set -o pipefail; export ENSO_REPO=$HOME/enso-pr0 && . ~/.enso-toolchain.sh && cd ~/enso-pr0/test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" ../built-distribution/enso-engine-*/enso-*/bin/enso --run "$PWD/Base_Tests" "Conversion" 2>&1 | tee ~/pr0-base-tests-cached.log | tail -5; grep -c "should dispatch on the type object, not on its values" ~/pr0-base-tests-cached.log'
```

Expected: `0 tests failed.` and a count of `1` (the filter matched the group; a
filter matching nothing would also print `0 tests failed.`).

- [ ] **Step 7: Note what was not verified**

Record for the PR: not run on Windows (no platform surface: paths, processes,
native code); the IDE not launched (the change is invisible until PR 3, and
`conversionSources` is pinned by a unit test); the full
`runtime-integration-tests` suite and the GUI checks left to CI.

---

## Task 10: The PR description, ready for review, cleanup

**Files:** none in the repository.

**Interfaces:** Consumes the draft PR from Task 1, Step 11.

- [ ] **Step 1: Find a ticket to close**

```bash
gh issue list --state open --search "type conversions in:title,body" --limit 10
gh issue list --state open --search "widgets by conversion" --limit 10
```

If an open issue is PR 0's ticket, add `Closes #<n>` as the last line before the
footer below; otherwise leave it out.

- [ ] **Step 2: Write the description and push**

Only if every command in Task 9 passed. Save as `/c/Repos/Enso/pr0-body.md`
(outside the worktree):

```markdown
## What

`X.type` now names X's eigentype, the type of the type object `X`, in a type
position:

- a conversion keyed on a type object: `W.from (that : Locale.type) = …`, extra
  defaulted arguments included
  (`W.from (that : Filter.type) (include_text : Boolean = True) = …`, called as
  `W.from Filter include_text=False`, directly or through a variable);
- a plain ascription: `f (t : Foo.type)` accepts `Foo` and rejects its values.

`SomeModule.type`, `Foo.Value.type` and the like are compile errors: "The name
SomeModule.type is not valid: `.type` must follow a type, but SomeModule is a
module."

PR 0 of the widgets-by-conversion design
(`docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md`, #881):
type defaults will be `Widget.from (that : X.type)`. No standard-library or
widget change here.

## How

`X.type` is resolved once, by `EigentypeReference` (from `MethodDefinitions` for
a conversion's source, from `TypeNames` for ascriptions), to an ordinary
`BindingsMap.Resolution` of X with a new flag, `isEigentype` (Note [Eigentype
References]). What only asks which symbol a name is (imports, the unused-import
lint) still sees X. The consumers that turn a type position into a type read the
flag, never the spelling:

- conversions register from the eigentype (`BuildScopeFromModuleAlgorithm`), the
  route static methods already take; runtime dispatch is unchanged;
- type checks accept the type object only (`TypeCheckAlgorithm`,
  `IrTruffleUtils`);
- the suggestion database records the source as `….X.type`
  (`SuggestionBuilder`), so the GUI's `conversionSources` index (visualization
  picker) no longer believes X's values convert. The index needs no guard: a
  `….X.type` key only matches a node whose value is the type object, which does
  convert (pinned by a Vitest);
- generated API signatures print `….X.type` (`DocsUtils`).

`Resolution`'s persisted layout gained a field, so `PerMap.serialVersionUID`
moves to this PR's number and older IR caches are rebuilt rather than misread.
The one-argument `Resolution(x)` patterns gain `, _` (15 sites); constructions
are unchanged.

## Worth knowing

- `W.from (that : X)` and `W.from (that : X.type)` never see each other's
  arguments; `W.from (that : Any)` still catches every type object without a
  conversion of its own.
- A type without constructors is a singleton: its type object's type is itself,
  so `X` and `X.type` are the same runtime type there, and declaring both
  conversions in one module fails at load ("You have already overloaded
  conversion from X to W"). Pinned by a test.
- Not supported (not needed by the design): methods on `X.type`
  (`X.type.method = …`) and `X.type` in `case` patterns.

## Tests

- `EigentypeConversionTest`: built-in, Base and user types; constructor-less
  types; conversions in the target's and the source's module; through a variable
  in a module that imports none of the types; static analysis on; value and type
  conversions apart; `No_Such_Conversion`; the `Any` catch-all; extra defaulted
  arguments; module and constructor rejected.
- `EigentypeAscriptionTest`: `(t : Foo.type)`, `(t : Integer.type)`, a union,
  module rejected.
- `MethodDefinitionsTest`, `TypeNamesTest`: the flag, and `NotAType`.
- `UnusedImportsTest`: an import used only as `X.type` is used.
- `SerdeCompilerTest.testEigentypeConversionSurvivesCache`: IR cache round trip
  (shown to fail when serialisation drops the flag).
- `SuggestionBuilderTest`: `that` recorded as `Test.Foo.type` beside the value
  conversion's `Test.Foo`. `DocsGenerateTest`: `that:Main.Source.type`.
- `Conversion_Spec.enso`: group "Conversion from a type object".

## Verification

On Linux (WSL Ubuntu-24.04): `scalafmtCheckAll; javafmtCheckAll`; the test
classes above and their neighbours (`org.enso.compiler.test.pass.*`,
`PatternMatchTest`, `CaseTest`, `MethodsTest`, `ConversionMethodTests`,
`TypeInferenceTest`, `SerializerTest`); `buildEngineDistribution`;
`test/Base_Tests` with `--no-ir-caches` (0 failed), and its conversion groups
again loading `Standard.Base` from the new IR caches (0 failed).

Not verified here: Windows (no platform surface), the IDE (nothing visible until
PR 3), the full `runtime-integration-tests` suite (CI).

No changelog entry: invisible to users until the standard library uses it (label
`CI: No changelog needed`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
cd /c/Repos/Enso/ide-widgets-pr0
git push
gh pr edit --body-file /c/Repos/Enso/pr0-body.md
gh pr edit --add-label "CI: No changelog needed"
gh pr ready
gh pr view --json number,url,labels,isDraft --jq '{number, url, labels: [.labels[].name], isDraft}'
```

Expected: `isDraft: false`, labels include `CI: No changelog needed`.

- [ ] **Step 3: Clean up the Linux worktree and the scratch files**

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'git -C ~/enso worktree remove --force ~/enso-pr0 && git -C ~/enso worktree prune && rm -f ~/pr0-base-tests.log ~/pr0-base-tests-cached.log && df -h ~ | tail -1'
rm -f /c/Repos/Enso/pr0-sync.diff /c/Repos/Enso/pr0-body.md
```

Keep the Windows worktree until the PR merges. This is a language feature: it
waits for the owner's OK to merge (merge gate for features), and merging must
not use `--delete-branch` while the worktree exists.

---

## Self-review: spec requirements → tasks

| Spec requirement (PR 0)                                                                                                                                              | Task                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `W.from (that : X.type)` keyed on X's eigentype                                                                                                                      | 1, 4                          |
| Plain signature `(t : X.type)`                                                                                                                                       | 2, 3                          |
| Proper eigentype metadata, not the name check                                                                                                                        | 1 (`isEigentype`)             |
| Reject `SomeModule.type`                                                                                                                                             | 1, 2                          |
| Extra defaulted arguments, directly and through a variable                                                                                                           | 4                             |
| Every spike case (target/source module, built-in/Base/user, statics only, variable in a non-importing module, no collision, `No_Such_Conversion`, `Any`, `Foo.to W`) | 4                             |
| IR caches carry the metadata                                                                                                                                         | 1 (stamp), 5                  |
| Static analysis on                                                                                                                                                   | 4                             |
| Suggestion database records `….Foo.type`                                                                                                                             | 6                             |
| Check whether `conversionSources` needs a guard                                                                                                                      | 6 (no; pinned)                |
| No changelog entry, label `CI: No changelog needed`                                                                                                                  | 1, 10                         |
| No standard-library or widget change                                                                                                                                 | all (only `test/` and engine) |
| Note and CLAUDE.md                                                                                                                                                   | 1, 8                          |
