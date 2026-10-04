/** @file Which labels an asset gets when the labels popover changes a label's state (#198). */
import type { SelectedAssetInfo } from '$/providers/driveStore'
import {
  AssetType,
  COLORS,
  LabelName,
  ProjectId,
  TagId,
  type Label,
} from 'enso-common/src/services/Backend'
import { describe, expect, test } from 'vitest'
import { labelsAfterChange, type LabelInfo, type LabelState } from '../labelChanges'

function label(name: string): Label {
  return { id: TagId(`tag-${name}`), value: LabelName(name), color: COLORS[0] }
}
const ALPHA = label('alpha')
const BETA = label('beta')

function asset(labels: readonly string[] | null): SelectedAssetInfo {
  return {
    id: ProjectId('project-1'),
    type: AssetType.project,
    title: 'p',
    parentId: null,
    labels: labels?.map(LabelName) ?? null,
  } as unknown as SelectedAssetInfo
}

const states = (alpha: LabelState, beta: LabelState): LabelInfo[] => [
  { label: ALPHA, state: alpha },
  { label: BETA, state: beta },
]

describe('labelsAfterChange', () => {
  test('checking a label adds it to an asset that lacks it', () => {
    expect(
      labelsAfterChange(asset(['alpha']), states('all', 'none'), states('all', 'all')),
    ).toEqual(['alpha', 'beta'])
  })

  test('unchecking a label removes it', () => {
    expect(
      labelsAfterChange(asset(['alpha', 'beta']), states('all', 'all'), states('all', 'none')),
    ).toEqual(['alpha'])
  })

  test('an asset the change does not affect is left alone', () => {
    // Some assets had `beta`; checking it changes only those without it.
    expect(
      labelsAfterChange(asset(['beta']), states('none', 'some'), states('none', 'all')),
    ).toBeNull()
    expect(labelsAfterChange(asset([]), states('none', 'some'), states('none', 'all'))).toEqual([
      'beta',
    ])
  })

  test('nothing changed: null', () => {
    expect(
      labelsAfterChange(asset(null), states('none', 'none'), states('none', 'none')),
    ).toBeNull()
  })

  test('a label in neither list (deleted meanwhile) is ignored', () => {
    expect(
      labelsAfterChange(asset(['alpha']), [{ label: ALPHA, state: 'all' }], states('none', 'all')),
    ).toEqual(['beta'])
  })
})
