import { expect, test } from 'vitest'
import {
  FEATURE_FLAGS_SCHEMA,
  flagsStore,
  migrateFeatureFlags,
  setFeatureFlag,
  useFeatureFlag,
} from '../featureFlags'

test.each(['enableMonaspaceCodeFont', 'monoNodes'])(
  'The removed `%s` flag is not defined',
  (flag) => {
    expect(Object.keys(FEATURE_FLAGS_SCHEMA.shape)).not.toContain(flag)
  },
)

test.each`
  version | enableMonaspaceCodeFont | monoNodes
  ${1}    | ${false}                | ${undefined}
  ${2}    | ${true}                 | ${false}
  ${3}    | ${false}                | ${true}
  ${3}    | ${undefined}            | ${undefined}
`(
  'Persisted removed flags from version $version are stripped, and other flags kept',
  ({ version, enableMonaspaceCodeFont, monoNodes }) => {
    const persisted = {
      featureFlags: {
        enableLocalBackend: true,
        ...(enableMonaspaceCodeFont !== undefined ? { enableMonaspaceCodeFont } : {}),
        ...(monoNodes !== undefined ? { monoNodes } : {}),
      },
    }
    const migrated = migrateFeatureFlags(persisted, version) as {
      featureFlags: Record<string, unknown>
    }
    expect(migrated.featureFlags).toEqual({ enableLocalBackend: true })
  },
)

test.each([null, 'garbage', {}, { featureFlags: null }])(
  'Malformed persisted state %j is passed through unchanged',
  (persisted) => {
    expect(migrateFeatureFlags(persisted, 3)).toBe(persisted)
  },
)

test.each([3, 4])('A version-%i store holding removed flags loads without them', (version) => {
  localStorage.setItem(
    'enso-feature-flags',
    JSON.stringify({
      state: {
        featureFlags: {
          enableLocalBackend: true,
          enableMonaspaceCodeFont: false,
          monoNodes: false,
        },
      },
      version,
    }),
  )
  try {
    flagsStore.rehydrate()
    const { featureFlags } = flagsStore.getState()
    expect(featureFlags.enableLocalBackend).toBe(true)
    expect(featureFlags).not.toHaveProperty('enableMonaspaceCodeFont')
    expect(featureFlags).not.toHaveProperty('monoNodes')
  } finally {
    localStorage.removeItem('enso-feature-flags')
  }
})

test('A change is saved, and reaches `useFeatureFlag`', () => {
  const flag = useFeatureFlag('enableMultitabs')
  const initial = flag.value
  try {
    setFeatureFlag('enableMultitabs', !initial)
    expect(flag.value).toBe(!initial)
    const saved = JSON.parse(localStorage.getItem('enso-feature-flags') ?? 'null')
    expect(saved).toMatchObject({
      state: { featureFlags: { enableMultitabs: !initial } },
      version: 4,
    })
  } finally {
    setFeatureFlag('enableMultitabs', initial)
    localStorage.removeItem('enso-feature-flags')
  }
})
