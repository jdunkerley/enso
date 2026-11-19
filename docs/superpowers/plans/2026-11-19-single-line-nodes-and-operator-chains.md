# Single-line nodes and operator chains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every node stays one 32px line, and operator chains draw as flat rows
with tinted capsules where the precedence changes.

**Architecture:** The parser answers "what is this operator's precedence and
associativity" through a new WASM query. A pure function `chainRole(oprApp)`
classifies every infix level as `root`, `continue` or `capsule`. The existing
per-level widgets (`WidgetFunction`, `WidgetApplication`, `WidgetGroup`,
`WidgetArgumentName`) read that role and change only how they draw: no outline
for infix levels, a capsule class, no parentheses around a capsule, no name
chips on operands.

**Tech Stack:** Rust (parser, wasm-bindgen), TypeScript, Vue 3 SFCs, Vitest,
Playwright.

**Spec:**
`docs/superpowers/specs/2026-11-19-single-line-nodes-and-operator-chains-design.md`

## Global Constraints

- Every widget that only groups others is exactly `--node-port-height` (24px);
  no vertical padding, margin or border on it. Outlines are
  `box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 30%, transparent)`.
- Capsule: `height: var(--node-port-height)`, `padding: 0 3px`,
  `border-radius: var(--node-port-border-radius)`,
  `background: rgb(0 0 0 / 0.2)`, `gap: 4px`.
- Operators are drawn as written in the code; no glyph substitution.
- One rule: same precedence (and same spacing, same associativity side, not
  parenthesised) flattens; anything else under an operator is a capsule.
- CHANGELOG entry under `#### Enso IDE`; PR waits for the owner's installer
  test.

---

### Task 1: Parser query `binary_operator_info`

**Files:**

- Modify: `lib/rust/parser/src/queries.rs` (new function + tests)
- Modify: `app/rust-ffi/src/lib.rs` (export)
- Modify: `app/ydoc-shared/src/ast/ffi.ts` (re-export)
- Modify: `app/ydoc-inspect/src/ffiStub.ts` (stub)
- Modify: `app/ydoc-shared/src/ast/token.ts` (typed wrapper)

**Interfaces:**

- Produces (Rust): `pub fn binary_operator_info(code: &str) -> u32` — 0 when
  `code` is not exactly one `Operator` token with a binary infix precedence;
  otherwise `precedence.into_u8() as u32 | (right_assoc as u32) << 8`.
- Produces (TS, `ydoc-shared/src/ast/token.ts`):
  `export function binaryOperatorInfo(code: string): { precedence: number; rightAssociative: boolean } | undefined`

- [ ] **Step 1: Failing Rust tests** in `queries.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::syntax::token::Precedence;

    fn info(code: &str) -> Option<(u8, bool)> {
        match binary_operator_info(code) {
            0 => None,
            v => Some(((v & 0xff) as u8, v & 0x100 != 0)),
        }
    }

    #[test]
    fn binary_operator_info_classes() {
        assert_eq!(info("+"), Some((Precedence::Addition.into_u8(), false)));
        assert_eq!(info("-"), Some((Precedence::Addition.into_u8(), false)));
        assert_eq!(info("*"), Some((Precedence::Multiplication.into_u8(), false)));
        assert_eq!(info("&&"), Some((Precedence::Logical.into_u8(), false)));
        assert_eq!(info("=="), Some((Precedence::Equality.into_u8(), false)));
        assert_eq!(info(">"), Some((Precedence::Inequality.into_u8(), false)));
        assert_eq!(info("<|"), Some((Precedence::Functional.into_u8(), true)));
        assert_eq!(info("^"), Some((Precedence::Exponentiation.into_u8(), false)));
    }

    #[test]
    fn binary_operator_info_rejects_non_operators() {
        for code in ["", "a", ".", "=", "->", ",", ":", "..", "+ +", "1"] {
            assert_eq!(binary_operator_info(code), 0, "{code:?}");
        }
    }
}
```

- [ ] **Step 2:** `cargo test -p enso-parser binary_operator_info` → FAIL
      (function missing).
- [ ] **Step 3: Implement** after `is_ident_or_operator`:

```rust
/// The binary infix precedence and associativity of a single operator token.
///
/// Returns 0 if the input is not exactly one (non-syntactic) operator with a binary infix
/// precedence. Otherwise bits 0-7 hold [`token::Precedence::into_u8`] and bit 8 is set for a
/// right-associative operator. The GUI uses it to draw operator chains (see
/// `app/gui/src/project-view/util/operatorChain.ts`).
pub fn binary_operator_info(code: &str) -> u32 {
    let parsed = crate::lexer::run(code);
    if parsed.internal_error.is_some() {
        return 0;
    }
    let [token] = &parsed.value[..] else { return 0 };
    if !matches!(token.variant, token::Variant::Operator(_)) {
        return 0;
    }
    let Some(props) = token.operator_properties() else { return 0 };
    let Some(precedence) = props.binary_infix_precedence() else { return 0 };
    let right = props.associativity() == token::Associativity::Right;
    precedence.into_u8() as u32 | (right as u32) << 8
}
```

