# Boolean widget (`[☑] True ▾`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Boolean argument shows a checkbox, its value as code, and the usual
dropdown arrow (`[☑] True ▾`) in place of today's bare checkbox.

**Architecture:** The dropdown is not new code: `WidgetSelection` already draws
`True ▾` for an argument whose tags are `True`/`False`, and today it only steps
aside (`isHandledByCheckboxWidget` → `Mismatch`) so that `WidgetCheckbox` can
draw a bare checkbox. This plan turns that around: `WidgetSelection` draws the
dropdown for every Boolean argument (with the `True`/`False` imports the
checkbox used to add), and a new `WidgetBoolean` (priority 101, inside the
dropdown and after the argument name) draws the checkbox and the value: the code
of a `True`/`False` literal, or the default greyed for an unset argument. A
value that is not a literal is left to the other widgets, so it has no checkbox.
`WidgetCheckbox.vue` is deleted. It does **not** build on
`WidgetPicker/PickerShell.vue`: the shell's menu replaces a whole value with a
picker of its own, while Boolean's two entries are exactly what
`WidgetSelection`'s list already does, with its keyboard, filtering and
highlight of the current value.

**Tech Stack:** Vue 3, TypeScript, Vitest, Playwright; the widget registry
(`$/providers/openedProjects/widgetRegistry`), `@/util/ast`, `@/util/callTree`.

**Spec:**
`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`
(part B).

**Base:** builds on `develop` alone. It needs nothing from part A
(`docs/superpowers/plans/2026-11-16-argument-access.md`), C or D.

## Global Constraints

- A **Boolean argument** is an input with `ArgumentInfoKey` set and any of: tag
  values exactly `True`/`False` (what `isHandledByCheckboxWidget` matches
  today), a `reprType` or `expectedType` of
  `Standard.Base.Data.Boolean.Boolean`, or a `True`/`False` literal as its
  value. It shows `[☑] True ▾`: the checkbox, then the value as code, then the ▾
  arrow under it, like any dropdown argument.
- Clicking the checkbox flips the value. ▾ opens exactly `True` and `False`, no
  other entry.
