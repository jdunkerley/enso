/**
 * @file Which labels an asset gets when the labels popover changes the state of one: the logic of
 * the React `ManageLabelsForm`'s `onChange`, framework-free so that it can be tested on its own.
 */
import type { SelectedAssetInfo } from '$/providers/driveStore'
import type { Label, LabelName } from 'enso-common/src/services/Backend'

/** Whether every, some or none of the chosen assets have a label. */
export type LabelState = 'all' | 'none' | 'some'

/** A label, and whether the chosen assets have it. */
export interface LabelInfo {
  readonly label: Label
  readonly state: LabelState
}

/**
 * The labels an asset should have after the states changed from `previousLabels` to `newLabels`,
 * or `null` when the change does not affect it (then it is left alone).
 *
 * A label that went to `all` is added, one that went to `none` removed, and the rest are kept as
 * the asset has them (`item.labels`).
 */
export function labelsAfterChange(
  item: SelectedAssetInfo,
  previousLabels: readonly LabelInfo[],
  newLabels: readonly LabelInfo[],
): readonly LabelName[] | null {
  const deltas = previousLabels.flatMap((previous) => {
    const current = newLabels.find((other) => other.label.id === previous.label.id)
    return current == null || current.state === previous.state ? [] : [{ previous, current }]
  })
  const isChanged = deltas.some(({ previous, current }) => {
    const wasLabelPresent =
      previous.state === 'all' ? true
      : previous.state === 'none' ? false
      : item.labels?.includes(previous.label.value) === true
    return (
      (current.state === 'all' && !wasLabelPresent) || (current.state === 'none' && wasLabelPresent)
    )
  })
  if (!isChanged) return null
  const labels = new Set(item.labels ?? [])
  for (const { label, state } of newLabels) {
    if (state === 'all') labels.add(label.value)
    else if (state === 'none') labels.delete(label.value)
  }
  return [...labels]
}