(Adjust the `Associativity`/`Precedence` paths to what `token` re-exports;
`syntax/token.rs` has `pub use operator::Precedence`.)

- [ ] **Step 4:** tests PASS; `cargo fmt -- --check`.
- [ ] **Step 5: Export.** `app/rust-ffi/src/lib.rs`:

```rust
/// See [`queries::binary_operator_info`].
#[wasm_bindgen]
pub fn binary_operator_info(code: &str) -> u32 {
    queries::binary_operator_info(code)
}
```

Add `binary_operator_info` to the import and export lists in
`ydoc-shared/src/ast/ffi.ts`, and
`export const binary_operator_info = notAvailable as never` in
`ydoc-inspect/src/ffiStub.ts`. In `token.ts`:

```ts
/** An operator's binary precedence (higher binds tighter) and associativity, from the parser. */
export function binaryOperatorInfo(
  code: string,
): { precedence: number; rightAssociative: boolean } | undefined {
  const info = binary_operator_info(code);
  return info === 0
    ? undefined
    : { precedence: info & 0xff, rightAssociative: (info & 0x100) !== 0 };
}
```

Export it wherever `isOperator` is re-exported from the `Ast` barrel.

- [ ] **Step 6:** rebuild WASM (`corepack pnpm -r compile` rebuilds
      `app/rust-ffi`), `corepack pnpm -C app/ydoc-shared exec tsc --noEmit`.
- [ ] **Step 7: Commit**
      `Parser: a query for an operator's precedence and     associativity`.

### Task 2: `chainRole`

**Files:**

- Create: `app/gui/src/project-view/util/operatorChain.ts`
- Test: `app/gui/src/project-view/util/__tests__/operatorChain.test.ts`

**Interfaces:**

- Consumes: `Ast.binaryOperatorInfo` (Task 1).
- Produces: `export type ChainRole = 'root' | 'continue' | 'capsule'` and
  `export function chainRole(app: Ast.OprApp): ChainRole`, and
  `export function isCapsuledGroup(group: Ast.Group): boolean` (a `Group` whose
  expression is an `OprApp` with role `capsule`).

Rules (spec, "A change of precedence is a capsule"):

1. Find the enclosing operator: `p = app.parent()`; if `p` is a `Group`,
   remember `parenthesised = true` and step to `p.parent()`.
2. If that is not an `OprApp` (or either operator has no `binaryOperatorInfo`),
   return `'root'`.
3. `'continue'` iff not parenthesised, same `precedence`, same
   `rightAssociative`, `app` is the parent's associating side (`lhs` for left,
   `rhs` for right), and `isSpaced(app) === isSpaced(parent)`.
4. Otherwise `'capsule'`.

`isSpaced(app)`: the operator token's preceding whitespace is non-empty
(`app.fields.get('operators')[0]?.whitespace`, as `WidgetApplication`'s
`operatorStyle` reads it).

- [ ] **Step 1: Failing tests** — parse each with `Ast.parseExpression` and find
      the `OprApp` by its code:

```ts
import { Ast } from "@/util/ast";
import { expect, test } from "vitest";
import { chainRole } from "../operatorChain";

function roleOf(code: string, sub: string) {
  const root = Ast.parseExpression(code)!;
  let found: Ast.OprApp | undefined;
  root.visitRecursive((ast) => {
    if (ast instanceof Ast.OprApp && ast.code() === sub) found = ast;
    return true;
  });
  expect(found, sub).toBeDefined();
  return chainRole(found!);
}

test.each([
  ["a + b + c", "a + b + c", "root"],
  ["a + b + c", "a + b", "continue"],
  ["a + b - c", "a + b", "continue"],
  ["a * b + c", "a * b", "capsule"],
  ["a + b * c", "b * c", "capsule"],
  ["a > 0 && b == 1", "a > 0", "capsule"],
  ["a > 0 && b == 1", "b == 1", "capsule"],
  ["(a + b) + c", "a + b", "capsule"],
  ["a + (b + c)", "b + c", "capsule"],
  ["a+b * c", "a+b", "capsule"],
  ["f <| g <| x", "g <| x", "continue"],
  ["x.foo (a + b)", "a + b", "root"],
])("%s: %s is %s", (code, sub, role) => {
  expect(roleOf(code, sub)).toBe(role);
});
```

(If `parseExpression`/`visitRecursive` are named differently, use the helpers
the neighbouring `util/__tests__/callTree.test.ts` uses.)

- [ ] **Step 2:**
      `corepack pnpm -C app/gui exec vitest run src/project-view/util/__tests__/operatorChain.test.ts`
      → FAIL.
- [ ] **Step 3: Implement** the rules above (~40 lines, a doc comment per
      export).
- [ ] **Step 4:** tests PASS.
- [ ] **Step 5: Commit** `Graph: classify each operator level of a chain`.

