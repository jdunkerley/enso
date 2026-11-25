# widgetRegistry/

What a node's widgets are made of: the registry that picks a widget for each
part of a node, and everything that turns the engine's widget answers into the
configurations those widgets read. The widgets themselves are in
`project-view/components/GraphEditor/widgets/` (see its `CLAUDE.md`, which says
how they choose and how a widget query runs).

## Files

- `widgetRegistry.ts` — `defineWidget`, `WidgetInput`, `Score` and the registry
  that scores the widgets for an input (smaller priority wins). `index.ts`
  re-exports it.
- `editHandler.ts` — `WidgetEditHandler`: a widget's edit interaction (start,
  edit, end, cancel), nested through the widget tree.
- `devtools.ts` — the Vue devtools plugin listing the widgets an input matched.
- `configuration.ts` — the zod schemas of the engine's widget JSON
  (`widgetConfigurationSchema`) and of `Widget_Query.resolve_call`'s answer
  (`widgetQueryAnswerSchema`: per argument a widget or an error, plus
  `resolver`, `unavailable`, and the `columns`, `search` and `revision` of the
  answer). `functionCallFromAnswer` turns an answer into the call's
  `FunctionCall`: widgets as `parameters`, and `errors`, `resolvers` and `notes`
  apart, each only when there is one. A field the GUI does not list is dropped
  by zod, silently.
- `typeDefaults.ts` — `TypeDefaults`: a type's default widget
  (`Widget_Query.resolve_type`), asked once per type per session, retried with
  backoff, in a computed frame. `lookup` gives the static default (a union's
  composed from its members'; a `Vector X` member's is a `Vector_Editor` of X's
  default, built here, memoised per X and marked a type default); `prefetch`
  starts the queries of a method's argument types before they render (spec §6);
  `resolverDefault` the resolver of a type whose default needs the call (group
  C: `Simple_Expression`, `DuckDB_GeoFormat`, …), which the widget query then
  runs per call through `type_defaults`. After `dispose` (the project closing) a
  query still in flight records nothing and starts no retry. A frame that
  answers any type is no longer avoided by the others' retries.
- `unionKinds.ts` — composing a declared union's widget from its members'
  (`composeUnion`), dropping a member another converts from (directly or through
  other members; of a cycle of conversions the earliest member stays). A `list`
  member (`Vector X`) takes no part in conversions and is a kind only beside a
  kind that is not a list.
- `columnPickers.ts` — expanding a column picker reference from the answer's
  `columns` block; `SchemaCache` keeps the expansions per schema.
- `widgetQueryPlan.ts` — pure: what a node's query sends after an answer (only
  the declared dependencies' ids, `queryUuids`), the `revision` stamp of their
  code and values, whether an answer is static, and the time constants
  (`SEARCH_DEBOUNCE_MS` 250, `RESOLVER_TIME_BOX_MS` 2000). Note [When A Widget
  Query Re-Runs] is the rule.
- `staticAnswerCache.ts` — `StaticAnswerCache`: static answers per method and
  argument names, reactive, LRU of 256; `modulesOfSuggestionUpdates` names the
  modules a suggestion update touches, whose entries go stale.

## Per project

`projectStates.ts` creates one `TypeDefaults`, `SchemaCache` and
`StaticAnswerCache` per opened project, beside the registry, and drops the
static answers of the modules each `search/suggestionsDatabaseUpdates` names.
`WithCurrentProject.vue` hands them to the widgets (`useCurrentProject()`).

## Tests

`__tests__/`: the schemas (`widgetQueryAnswer.test.ts`,
`configuration.test.ts`), the type defaults with fake timers, the union
composition, the column pickers, the query plan and the static cache. A change
to the answer's JSON needs the schema here, a case in
`widgetQueryAnswer.test.ts`, and the engine side (`Widget_Query.enso`) in the
same PR.
