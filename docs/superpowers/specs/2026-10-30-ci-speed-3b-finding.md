# CI speed 3b: why are the Rounding tests slow? — finding

Task 3 of `docs/superpowers/plans/2026-10-30-ci-speed-phase-3.md` (3b of the
phase 3 design, `docs/superpowers/specs/2026-10-30-ci-speed-phase-3-design.md`;
CI speed design #417). A time-boxed investigation; it changes no code.

**Outcome (a): a performance bug in the library.** `DB_Column.let`
(`distribution/lib/Standard/Database/0.0.0-dev/src/DB_Column.enso`) names each
CTE binder with `Table_Naming_Helper.generate_random_table_name`, which asks the
database whether a table with that random name exists (`Connection.table_exists`
→ `get_tables_advanced`, a JDBC catalog lookup turned into an in-memory table).
That costs ~20 ms on SQLite, and the pure-column-ops rounding builds 2–8 `let`s
per rounded column. Replacing the lookup with a plain UUID name halves the group
on both SQLite backends (local, native image): **SQLite File 71 → 35–39 s,
SQLite In-Memory 55 → 23 s**, every case and assertion unchanged.

## What the group does

`(Column_Operations_Spec) Rounding numeric tests` runs the 16 specs of
`test/Base_Tests/src/Data/Round_Spec.enso` once through `.round` and, on
Database backends, again through `.round_pure_column_ops`, plus two specs of its
own: 34 per Database backend (32 run, 2 pending), 18 in memory (17 run). Each
spec is a batch: one 1-row literal table (`light_table_builder`, no upload) with
one column per value, every column rounded, one `read` for the whole batch.

`DB_Column_Implementation.round` uses the database's own `ROUND` only when the
dialect supports the case (`should_use_builtin_round`); otherwise it builds the
rounding out of column operations (`round_integer`, `round_float`,
`round_decimal`). On SQLite that is every Banker's case, every negative number
of decimal places, and every integer input; `.round_pure_column_ops` always
takes that path. `round_integer` uses 8 `let`s, `round_float` 2 (Half Up) or 3
(Banker's). These 14 calls in `DB_Column_Implementation.enso` are the only users
of `DB_Column.let` in the standard library.

## Step 1: the cases

CI does not keep per-case times: run 41024999010 uploads no JUnit artifact and
its check runs carry no report text; the logs give group totals only.

| Group total, run 41024999010 | Linux Native | Linux JVM |
| ---------------------------- | -----------: | --------: |
| PostgreSQL                   |        135 s |      74 s |
| SQLite File                  |        112 s |      66 s |
| SQLite In-Memory             |         90 s |      50 s |
| In-Memory                    |       0.74 s |    0.26 s |

Per case, measured locally from `ENSO_TEST_JUNIT_DIR` (Windows, the run's own
native distribution, IR caches on). The remaining specs (the 6 decimal specs
that SQLite's builtin `ROUND` handles, and the argument-type check) are summed
in the last row; the deprecated-argument spec is pending on Database backends.

| Case                                         | SQLite File `.round` | pure ops | SQLite In-Mem `.round` | pure ops |
| -------------------------------------------- | -------------------: | -------: | ---------------------: | -------: |
| Integers, negative places                    |                9.2 s |    7.4 s |                  4.9 s |    5.0 s |
| Negative integers, negative places           |                9.8 s |    7.4 s |                  5.8 s |    5.1 s |
| Negative integers, negative places, Banker's |                7.1 s |    6.5 s |                  5.4 s |    5.1 s |
| Banker's, half-way values                    |                4.8 s |    2.5 s |                  2.2 s |    2.1 s |
| Positive decimals, negative places           |                4.1 s |    1.3 s |                  1.2 s |    2.2 s |
| Banker's, non-half-way values                |                3.5 s |    1.7 s |                  0.9 s |    1.2 s |
| Negative decimals, negative places           |                2.2 s |    1.2 s |                  1.1 s |    0.9 s |
| Small integers, places ≥ 0                   |                0.2 s |    3.6 s |                  0.1 s |    1.2 s |
| Non-builtin integer column rounding (own)    |                8.4 s |        — |                  6.5 s |        — |
| The other 7 specs, summed                    |                1.7 s |    4.5 s |                  0.4 s |    3.7 s |

The pattern is the same on both backends: a case is slow exactly when it takes
the pure-column-ops path, and in proportion to how many columns it rounds (the
integer specs have 24–26 values) and how many `let`s each needs (integers 8).
Where SQLite's builtin `ROUND` applies, a case takes 0.05–0.3 s (0.7 s for the
group's first, warm-up case). In memory every case is under 0.1 s. PostgreSQL
was not run locally (no service); it takes the pure path for Banker's and for
floats with decimal places ≠ 0.

## Step 2: reproduction

`enso --run test/Table_Tests "Rounding numeric tests"` from `test/` (the `main`
filter; the summary confirmed 81 tests ran, 5 pending) with the Windows native
distribution of run 41024999010:

| Run                         | SQLite File | SQLite In-Memory | In-Memory |
| --------------------------- | ----------: | ---------------: | --------: |
| IR caches on, run 1         |        89 s |             61 s |    0.76 s |
| IR caches on, run 2         |        87 s |             55 s |    0.38 s |
| `--no-ir-caches` (baseline) |        71 s |             55 s |    0.43 s |

## Step 3: where the time goes

A probe script (one batch of the 25 integer values of "Integers, negative
places", SQLite In-Memory, timed by phase over three iterations):

| Phase                               | 1st iteration |  steady state |
| ----------------------------------- | ------------: | ------------: |
| Build the literal table             |        369 ms |       9–30 ms |
| **Build the 25 rounded columns**    |    **8–11 s** | **4.1–5.5 s** |
| `set` them into the table           |         98 ms |      15–30 ms |
| Compile the SQL (45,566 characters) |         1.7 s |        124 ms |
| Execute the query (`read`)          |        804 ms |    154–435 ms |

Ruled out: the SQL text, its compilation, and its execution (one statement per
batch, 0.1–0.4 s); type inference queries (SQLite infers types statically, and
`ENSO_SQL_LOG_PATH` logged one statement per batch); table uploads (the literal
table is a `VALUES` query); a cross-product of inputs (one table, one query per
spec). Column names stay short (10 characters).

Building is ~200 ms per rounded column. Per operation (steady state, ms/op):

| Operation                                           |     ms/op |
| --------------------------------------------------- | --------: |
| In-memory `x * 10`                                  |       0.6 |
| DB `x * 10`, `x % 10`, `x >= 0`, `x + y`            |       4–7 |
| DB `iif`                                            |      7–13 |
| DB `round 0` (builtin path)                         |       1.3 |
| **DB `let` (identity callback)**                    | **26–38** |
| `Random.uuid`                                       |      0.02 |
| `Connection.table_exists` (SQLite memory / file)    |   23 / 17 |
| `generate_random_table_name`                        |        20 |
| DB `round_pure_column_ops -3` on one integer column |   200–280 |

`let` is almost entirely the `table_exists` lookup in
`generate_random_table_name`. `ENSO_SQL_LOG_PATH` does not show it: it is a JDBC
metadata call, not a statement.

**Confirmation.** In a scratch copy of the distribution (not the repository),
line 88 of `Database/.../src/DB_Column.enso` was changed from
`self.connection.base_connection.table_naming_helper.generate_random_table_name`
to `"enso-table-" + Random.uuid`. With `--no-ir-caches` (see the trap below):
`let` 38 → 0.45 ms, one pure-ops round 203 → 84 ms, and the group:

| `--no-ir-caches` | SQLite File | SQLite In-Memory |
| ---------------- | ----------: | ---------------: |
| Unpatched        |        71 s |             55 s |
| Patched, run 1   |        39 s |             23 s |
| Patched, run 2   |        35 s |             23 s |

All 81 tests passed with the patch. The slowest case per backend falls from 7.8
s to 3.6 s (SQLite File) and from 6.4 s to 1.9 s (SQLite In-Memory).

**Trap met on the way:** after editing a library source in a built distribution,
the engine kept running the old code from its IR cache. The first patched run
(without `--no-ir-caches`) looked like "no effect" (84 s / 57 s). Pass
`--no-ir-caches` when measuring a library edit in a downloaded distribution.

## Proposed fix (follow-up PR)

In `DB_Column.let`, name the binder without a catalog lookup, keeping the length
limit:

```enso
binder = self.connection.base_connection.table_naming_helper.truncate_if_needed ("enso-let-" + Random.uuid)
```

The binder is a CTE name scoped to one expression, so it needs to be unique only
within the query, which a UUID already gives; the `table_exists` check guards
against a table of the same random name, which is never the case in practice and
is not a guarantee anyway (a table can be created after the check). The
follow-up should confirm no dialect's `Let`/`Let_Ref` generation relies on the
name being free in the catalog, and run `Table_Tests` on SQLite and PostgreSQL.

**Would users notice?** Yes, a little: every Database `round` that takes the
pure path (Banker's or negative decimal places on SQLite; Banker's and float
decimal places on PostgreSQL; per dialect flags elsewhere) makes 2–8 catalog
lookups per rounded column while the expression is built, each a network round
trip on a remote database. The fix removes them; results are unchanged. Under
the changelog policy that is a performance bug fix (label), unless the
controller judges it a change users feel.

## Expected saving

Locally the group halves on SQLite: −32 to −36 s per backend natively. On CI,
extrapolating the same ~50–58 % to run 41024999010's figures (not measured):

| Table part (run 41024999010) | Group now | After fix (est.) | Saving (est.) |
| ---------------------------- | --------: | ---------------: | ------------: |
| Linux Native: SQLite File    |     112 s |            ~55 s |         ~55 s |
| Linux Native: SQLite In-Mem  |      90 s |            ~40 s |         ~50 s |
| Linux Native: PostgreSQL     |     135 s |         ~50–65 s |      ~70–85 s |
| Linux JVM: all three         |     190 s |            ~90 s |        ~100 s |

PostgreSQL is the least certain: its catalog lookup goes over TCP, so the saving
may be larger. Once 3a splits the shard by backend, each backend's shard gains
its own line. The CI before/after is for the follow-up PR (two runs each).

## Left after the fix

About 0.2–0.4 s per pure-path column batch remains: each Database column
operation costs 4–13 ms to build, against 0.6 ms in memory, and `round_integer`
builds ~20 of them per column. Not investigated within the box; it is general
`DB_Column` overhead (type inference through `operations_dict`, naming, IR
construction), not specific to the tests, and a separate question. Why the
native suite is ~1.7× slower than the JVM one was not investigated either; the
lookup being CPU-bound JDBC metadata and table-building code is consistent with
it but unconfirmed. No restructuring of the test is needed.
