import type { NodeId } from '$/providers/openedProjects/graph'
import type { GraphDb, MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import { evaluationProgress } from '$/providers/openedProjects/project/computedValueRegistry'
import {
  SuggestionKind,
  type SuggestionEntry,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import type { ToValue } from '$/utils/reactivity'
import type { ValidCachedAppearance } from '@/util/cachedAppearance'
import type { Icon } from '@/util/iconMetadata/iconName'
import type { MethodPointer } from '@/util/methodPointer'
import type { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { computed, toValue, type ComputedRef } from 'vue'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import type { AnyIcon, AnyWidgetIcon } from './icons'

const typeNameToIconLookup: Record<string, Icon> = {
  'Data.Text.Text': 'text_input',
  'Data.Numbers.Integer': 'input_number',
  'Data.Numbers.Float': 'input_number',
  'Data.Array.Array': 'array_new',
  'Data.Vector.Vector': 'array_new',
  'Data.Time.Date.Date': 'calendar',
  'Data.Time.Date_Time.Date_Time': 'calendar',
  'Data.Time.Time_Of_Day.Time_Of_Day': 'time',
}

export const DEFAULT_ICON = 'enso_logo'

/** Returns an icon override for certain standard library types. */
export function typeNameToIcon(typePath: ProjectPath): Icon {
  if (typePath.project === ('Standard.Base' as QualifiedName) && typePath.path != null) {
    return typeNameToIconLookup[typePath.path] ?? DEFAULT_ICON
  } else {
    return DEFAULT_ICON
  }
}

/** Returns an icon override for a suggestion entry kind. */
export function suggestionEntryToIcon(entry: SuggestionEntry) {
  if (entry.iconName) return entry.iconName
  if (entry.kind === SuggestionKind.Local) return 'local_scope2'
  if (entry.kind === SuggestionKind.Module) return 'collection'
  return DEFAULT_ICON
}

/**
 * Returns an icon for a suggestion entry or method call. `fallback` is used when neither says
 * anything (e.g. the icon saved from an earlier session, before the node is recomputed).
 *
 * With `preferFallbackOverType`, a given `fallback` is also preferred to an icon derived from
 * `actualType`: used while the node's suggestion entry may be pending (see
 * `GraphDb.isNodeSuggestionPending`), when the missing `entry` may just not be known yet.
 */
export function displayedIconOf(
  entry?: SuggestionEntry,
  methodCall?: MethodPointer,
  actualType?: ProjectPath,
  fallback?: Icon,
  { preferFallbackOverType = false }: { preferFallbackOverType?: boolean } = {},
): Icon {
  if (entry) {
    return suggestionEntryToIcon(entry)
  } else if (preferFallbackOverType && fallback) {
    return fallback
  } else if (!methodCall?.name && actualType) {
    return typeNameToIcon(actualType)
  } else {
    return fallback ?? DEFAULT_ICON
  }
}

/**
 * The fallback icon to pass to {@link displayedIconOf} for a node that may be pending: its cached
 * icon, or — while `pending` — `DEFAULT_ICON` if it has a `cachedAppearance` (at least a cached
 * colour) but no cached icon. The writer stores an icon equal to `DEFAULT_ICON` as absent (see
 * `appearanceToCache`), so an absent cached icon on an otherwise-cached node means the logo, not
 * "never cached" — without this, such a node would show its type-derived icon while pending and
 * then switch to the logo once its suggestion entry arrives. A node with no `cachedAppearance` at
 * all was never cached, so there is nothing to prefer: it keeps showing the type-derived icon.
 */
function cachedIconFallback(
  cachedAppearance: ValidCachedAppearance | undefined,
  pending: boolean,
): Icon | undefined {
  if (cachedAppearance == null) return undefined
  return cachedAppearance.icon ?? (pending ? DEFAULT_ICON : undefined)
}

/**
 * Returns the icon to show on a component. With `useCachedIcon: false` the icon saved from an
 * earlier session is ignored, giving the icon computed from current data alone. Otherwise, while
 * the node's suggestion entry is pending, the cached icon is preferred to one derived from the type.
 */
export function iconOfNode(
  node: NodeId,
  graphDb: GraphDb,
  { useCachedIcon = true }: { useCachedIcon?: boolean } = {},
) {
  const expressionInfo = graphDb.getExpressionInfo(node)
  const suggestionEntry = graphDb.getNodeMainSuggestion(node)
  const nodeData = graphDb.nodeIdToNode.get(node)
  const pending = graphDb.isNodeSuggestionPending(node)
  switch (nodeData?.type) {
    default:
    case 'component':
      return displayedIconOf(
        suggestionEntry,
        expressionInfo?.methodCall?.methodPointer,
        expressionInfo?.typeInfo?.primaryType,
        useCachedIcon ? cachedIconFallback(nodeData?.cachedAppearance, pending) : undefined,
        { preferFallbackOverType: pending },
      )
    case 'output':
      return 'data_output'
    case 'input':
      return 'data_input'
  }
}

/**
 * The icon `WidgetSelfAccessChain` shows for a method call's subject widget: the call's own
 * suggestion-entry icon if `callInfo` is known, else the type-derived icon — except while the
 * node's suggestion entry may be pending (`GraphDb.isNodeSuggestionPending`), when the node's
 * cached icon (see {@link cachedIconFallback}) is preferred to one derived from `outputType`.
 * `nodeId` is `undefined` before the widget tree knows the node's external id; the node is then
 * treated as pending exactly when the suggestion database has not finished loading.
 */
export function selfAccessChainIcon(
  db: GraphDb,
  nodeId: NodeId | undefined,
  callInfo: MethodCallInfo | undefined,
  outputType: ProjectPath | undefined,
): Icon {
  const pending = nodeId != null ? db.isNodeSuggestionPending(nodeId) : !db.suggestionsLoaded
  const cachedAppearance =
    nodeId != null ? db.nodeIdToNode.get(nodeId)?.cachedAppearance : undefined
  return displayedIconOf(
    callInfo?.suggestion,
    callInfo?.methodCall.methodPointer,
    outputType,
    cachedIconFallback(cachedAppearance, pending),
    { preferFallbackOverType: pending },
  )
}

/**
 * Returns the icon to show on a component, using either the provided base icon or an icon
 * representing its current status.
 */
export function useDisplayedIcon(
  graphDb: ToValue<GraphDb>,
  externalId: ToValue<ExternalId | undefined>,
  baseIcon: ToValue<AnyIcon>,
): {
  displayedIcon: ComputedRef<AnyWidgetIcon>
} {
  return {
    displayedIcon: computed(() =>
      evaluationProgress(toValue(graphDb).getExpressionInfo(toValue(externalId))) == null ?
        toValue(baseIcon)
      : '$evaluating',
    ),
  }
}
