import type { VisualizationModule } from '@/stores/visualization/runtimeTypes'
import type { Opt } from '@/util/data/opt'
import { ReactiveDb, ReactiveIndex } from '@/util/database/reactiveDb'
import { ANY_TYPE, ANY_TYPE_QN } from '@/util/ensoTypes'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'

export type VisualizationMetadata = Pick<
  VisualizationModule,
  'name' | 'inputType' | 'dataType' | 'icon'
>

function getTypesFromUnion(inputType: Opt<string>): string[] {
  const types = inputType?.split('|').map((type) => {
    const parsed = parseAbsoluteProjectPathRaw(type.trim())
    if (!parsed.ok) {
      console.error(`Invalid type in visualization metadata: ${type}`)
      return ANY_TYPE
    }
    return parsed.value
  })
  return types?.map((type) => type.key()) ?? [ANY_TYPE_QN]
}

declare const visualizationIdBrand: unique symbol
export type VisualizationId = string & { [visualizationIdBrand]: never }

/** TODO: Add docs */
export function toVisualizationId(meta: VisualizationIdentifier) {
  return JSON.stringify({
    // All fields MUST be explicitly written so that the order is consistent.
    module: {
      kind: meta.module.kind,
      name: meta.module.kind === 'Library' ? meta.module.name : undefined,
    },
    name: meta.name,
  }) as VisualizationId
}

/** TODO: Add docs */
export function fromVisualizationId(key: VisualizationId): VisualizationIdentifier {
  return JSON.parse(key)
}

/** TODO: Add docs */
export class VisualizationMetadataDb extends ReactiveDb<VisualizationId, VisualizationMetadata> {
  visualizationIdToType = new ReactiveIndex(this, (key, metadata) =>
    metadata.inputType == null && metadata.dataType != null ?
      []
    : getTypesFromUnion(metadata.inputType).map((type) => [key, type]),
  )
}

/**
 * The visualizations offered for a value whose types (visible and hidden) have the keys `typeKeys`:
 * those whose static input type matches one of them or `Any`, then those whose data type one of
 * them converts to. A conversion from `Any` (a catch-all) does not count, so a chart is not offered
 * for every value.
 */
export function visualizationsForTypes(
  metadata: VisualizationMetadataDb,
  typeKeys: readonly string[],
  conversionSources: (targetKey: string) => ReadonlySet<string> | undefined,
): VisualizationId[] {
  const result = new Set<VisualizationId>([
    ...typeKeys.flatMap((key) => [...(metadata.visualizationIdToType.reverseLookup(key) ?? [])]),
    ...(metadata.visualizationIdToType.reverseLookup(ANY_TYPE_QN) ?? []),
  ])
  for (const [id, meta] of metadata.entries()) {
    if (meta.dataType == null) continue
    const target = parseAbsoluteProjectPathRaw(meta.dataType)
    if (!target.ok) continue
    const sources = conversionSources(target.value.key())
    if (sources != null && typeKeys.some((key) => key !== ANY_TYPE_QN && sources.has(key))) {
      result.add(id)
    }
  }
  return [...result]
}
