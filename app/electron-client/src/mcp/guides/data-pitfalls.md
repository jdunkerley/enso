# Data-analysis pitfalls

- **Distinct-value samples are incomplete.** `column.to_vector.distinct.take 30`
  only shows the first 30 distinct values; rarer variants can sit far past that
  window. When enumerating valid categorical values to filter on (status codes,
  region labels, error categories), first check
  `column.to_vector.distinct.length.to_text`. If the count exceeds your `take`,
  widen it or use `column.to_vector.distinct.to_json` to get them all.
- **Real-world categoricals have casing and whitespace variants.** A single
  column may hold `"Active"`, `"ACTIVE"` and `"active "` for the same label, or
  `"USA"` and `"U.S.A."` for the same country. Inspect the full distinct set
  before hard-coding a filter list, or normalise both sides
  (`.to_case ..Lower . trim`) before comparing. A filter that misses one variant
  silently drops the rows that use it.
- **`Column == X` with a type-mismatched `X` returns a Boolean Column containing
  `Nothing`, not `False`.** Reducing such columns with `||` or `&&` produces
  `Nothing` cells, and `Filter_Condition.Is_False`, `..Equal False` and
  `..Not_Equal y` treat `Nothing` as "not the requested value", so they drop
  those rows. Pipe Boolean Columns through `.fill_nothing False` (or `True`,
  depending on intent) before handing them to `Table.filter`. The same applies
  to `Filter_Condition.Not_Equal` composed inside a fold or map: the predicate
  goes `Nothing` on type mismatch and the rows are dropped.
- **Scraped data may have partial-header rows.** A "leaked header" row often has
  the text columns matching their header names (for example
  `Customer="Customer"`, `Status="Status"`) while numeric columns hold real
  values. To detect them, OR per-column `(table.at name) == name` across columns
  and `fill_nothing False` before filtering. Filtering on a single column misses
  rows where that column holds real data; assuming every column matches its
  header misses rows where the numeric columns do not.
- **Joins must use the full natural key.** If a `Date` may repeat across several
  `Symbol`s (or any "id within a group" pattern: `ProductId` within `OrderId`,
  `SensorId` within `LocationId`), join on `["Symbol","Date"]`, not `["Date"]`.
  The shorter key may work today by accident and silently multiply rows or pick
  the wrong row tomorrow. The same applies to aggregations: prefer
  `aggregate ["Symbol","Date"] ...` over `aggregate ["Date"] ...` when both
  dimensions are meaningful, even if the current data has unique values across
  the broader key.