- An unset argument shows its default greyed (as `WidgetNumber` shows a
  placeholder's default); clicking either control writes the value.
- The checkbox is shown only while the value is a `True`/`False` literal
  (`True`, `False`, `Boolean.True`, `Boolean.False`) or the argument is unset. A
  connected argument shows its edge as today, with no checkbox.
- An argument with its own dynamic configuration (an `@` dropdown) keeps it:
  nothing here changes `WidgetSelection`'s behaviour when `dynamicConfig` is
  set.
- A `True`/`False` literal that is **not** an argument (a whole node `x = True`,
  an operand of `&&`) keeps the checkbox and its code, with no ▾:
  `WidgetSelection`'s click handling would take the node's own clicks there.
- Writing `True`/`False` adds the import of `Standard.Base.Data.Boolean`'s
  constructor when it is missing, as `WidgetCheckbox` did
  (`requiredImportsByProjectPath(..., true)`), in the same edit.
- `WidgetCheckbox.vue` is deleted and nothing refers to it afterwards.
- Repo rules: `corepack pnpm`; stage explicit paths only; never `git stash`,
  `git add -A`/`.`, `--no-verify`. Commits end with a blank line, then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A `CHANGELOG.md` entry under `#### Enso IDE` (visible change).
- Merge only after the owner's OK on an installer.

## File map

| File (under `app/gui/src/project-view/components/GraphEditor/widgets/` unless rooted) | Responsibility                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `WidgetBoolean/booleanValue.ts`                                                       | framework-free: which inputs are Boolean, a literal's value, the dropdown's tags |
| `WidgetBoolean/__tests__/booleanValue.test.ts`                                        | its unit tests                                                                   |
| `WidgetSelection.vue`                                                                 | a dropdown for every Boolean argument, with the `True`/`False` tags and imports  |
| `WidgetSelection/__tests__/booleanDropdown.test.ts`                                   | `hasDropdown` for Boolean arguments                                              |
| `WidgetBoolean.vue`                                                                   | the checkbox and the value (code, or the default greyed); the flip edit          |
| `WidgetBoolean/__tests__/widgetBoolean.score.test.ts`                                 | which inputs `WidgetBoolean` takes                                               |
| `WidgetCheckbox.vue`                                                                  | deleted                                                                          |
| `CLAUDE.md` (this folder)                                                             | a `WidgetBoolean.vue` entry                                                      |
| `app/gui/integration-test/project-view/widgets.spec.ts`                               | Playwright: `Boolean widget` describe block                                      |
| `CHANGELOG.md`                                                                        | entry                                                                            |

Run unit tests from `app/gui`: `corepack pnpm exec vitest run <path>`.
Typecheck: `corepack pnpm run typecheck`. Lint:
`corepack pnpm exec eslint <paths>`. In a fresh worktree run
`corepack pnpm install` then `corepack pnpm -r compile` first (stale workspace
packages break Vitest's config load).

---

### Task 1: What is a Boolean, framework-free

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean/booleanValue.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean/__tests__/booleanValue.test.ts`

**Interfaces:**

- Produces:

```ts
/** The qualified name of the `Boolean` type, as a typed argument's `reprType` or `expectedType` has it. */
export const BOOLEAN_TYPE = "Standard.Base.Data.Boolean.Boolean";

/** The value a literal's code stands for: `True`, `Boolean.True` and the fully qualified name, and the same for `False`; otherwise `undefined`. */
export function booleanFromCode(code: string | undefined): boolean | undefined;

/** The value of the input's AST when it is a `True`/`False` literal (`True`, `Boolean.False`, …); `undefined` for anything else, a placeholder included. */
export function booleanLiteral(
  value: WidgetInput["value"],
): boolean | undefined;

/** Whether the input is an argument that takes a Boolean (Global Constraints, first bullet). */
export function isBooleanArgument(input: WidgetInput): boolean;

/** The two dropdown entries, `True` then `False`, each carrying the import of its constructor. */
export function booleanExpressionTags(
  db: Parameters<typeof requiredImportsByProjectPath>[0],
): ExpressionTag[];
```

- [ ] **Step 1: Write the failing tests**

```ts
/** @file Which inputs are Booleans, and the dropdown's entries. */
import { WidgetInput } from "$/providers/openedProjects/widgetRegistry";
import { Ast } from "@/util/ast";
import { ArgumentInfoKey } from "@/util/callTree";
import { describe, expect, test } from "vitest";
import {
  BOOLEAN_TYPE,
  booleanExpressionTags,
  booleanFromCode,
  booleanLiteral,
  isBooleanArgument,
} from "../booleanValue";

const argument = (
  info: { reprType?: string; tagValues?: string[] },
  extra: Partial<WidgetInput> = {},
): WidgetInput =>
  ({
    portId: "port" as WidgetInput["portId"],
    value: undefined,
    [ArgumentInfoKey]: {
      appKind: 0,
      info: {
        name: "keep",
        reprType: "Standard.Base.Any.Any",
        isSuspended: false,
        hasDefault: true,
        ...info,
      },
    },
    ...extra,
  }) as WidgetInput;

describe("booleanFromCode", () => {
  test.each([
    ["True", true],
    ["False", false],
    ["Boolean.True", true],
    ["Boolean.False", false],
    ["Standard.Base.Data.Boolean.Boolean.True", true],
    [" False ", false],
  ])("%s is %s", (code, value) => {
    expect(booleanFromCode(code)).toBe(value);
  });

  test.each([undefined, "", "true", "x", "a && True", "Other.True"])(
    "%s is not a Boolean literal",
    (code) => {
      expect(booleanFromCode(code)).toBeUndefined();
    },
  );
});

describe("booleanLiteral", () => {
  test("an AST literal", () => {
    expect(booleanLiteral(Ast.parseExpression("True")!)).toBe(true);
    expect(booleanLiteral(Ast.parseExpression("Boolean.False")!)).toBe(false);
  });

  test("not a literal", () => {
    expect(booleanLiteral(Ast.parseExpression("a > b")!)).toBeUndefined();
    expect(booleanLiteral(Ast.parseExpression("flag")!)).toBeUndefined();
    expect(booleanLiteral(undefined)).toBeUndefined();
  });
});

describe("isBooleanArgument", () => {
  test("tag values True and False, in any order", () => {
    expect(isBooleanArgument(argument({ tagValues: ["True", "False"] }))).toBe(
      true,
    );
    expect(isBooleanArgument(argument({ tagValues: ["False", "True"] }))).toBe(
      true,
    );
  });

  test("a Boolean reprType or expected type", () => {
    expect(isBooleanArgument(argument({ reprType: BOOLEAN_TYPE }))).toBe(true);
    expect(
      isBooleanArgument(argument({}, { expectedType: BOOLEAN_TYPE as never })),
    ).toBe(true);
  });

  test("an untyped argument whose value is a literal", () => {
    expect(
      isBooleanArgument(argument({}, { value: Ast.parseExpression("True")! })),
    ).toBe(true);
  });

  test("not an argument, or another type", () => {
    expect(
      isBooleanArgument(WidgetInput.FromAst(Ast.parseExpression("True")!)),
    ).toBe(false);
    expect(
      isBooleanArgument(argument({ reprType: "Standard.Base.Data.Text.Text" })),
    ).toBe(false);
    expect(
      isBooleanArgument(argument({ tagValues: ["True", "False", "Nothing"] })),
    ).toBe(false);
  });
});

describe("booleanExpressionTags", () => {
  test("True then False, labelled by their code", () => {
    const db = {
      getEntryByProjectPath: () => undefined,
    } as unknown as Parameters<typeof booleanExpressionTags>[0];
    const tags = booleanExpressionTags(db);
    expect(tags.map((tag) => tag.expression)).toEqual(["True", "False"]);
    expect(tags.map((tag) => tag.label)).toEqual(["True", "False"]);
  });
});
```

(The `as unknown as` in the last test is a test stub of a database with no
entries, not a cast of a third-party API; root `CLAUDE.md`'s rule is about the
latter. `ExpressionTag.label` is the getter `useTagEntries` reads.)

- [ ] **Step 2: Run, expect FAIL** (module missing):
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetBoolean`

- [ ] **Step 3: Implement**

```ts
/**
 * @file Booleans in the graph editor: which inputs take one, the value a literal stands for, and
 * the dropdown's two entries. Framework-free, so it is unit-tested alone
 * (`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`, part B).
 */
import { requiredImportsByProjectPath } from "$/providers/openedProjects/module/imports";
import { WidgetInput } from "$/providers/openedProjects/widgetRegistry";
import { ExpressionTag } from "@/components/GraphEditor/widgets/WidgetSelection/tags";
import { Ast } from "@/util/ast";
import { ArgumentInfoKey } from "@/util/callTree";
import { ProjectPath } from "@/util/projectPath";
import type { QualifiedName } from "@/util/qualifiedName";

export const BOOLEAN_TYPE = "Standard.Base.Data.Boolean.Boolean";

const TRUE_CODES = new Set(["True", "Boolean.True", `${BOOLEAN_TYPE}.True`]);
const FALSE_CODES = new Set([
  "False",
  "Boolean.False",
  `${BOOLEAN_TYPE}.False`,
]);

export function booleanFromCode(code: string | undefined): boolean | undefined {
  const text = code?.trim();
  if (text == null) return undefined;
  if (TRUE_CODES.has(text)) return true;
  if (FALSE_CODES.has(text)) return false;
  return undefined;
}

export function booleanLiteral(
  value: WidgetInput["value"],
): boolean | undefined {
  if (!(value instanceof Ast.Ast)) return undefined;
  if (!(value instanceof Ast.Ident || value instanceof Ast.PropertyAccess))
    return undefined;
  return booleanFromCode(value.code());
}

function hasBooleanTags(tagValues: readonly string[] | null | undefined) {
  return (
    tagValues != null &&
    tagValues.length === 2 &&
    tagValues.includes("True") &&
    tagValues.includes("False")
  );
}

export function isBooleanArgument(input: WidgetInput): boolean {
  const info = input[ArgumentInfoKey]?.info;
  if (info == null) return false;
  return (
    hasBooleanTags(info.tagValues) ||
    info.reprType === BOOLEAN_TYPE ||
    input.expectedType === BOOLEAN_TYPE ||
    booleanLiteral(input.value) != null
  );
}

export function booleanExpressionTags(
  db: Parameters<typeof requiredImportsByProjectPath>[0],
): ExpressionTag[] {
  return (["True", "False"] as const).map(
    (name) =>
      new ExpressionTag(
        name,
        name,
        undefined,
        requiredImportsByProjectPath(
          db,
          ProjectPath.create(
            "Standard.Base" as QualifiedName,
            `Data.Boolean.Boolean.${name}` as QualifiedName,
          ),
          true,
        ),
      ),
  );
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean/booleanValue.ts app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean/__tests__/booleanValue.test.ts
git commit -m "GUI: which inputs are Booleans, and the True/False dropdown entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `WidgetSelection` draws the dropdown for every Boolean argument

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection.vue`
  (`expressionTags` ~line 91, `isHandledByCheckboxWidget` and `selectionScore`
  ~lines 235–255)
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/__tests__/booleanDropdown.test.ts`

**Interfaces:**

- Consumes: Task 1's `isBooleanArgument`, `booleanExpressionTags`.
- Produces: `hasDropdown(input)` (unchanged signature) is `true` for a Boolean
  argument without a dynamic configuration; its dropdown lists `True`, `False`
  and adds the constructor's import when one is picked.

- [ ] **Step 1: Write the failing test**

```ts
/** @file A Boolean argument gets the ordinary dropdown. */
import { WidgetInput } from "$/providers/openedProjects/widgetRegistry";
import { hasDropdown } from "@/components/GraphEditor/widgets/WidgetSelection.vue";
import { Ast } from "@/util/ast";
import { ArgumentInfoKey } from "@/util/callTree";
import { describe, expect, test } from "vitest";

const BOOLEAN = "Standard.Base.Data.Boolean.Boolean";
const argument = (
  info: { reprType?: string; tagValues?: string[] },
  extra: Partial<WidgetInput> = {},
): WidgetInput =>
  ({
    portId: "port" as WidgetInput["portId"],
    value: undefined,
    [ArgumentInfoKey]: {
      appKind: 0,
      info: {
        name: "keep",
        reprType: "Standard.Base.Any.Any",
        isSuspended: false,
        hasDefault: true,
        ...info,
      },
    },
    ...extra,
  }) as WidgetInput;

describe("a Boolean argument has a dropdown", () => {
  test("by its True/False tag values (the checkbox took these before)", () => {
    expect(hasDropdown(argument({ tagValues: ["True", "False"] }))).toBe(true);
  });

  test("by its type, without tag values", () => {
    expect(hasDropdown(argument({ reprType: BOOLEAN }))).toBe(true);
    expect(hasDropdown(argument({}, { expectedType: BOOLEAN as never }))).toBe(
      true,
    );
  });

  test("by a literal value of an untyped argument", () => {
    expect(
      hasDropdown(argument({}, { value: Ast.parseExpression("False")! })),
    ).toBe(true);
  });

  test("not while its dynamic configuration is pending", () => {
    expect(
      hasDropdown(
        argument(
          { reprType: BOOLEAN },
          { dynamicConfig: { kind: "Pending" } as never },
        ),
      ),
    ).toBe(false);
  });

  test("a literal that is not an argument has none", () => {
    expect(hasDropdown(WidgetInput.FromAst(Ast.parseExpression("True")!))).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (the tag-values case returns `false` today):
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetSelection/__tests__/booleanDropdown.test.ts`

- [ ] **Step 3: Implement**

In the `<script lang="ts">` block, delete `isHandledByCheckboxWidget` (and the
`arrayEquals` import if nothing else uses it), import `isBooleanArgument` from
`@/components/GraphEditor/widgets/WidgetBoolean/booleanValue`, and replace its
line in `selectionScore`:

```ts
    : input.dynamicConfig?.kind === 'Single_Choice' ? Score.Perfect
    : isBooleanArgument(input) && input.dynamicConfig == null ? Score.Perfect
```

In `<script setup>`, keep the `useExpressionTags` result under a new name and
put the Boolean tags in front of it:

```ts
const configuredTags = useExpressionTags({
  dynamicConfig: () => props.input.dynamicConfig,
  staticTags: () => props.input[ArgumentInfoKey]?.info?.tagValues,
  suggestionDb: () => suggestionDbStore.value.entries,
  projectNames,
  libraryPublicTypes: () => suggestionDbStore.value.libraryPublicTypes,
});
/** A Boolean argument lists `True` and `False` with their imports, whatever its tag values say. */
const expressionTags = computed(() =>
  isBooleanArgument(props.input) && props.input.dynamicConfig == null
    ? booleanExpressionTags(suggestionDbStore.value.entries)
    : configuredTags.value,
);
```

Every later use of `expressionTags.value` stays as it is (it was a `ComputedRef`
already). Import `booleanExpressionTags` with `isBooleanArgument`.

- [ ] **Step 4: Run, expect PASS**; then the folder's other tests
      (`corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetSelection`)
      and the date/time score tests, which call `hasDropdown`
      (`corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetDate src/project-view/components/GraphEditor/widgets/WidgetTimeOfDay`).
      Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/__tests__/booleanDropdown.test.ts
git commit -m "GUI: Boolean arguments get the ordinary True/False dropdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `WidgetBoolean` replaces `WidgetCheckbox`

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean.vue`
- Delete:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetCheckbox.vue`
- Modify: `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean/__tests__/widgetBoolean.score.test.ts`

**Interfaces:**

- Consumes: Task 1's `booleanLiteral`, `booleanFromCode`, `isBooleanArgument`.
- Produces: `widgetDefinition` (priority 101) and the root class
  `.WidgetBoolean`, the checkbox `.WidgetBoolean .Checkbox` (from
  `@/components/widgets/CheckboxWidget.vue`) and the greyed default
  `.WidgetBoolean .defaultValue`, which Task 4's Playwright test locates.

- [ ] **Step 1: Write the failing score test** (copy the helpers of
      `WidgetTimeOfDay/__tests__/widgetTimeOfDay.score.test.ts`):

```ts
/** @file Which inputs the Boolean widget takes, and where it ranks. */
import type { GraphDb } from "$/providers/openedProjects/graph/graphDatabase";
import {
  Score,
  WidgetInput,
  type WidgetProps,
} from "$/providers/openedProjects/widgetRegistry";
import { widgetDefinition as argumentNameWidget } from "@/components/GraphEditor/widgets/WidgetArgumentName.vue";
import { widgetDefinition as booleanWidget } from "@/components/GraphEditor/widgets/WidgetBoolean.vue";
import { widgetDefinition as selectionWidget } from "@/components/GraphEditor/widgets/WidgetSelection.vue";
import { Ast } from "@/util/ast";
import { ArgumentInfoKey } from "@/util/callTree";
import { describe, expect, test } from "vitest";
import { BOOLEAN_TYPE } from "../booleanValue";

function score(input: WidgetInput): Score {
  return booleanWidget.score(
    { input } as WidgetProps<WidgetInput>,
    {} as GraphDb,
  );
}
const placeholder = (extra: Partial<WidgetInput> = {}): WidgetInput => ({
  portId: "port" as WidgetInput["portId"],
  value: undefined,
  ...extra,
});
const booleanArgument = {
  [ArgumentInfoKey]: {
    appKind: 0,
    info: {
      name: "keep",
      reprType: BOOLEAN_TYPE,
      isSuspended: false,
      hasDefault: true,
      defaultValue: "False",
    },
  },
} as Partial<WidgetInput>;

describe("the Boolean widget scores", () => {
  test("a literal Perfect, an argument or not", () => {
    expect(score(WidgetInput.FromAst(Ast.parseExpression("True")!))).toBe(
      Score.Perfect,
    );
    expect(
      score(WidgetInput.FromAst(Ast.parseExpression("Boolean.False")!)),
    ).toBe(Score.Perfect);
    expect(
      score({
        ...WidgetInput.FromAst(Ast.parseExpression("True")!),
        ...booleanArgument,
      }),
    ).toBe(Score.Perfect);
  });

  test("an unset Boolean argument Perfect", () => {
    expect(score(placeholder(booleanArgument))).toBe(Score.Perfect);
  });

  test("a Boolean argument whose value is not a literal Mismatch, so it has no checkbox", () => {
    expect(
      score({
        ...WidgetInput.FromAst(Ast.parseExpression("a > b")!),
        ...booleanArgument,
      }),
    ).toBe(Score.Mismatch);
  });

  test("an unset argument of another type Mismatch", () => {
    expect(score(placeholder())).toBe(Score.Mismatch);
  });

  test("ranks after the dropdown and the argument name, so it is drawn inside both", () => {
    expect(booleanWidget.priority).toBeGreaterThan(selectionWidget.priority);
    expect(booleanWidget.priority).toBeGreaterThan(argumentNameWidget.priority);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing):
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets/WidgetBoolean`

- [ ] **Step 3: Implement `WidgetBoolean.vue`**

```vue
<script setup lang="ts">
/**
 * @file A Boolean value: a checkbox that flips it, and its code (or, unset, its default greyed).
 * The ▾ under it is `WidgetSelection`'s, which lists `True` and `False` for a Boolean argument;
 * this widget is drawn inside it, after the argument's name.
 */
import { useCurrentProject } from "$/components/WithCurrentProject.vue";
import { requiredImportsByProjectPath } from "$/providers/openedProjects/module/imports";
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from "$/providers/openedProjects/widgetRegistry";
import NodeWidget from "@/components/GraphEditor/NodeWidget.vue";
import {
  booleanFromCode,
  booleanLiteral,
  isBooleanArgument,
} from "@/components/GraphEditor/widgets/WidgetBoolean/booleanValue";
import CheckboxWidget from "@/components/widgets/CheckboxWidget.vue";
import { assert } from "@/util/assert";
import { Ast } from "@/util/ast";
import { ProjectPath } from "@/util/projectPath";
import type { Identifier, QualifiedName } from "@/util/qualifiedName";
import { computed } from "vue";

const props = defineProps(widgetProps(widgetDefinition));
const { suggestionDb, module } = useCurrentProject();

const isUnset = computed(() => WidgetInput.isPlaceholder(props.input));
/** The default's code, shown greyed while the argument is unset. */
const defaultCode = computed(() =>
  isUnset.value ? WidgetInput.valueRepr(props.input) : undefined,
);

function constructorImport(value: boolean) {
  return requiredImportsByProjectPath(
    suggestionDb.value.entries,
    ProjectPath.create(
      "Standard.Base" as QualifiedName,
      `Data.Boolean.Boolean.${value ? "True" : "False"}` as QualifiedName,
    ),
    true,
  );
}

const checked = computed({
  get: () =>
    booleanLiteral(props.input.value) ??
    booleanFromCode(defaultCode.value) ??
    false,
  set(value: boolean) {
    module.value.edit((edit) => {
      const name = (value ? "True" : "False") as Identifier;
      const current = props.input.value;
      if (current instanceof Ast.Ast) {
        // `Boolean.True` keeps its type prefix and needs no import; a bare `True` may.
        const target = edit.getVersion(current);
        if (target instanceof Ast.MutablePropertyAccess) target.setRhs(name);
        else {
          assert(target instanceof Ast.MutableIdent);
          target.setToken(name);
          module.value.addMissingImports(edit, constructorImport(value));
        }
        return props.updateCallback({ edit, directInteraction: true });
      }
      module.value.addMissingImports(edit, constructorImport(value));
      return props.updateCallback({
        edit,
        portUpdate: { value: name, origin: props.input.portId },
        directInteraction: true,
      });
    });
  },
});
</script>

<script lang="ts">
/**
 * A `True`/`False` literal, anywhere, or an unset Boolean argument: priority 101, after
 * `WidgetSelection` (50) and `WidgetArgumentName` (100), so it is drawn inside the dropdown and
 * after the name. Any other value of a Boolean argument (an expression, a reference) is left to the
 * widgets that draw it, and so has no checkbox.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  {
    priority: 101,
    score: (props) => {
      if (WidgetInput.isPlaceholder(props.input))
        return isBooleanArgument(props.input) ? Score.Perfect : Score.Mismatch;
      return booleanLiteral(props.input.value) != null
        ? Score.Perfect
        : Score.Mismatch;
    },
  },
  import.meta.hot,
);
</script>

<template>
  <div class="WidgetBoolean widgetParent">
    <CheckboxWidget
      v-model="checked"
      class="widgetRounded"
      contenteditable="false"
      @pointerdown.stop
    />
    <span
      v-if="isUnset"
      class="defaultValue widgetApplyPadding"
      v-text="defaultCode"
    />
    <NodeWidget v-else :input="props.input" />
  </div>
</template>

<style scoped>
.WidgetBoolean {
  gap: var(--widget-token-pad-unit);
  align-items: center;
}

.defaultValue {
  opacity: 0.5;
}
</style>
```

Notes for the implementer:

- `CheckboxWidget`'s own `@click.stop` keeps a checkbox click from reaching
  `WidgetSelection`'s `@click.stop="toggleDropdownWidget"`, so the checkbox
  flips without opening the list. `@pointerdown.stop` keeps it from starting a
  node drag. Check both in Task 4's Playwright test.
- `<NodeWidget :input="props.input" />` re-runs the registry with this widget in
  `alreadyUsed`, so the literal is drawn by the token/identifier widget as code
  (`True`, `Boolean.True`).
- Delete `WidgetCheckbox.vue` (`git rm`). Search for any remaining reference
  (`grep -rn "WidgetCheckbox" app/gui/src app/gui/integration-test`); the
  widgets are discovered by the glob in
  `app/gui/src/project-view/components/widgets/index.ts`
  (`import.meta.glob('@/components/GraphEditor/widgets/*.vue')`), so nothing
  lists it by name and the new `WidgetBoolean.vue` is picked up the same way.
- The `ArgumentNameShownKey` handling of the old widget (it drew the name
  itself) is gone: the name is now `WidgetArgumentName`'s, which runs first.

- [ ] **Step 4: Docs.** In `widgets/CLAUDE.md`'s "File layout", add after the
      `WidgetTimeOfDay.vue` entry:

```markdown
- `WidgetBoolean.vue` — a Boolean: a checkbox that flips it, then its code (an
  unset argument's default greyed), drawn after the argument name (priority
  101). The ▾ is `WidgetSelection`'s: it lists `True` and `False`, with their
  imports, for every Boolean argument (`WidgetBoolean/booleanValue.ts`'s
  `isBooleanArgument`: `True`/`False` tag values, a `Boolean` type, or a literal
  value) that has no `@` dropdown of its own. A value that is not a literal is
  left to the other widgets, so it has no checkbox; a literal that is not an
  argument (a whole node, an operand) has the checkbox and no ▾. It replaced
  `WidgetCheckbox`.
```

- [ ] **Step 5: Run the score test, the folder, typecheck and lint.**
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/widgets`,
      `corepack pnpm run typecheck`,
      `corepack pnpm exec eslint src/project-view/components/GraphEditor/widgets/WidgetBoolean.vue src/project-view/components/GraphEditor/widgets/WidgetBoolean src/project-view/components/GraphEditor/widgets/WidgetSelection.vue`.
      Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetBoolean/__tests__/widgetBoolean.score.test.ts app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md
git rm app/gui/src/project-view/components/GraphEditor/widgets/WidgetCheckbox.vue
git commit -m "GUI: a Boolean shows a checkbox and its value, with the dropdown under it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Playwright, changelog, verification, screenshots, PR

**Files:**

- Modify: `app/gui/integration-test/project-view/widgets.spec.ts` (a new
  `test.describe('Boolean widget', …)` after the `Time_Of_Day widget` block)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Playwright.** Copy the `Time_Of_Day widget` block's structure
      (`setMockMainFile` in `test.use`, `restoreMockMainFile` after each,
      `mockSuggestion` of a static method on `Standard.Base.Data`,
      `mockMethodCallInfo`, and its `moduleCode` helper):

```ts
test.describe("Boolean widget", () => {
  const BOOLEAN_TYPE = "Standard.Base.Data.Boolean.Boolean";
  test.afterEach(restoreMockMainFile);
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          "from Standard.Base import Data\n\nmain =\n    kept = Data.keep_rows True\n    unset = Data.keep_rows\n    computed = Data.keep_rows (1 > 2)\n    flag = True\n",
        ),
    },
  });

  /** `Data.keep_rows` takes one Boolean argument, `keep`, defaulting to `False`. */
  async function booleanNode(
    editorPage: EditorPageActions,
    page: Page,
    binding: "kept" | "unset" | "computed",
  ) {
    await editorPage.mockSuggestion({
      type: "method",
      module: "Standard.Base.Data",
      name: "keep_rows",
      arguments: [
        {
          name: "keep",
          reprType: BOOLEAN_TYPE,
          isSuspended: false,
          hasDefault: true,
          defaultValue: "False",
          tagValues: ["True", "False"],
        },
      ],
      selfType: "Standard.Base.Data",
      returnType: "Standard.Base.Data.Numbers.Integer",
      isStatic: true,
      annotations: [],
    });
    await mockMethodCallInfo(page, binding, {
      methodPointer: {
        module: "Standard.Base.Data",
        definedOnType: "Standard.Base.Data",
        name: "keep_rows",
      },
      notAppliedArguments: binding === "unset" ? [0] : [],
    });
    const node = locate.graphNodeByBinding(page, binding);
    const widget = node.locator(".WidgetBoolean");
    return { node, widget, checkbox: widget.locator(".Checkbox") };
  }

  test("a set argument shows the checkbox and its code, and the checkbox flips it both ways", async ({
    editorPage,
    page,
  }) => {
    const { widget, checkbox } = await booleanNode(editorPage, page, "kept");
    await expect(widget).toHaveCount(1);
    await expect(widget).toContainText("True");
    await checkbox.click();
    await expect(widget).toContainText("False");
    expect(await moduleCode(page)).toContain("kept = Data.keep_rows False\n");
    await checkbox.click();
    await expect(widget).toContainText("True");
    expect(await moduleCode(page)).toContain("kept = Data.keep_rows True\n");
    // The checkbox does not open the list.
    await expect(page.locator(".DropdownWidget")).toBeHidden();
  });

  test("the arrow lists True and False only, and a pick writes it", async ({
    editorPage,
    page,
  }) => {
    const { node } = await booleanNode(editorPage, page, "kept");
    const dropDown = new DropDownLocator(node);
    await dropDown.clickWidget();
    await dropDown.expectVisibleWithOptions(["True", "False"]);
    await dropDown.clickOption("False");
    await dropDown.expectNotVisible();
    expect(await moduleCode(page)).toContain("kept = Data.keep_rows False\n");
  });

  test("an unset argument shows its default greyed, and the checkbox writes the flipped value", async ({
    editorPage,
    page,
  }) => {
    const { widget, checkbox } = await booleanNode(editorPage, page, "unset");
    await expect(widget).toHaveCount(1);
    await expect(widget.locator(".defaultValue")).toHaveText("False");
    await checkbox.click();
    await expect(widget.locator(".defaultValue")).toHaveCount(0);
    expect(await moduleCode(page)).toMatch(
      /unset = Data\.keep_rows (keep=)?True\n/,
    );
  });

  test("an expression value has no checkbox, and keeps the arrow", async ({
    editorPage,
    page,
  }) => {
    const { node } = await booleanNode(editorPage, page, "computed");
    await expect(node.locator(".WidgetBoolean")).toHaveCount(0);
    await expect(node.locator(".WidgetSelection")).toHaveCount(1);
  });

  test("a whole True node has the checkbox and no arrow", async ({ page }) => {
    const node = locate.graphNodeByBinding(page, "flag");
    const widget = node.locator(".WidgetBoolean");
    await expect(widget).toHaveCount(1);
    await expect(node.locator(".WidgetSelection")).toHaveCount(0);
    await widget.locator(".Checkbox").click();
    expect(await moduleCode(page)).toContain("flag = False\n");
  });
});
```

`moduleCode` is defined inside the Date and Time describe blocks; lift one copy
to the file's top level (next to `DropDownLocator`) and use it from all three
blocks, rather than writing a fourth copy.

Run from `app/gui`:
`corepack pnpm exec playwright test integration-test/project-view/widgets.spec.ts`,
three times (timing-sensitive suite, root `CLAUDE.md`). Expected: all pass every
time, the Date and Time blocks included.

- [ ] **Step 2: Changelog** under `# Next Release` → `#### Enso IDE`:

```
- [A Boolean argument shows its value next to the checkbox, and a dropdown
  under it to choose True or False.][NNN]
```

with a link definition `[NNN]: https://github.com/jdunkerley/enso/pull/NNN`;
`NNN` is replaced with the PR number after opening.

- [ ] **Step 3: Verify everything:** the GUI's full Vitest
      (`corepack pnpm exec vitest run`) once; typecheck; lint on the changed
      files; the Playwright spec three times; and on Linux (WSL, sourcing
      `~/.enso-toolchain.sh`, per root `CLAUDE.md`) the widget unit tests and
      `prettier --check` of the changed files. Also open the IDE (`run` skill)
      on a project with a `Table.sort` or `Text.contains` node
      (`case_sensitivity`/`keep` style arguments) and check one real Boolean
      argument by eye.

- [ ] **Step 4: Screenshots** (standing rule): before/after images of a node
      with a Boolean argument (set, unset, and the list open), pushed to the
      orphan `pr-screenshots` branch and linked in the PR.

- [ ] **Step 5: Commit and open the PR**

```bash
git add app/gui/integration-test/project-view/widgets.spec.ts CHANGELOG.md
git commit -m "GUI: Playwright and changelog for the Boolean widget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin <branch>
```

Open the PR against `develop`, title "Boolean widget: a checkbox, its value, and
a True/False dropdown"; body: what changed, the spec link, tests run where,
screenshots, ending with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Replace `NNN`
in `CHANGELOG.md` and push. Build installers (IDE Packaging dispatch,
`macos=true`) for the owner's test; merge only after the owner's OK.

---

## Self-review

- **Spec coverage (part B):** `[☑] True ▾` — Tasks 2 (▾) and 3 (checkbox, code);
  checkbox flips — Task 3, Playwright test 1; ▾ opens `True`/`False` — Task 2,
  Playwright test 2; unset shows default greyed and both controls write — Task
  3, Playwright test 3 (the ▾ path writes through `WidgetSelection`'s ordinary
  placeholder update); connected / non-literal has no checkbox — Task 3's score,
  Playwright test 4; replaces `WidgetCheckbox` everywhere — Task 3 deletes it
  and takes every input it took (literals anywhere, Boolean arguments). Unit and
  Playwright tests — Tasks 1–4.
- **Placeholders:** none.
- **Names:** `BOOLEAN_TYPE`, `booleanFromCode`, `booleanLiteral`,
  `isBooleanArgument`, `booleanExpressionTags` (Task 1) are the names Tasks 2–3
  import; `.WidgetBoolean`, `.Checkbox`, `.defaultValue` (Task 3) are the ones
  Task 4 locates.
