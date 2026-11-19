# Single-line nodes and operator chains

Status: design for review. Agreed with the owner on 2026-11-19 from a mock-up
(the conversation's `chains-mock.html`); multi-line nodes are a later epic.

## Why

Since #850 a call nested in another call's argument is an outlined group
(`.nestedCall` in `WidgetFunction.vue`), so that its ＋ visibly belongs to it.
Two things are wrong with that:

1. **Nodes grow taller with depth.** The outline is a 1px `border`, which takes
   layout space: every level adds 2px. A node is meant to be one 32px line
   (`--node-base-height`) holding 24px widgets (`--node-port-height`).
2. **Operator chains read badly.** Every infix operator is a call, and a chain
   is left-nested: `a + b + c + d` is `((a + b) + c) + d`, three outlined groups
   sharing a left edge. The URL node
   `'…?latitude=' + latitude.to_text + '&longitude=' + longitude.to_text` shows
   a stack of lines down its left side and is several pixels taller than a plain
   node. Operands can also show a parameter-name chip (`WidgetArgumentName`
   shows an infix operand's name unless it is `self`, `that`, `lhs` or `rhs`),
   so a chain shows a name like a left variable's in the middle of the
   expression.

## What the user sees

### Every node stays on one line

Every group, chip, capsule and port is exactly `--node-port-height` (24px) at
any depth, and every node is `--node-base-height` (32px), unless a widget is
deliberately taller (table editor, vector editor: `.widgetExpanded`). Nothing
that only groups other widgets may add height: outlines are drawn with
`box-shadow: inset 0 0 0 1px …`, never `border`, and groups are padded only left
and right.

### A chain is one flat row

A run of operators with the **same precedence**, read in the direction they
associate, is drawn as one level: operand, operator, operand, operator, … with
no outline around any part of it. `a + b - c`, `x && y && z` and the URL example
are each one flat row.

- **Operators are drawn as written in the code** (`*`, `-`, `&&`, `==`), in the
  code font, dimmed like today's `.infixOp`. No `×` or `−` glyphs: the node
  shows real code.
- **Operands never show a name chip.** No parameter name is shown for any
  operand of an operator, informative or not (this drops #850's rule for infix
  operands, such as `amount` on `Date.+`; prefix arguments keep their chips).
- **Each operand keeps its port**, so it still takes an edge, opens its widget
  and pops out. What is lost: the intermediate sub-expression (`a + b` inside
  `a + b + c`) is no longer a port of its own. It never was a meaningful drop
  target, and with no visible box there is nothing to aim at.

### A change of precedence is a capsule

The chain at node level is the one whose operator binds loosest (it is the root
of the expression). An operand that is itself an operator chain of a **different
precedence** becomes a **capsule**: a darker tint (`rgb(0 0 0 / 0.2)` over
whatever is behind it, so depth reads as darker), 24px high, rounded like a
port, padded 3px left and right, with no border.

- `price * qty + tax * (rate - 1)`: `+` at node level; `price * qty` and
  `tax * (rate - 1)` are capsules; `rate - 1` is a capsule inside the second.
- `a > 0 && b == 'x'`: `&&` at node level; `a > 0` and `b == 'x'` are capsules.
- **One rule, no exceptions:** same precedence flattens; a different precedence
  is a capsule. Comparisons under `&&` are not special-cased.
- **Parentheses are not drawn.** A parenthesised chain is a capsule whatever its
  precedence (`(a + b) + c` capsules `a + b`), since the author grouped it.
  Today's `WidgetGroup` already handles `Group`; it gets the capsule style when
  its content is an operator chain.
- Enso's precedence is also space-sensitive (`a+b * c` is `(a+b) * c`): a tight
  sub-chain under a spaced one is a capsule even when the operators match.

### Prefix calls keep their group

A prefix call nested in another call's argument (`..Contains (substring='lon')`
inside `data.filter`) keeps its outline, so that its ＋ belongs to it, drawn
with the inset `box-shadow`. An operator call gets the outline only if it has
hidden parameters (it then has a ＋ to own); otherwise it is a chain level or a
capsule.

### What does not change

Property access (`latitude.to_text`, `data.filter`) is not an operator chain
here: it keeps `WidgetSelfAccessChain`. Text literals, number inputs,
the ＋ menu and argument chips for prefix calls are as today. The node's shape,
colours and icon are unchanged.

## How it is built

### Precedence comes from the parser

The Rust parser is the source of truth for operator precedence
(`analyze_non_syntactic_operator` / `analyze_user_operator` in
`lib/rust/parser/src/lexer.rs`). Duplicating that table in TypeScript would
drift. Add `queries::binary_operator_precedence(token: &str) -> u32` (0 for a
token that is not a binary value operator) next to `is_ident_or_operator`, and
export it from `app/rust-ffi` the same way. A Rust unit test covers each class
of the table; the GUI imports it like the existing queries.

### Flattening is a role, not a new widget tree

The per-level rendering stays as it is (`WidgetFunction` → `WidgetApplication`,
one level per `OprApp`), so argument info, expected types, ports and edits keep
working unchanged. What changes is how a level is drawn, decided by a pure
function in `util/operatorChain.ts`:

```ts
/** How an infix application is drawn, relative to the call it is an operand of. */
type ChainRole = "root" | "continue" | "capsule";
function chainRole(app: Ast.OprApp, parent: Ast.Ast | undefined): ChainRole;
```

- `continue`: the parent is an `OprApp`, this is its operand on the side it
  associates (left for left-associative operators), not parenthesised, with the
  same precedence and the same spacing. The level's wrapper takes no box
  (`display: contents`), no outline and no padding, so its operands and operator
  sit in the parent's row.
- `capsule`: the parent is an `OprApp` (or a `Group` whose parent is one) and
  the role is not `continue`. The level's wrapper gets `.operatorCapsule`.
- `root`: anything else (the node's own expression, a prefix argument). Drawn
  like `continue` at its own level: no box of its own.

`WidgetFunction`'s `nested` becomes "prefix application, or infix with hidden
parameters". `WidgetArgumentName`'s `showsArgumentName` returns false for every
infix operand. The token-padding propagation in `WidgetTreeRoot.vue` keeps
working because a `display: contents` wrapper does not count as a child there;
`continue` wrappers that would otherwise break the first/last-child logic get
`.widgetOutOfLayout`-style treatment where needed (checked by test).

### Styling

- `WidgetFunction.vue`: `.nestedCall` uses
  `box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 30%, transparent)`
  instead of `border`.
- `.operatorCapsule`: `height: var(--node-port-height)`, `padding: 0 3px`,
  `border-radius: var(--node-port-border-radius)`,
  `background: rgb(0 0 0 / 0.2)`, `gap: 4px`.
- Nothing that groups widgets sets a vertical padding, margin or border.

`widgets/CLAUDE.md` ("Argument access") is updated: the outline rule, the chain
roles, and the dropped infix name chips.

## Testing

- **Unit (`util/__tests__/operatorChain.test.ts`):** `chainRole` for a
  same-operator chain, mixed `+`/`-` (continue), `*` under `+` (capsule), `&&`
  over comparisons, a parenthesised same-precedence group (capsule), a
  right-associative operator (`<|`, `->`-style user operators), and spacing
  (`a+b * c`).
- **Rust:** `binary_operator_precedence` for each precedence class and for
  non-operators.
- **Integration (`widgets.spec.ts`):** nodes for the URL chain,
  `price * qty + tax * (rate - 1)`, and a three-deep nested prefix call. Each
  node's height equals `--node-base-height`; each `.nestedCall` and
  `.operatorCapsule` is 24px; the URL node has no `.nestedCall` and no argument
  name chips; the mixed node has exactly three capsules; an operand still
  accepts an edge and pops out.
- Run the integration spec on Linux too (WSL): screenshot baselines live there.
- Before/after screenshots on the PR (the `pr-screenshots` branch).

## Delivery

One PR: Rust query + WASM export, `operatorChain.ts`, the widget and style
changes, tests, docs. It changes what users see in every operator node, so it
carries a CHANGELOG entry under `#### Enso IDE` and waits for the owner's
installer test before merging.

The separate bug found in the same review (dragging an argument's name should
pop the argument out) is fixed in its own PR, not here.

## Out of scope

- Multi-line nodes (a later epic).
- Any change to property-access chains or to prefix-call argument chips.
- Drawing operators as glyphs.