### Task 3: Widgets draw the roles

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction.vue`
  (`nested`, `.nestedCall` style)
- Modify: `.../widgets/WidgetApplication.vue` (capsule class)
- Modify: `.../widgets/WidgetGroup.vue` (no parens around a capsule)
- Modify: `.../widgets/WidgetArgumentName.vue` (no infix name chips)
- Modify: `.../widgets/CLAUDE.md` ("Argument access")
- Test: existing unit tests touching these (`hiddenParameters.test.ts`, widget
  unit tests) keep passing.

**Interfaces:** consumes `chainRole`, `isCapsuledGroup` (Task 2).

- [ ] **Step 1: `WidgetFunction.vue`.**

```ts
const nested = computed(
  () =>
    parentCall != null &&
    application.value instanceof ArgumentApplication &&
    (!(application.value.appTree instanceof Ast.OprApp) ||
      hidden.value.length > 0),
);
```

(Use the field `ArgumentApplication` exposes for its AST; `FromInterpretedInfix`
receives `interpreted.appTree`.) Style:

```css
.nestedCall {
  gap: var(--widget-token-pad-unit);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 30%, transparent);
  border-radius: var(--node-port-border-radius);
}
```

- [ ] **Step 2: `WidgetApplication.vue`.** For an infix application whose
      `chainRole` is `'capsule'`, add class `operatorCapsule` to the root
      (`appClass`), and a `data-chain-role` attribute for tests. Style:

```css
.WidgetApplication.operatorCapsule {
  height: var(--node-port-height);
  padding: 0 3px;
  gap: 4px;
  align-items: center;
  border-radius: var(--node-port-border-radius);
  background: rgb(0 0 0 / 0.2);
}
```

Add `widgetRounded` with it, so tokens at its ends get the token padding from
the tree's propagation (`WidgetTreeRoot.vue`).

- [ ] **Step 3: `WidgetGroup.vue`.**
      `displayParenthesis = nesting >= 2 && !isCapsuledGroup(group)`.
- [ ] **Step 4: `WidgetArgumentName.vue`.** `showsArgumentName`: return
      `appKind === ApplicationKind.Prefix` for non-placeholders; delete
      `UNINFORMATIVE_OPERAND_NAMES` and update the doc comment.
- [ ] **Step 5:** `corepack pnpm -C app/gui exec vitest run` (widget and
      callTree tests) and `corepack pnpm -C app/gui run typecheck`; fix
      expectations that asserted infix name chips (they encode the dropped
      rule).
- [ ] **Step 6:** Update `widgets/CLAUDE.md` "Argument access": outline drawn
      with inset box-shadow; prefix calls only (infix only with hidden
      parameters); operator chain roles and capsules (`util/operatorChain.ts`);
      no name chips on infix operands.
- [ ] **Step 7: Commit**
      `Graph: operator chains are flat rows with capsules,     and nodes stay one line`.

### Task 4: Integration tests, screenshots, changelog

**Files:**

- Modify: `app/gui/integration-test/project-view/widgets.spec.ts` (or a new
  `operatorChains.spec.ts` beside it, with the mock main file set as
  `argumentAccess.spec.ts` does with `setMockMainFile`)
- Modify: `CHANGELOG.md`
- Modify: integration tests that asserted infix name chips
  (`argumentAccess.spec.ts` `Date.+ amount`, if present)

- [ ] **Step 1: Failing test** with main file:

```
main =
    latitude = 51.5
    longitude = 0.12
    url = '…?latitude=' + latitude.to_text + '&longitude=' + longitude.to_text
    total = 2 * 3 + 4 * (5 - 1)
```

Assert for each node: `boundingBox().height` equals the node height of a plain
node (`latitude`), within 0.5px; `url` has no `.nestedCall`, no
`.WidgetArgumentName`, no `.operatorCapsule`; `total` has exactly 3
`.operatorCapsule`, each 24px high, and shows no `(`/`)` token. Plus a nested
prefix call node from the existing mocks (`data.filter` style) whose
`.nestedCall` is 24px.

- [ ] **Step 2:** run it on develop's code path → FAIL (before Task 3) / PASS
      after. Run the spec 3× with `--workers=2` on Windows, and once in WSL
      Ubuntu-24.04 (`~/enso` clone, source `~/.enso-toolchain.sh`).
- [ ] **Step 3:** full
      `corepack pnpm -C app/gui exec playwright test     integration-test/project-view/`
      once; investigate any new failure against develop's rate before blaming
      the change.
- [ ] **Step 4: CHANGELOG** under `# Next Release` → `#### Enso IDE`:
      `- [Operator chains read as one row, a change of precedence is shaded,     and nodes stay one line high][NNN]`
      with the link definition.
- [ ] **Step 5:** before/after screenshots of the URL and `total` nodes, pushed
      to the orphan `pr-screenshots` branch and embedded in the PR body.
- [ ] **Step 6: Commit**, push, open the PR (`Closes` nothing unless a ticket
      exists), link it, wait for green and the owner's installer test.
