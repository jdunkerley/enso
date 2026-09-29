import { expect, test } from 'vitest'
import { flagsStore, migrateFeatureFlags } from '../featureFlags'

test('The Monaspace code font is on by default', () => {
  expect(flagsStore.getState().featureFlags.enableMonaspaceCodeFont).toBe(true)
})

test('Monospace node text is on by default', () => {
  expect(flagsStore.getState().featureFlags.monoNodes).toBe(true)
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

test.each`
  version | stored       | expected
  ${1}    | ${false}     | ${undefined}
  ${2}    | ${false}     | ${undefined}
  ${2}    | ${true}      | ${true}
  ${2}    | ${undefined} | ${undefined}
  ${3}    | ${false}     | ${false}
`(
  'Persisted `monoNodes: $stored` from version $version migrates to $expected',
  ({ version, stored, expected }) => {
    const persisted = {
      featureFlags: {
        enableLocalBackend: true,
        enableMonaspaceCodeFont: false,
        ...(stored !== undefined ? { monoNodes: stored } : {}),
      },
    }
    const migrated = migrateFeatureFlags(persisted, version) as typeof persisted
    expect(migrated.featureFlags.enableLocalBackend).toBe(true)
    expect((migrated.featureFlags as { monoNodes?: boolean }).monoNodes).toBe(expected)
    // A version-2 store has already had its `enableMonaspaceCodeFont` migrated; it is not touched again.
    expect(
      (migrated.featureFlags as { enableMonaspaceCodeFont?: boolean }).enableMonaspaceCodeFont,
    ).toBe(version < 2 ? undefined : false)
  },
)
