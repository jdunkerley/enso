import { expect, test } from 'vitest'
import { flagsStore, migrateFeatureFlags } from '../featureFlags'

test('The Monaspace code font is on by default', () => {
  expect(flagsStore.getState().featureFlags.enableMonaspaceCodeFont).toBe(true)
})

test.each`
  version | stored       | expected
  ${1}    | ${false}     | ${undefined}
  ${1}    | ${true}      | ${true}
  ${1}    | ${undefined} | ${undefined}
  ${2}    | ${false}     | ${false}
`(
  'Persisted `enableMonaspaceCodeFont: $stored` from version $version migrates to $expected',
  ({ version, stored, expected }) => {
    const persisted = {
      featureFlags: {
        enableLocalBackend: true,
        ...(stored !== undefined ? { enableMonaspaceCodeFont: stored } : {}),
      },
    }
    const migrated = migrateFeatureFlags(persisted, version) as typeof persisted
    expect(migrated.featureFlags.enableLocalBackend).toBe(true)
    expect(
      (migrated.featureFlags as { enableMonaspaceCodeFont?: boolean }).enableMonaspaceCodeFont,
    ).toBe(expected)
  },
)
