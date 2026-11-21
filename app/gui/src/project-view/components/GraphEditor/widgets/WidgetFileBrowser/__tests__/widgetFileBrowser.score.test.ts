/** @file Which inputs the file browser widget takes: a browse configuration, or an annotation's options on a declared browsable type; never a declared type alone. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as fileBrowserWidget } from '@/components/GraphEditor/widgets/WidgetFileBrowser.vue'
import { UnderKindPickerKey } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'

function score(input: WidgetInput): Score {
  return fileBrowserWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)
}

const placeholder = (extra: Partial<WidgetInput> = {}): WidgetInput => ({
  portId: 'port' as WidgetInput['portId'],
  value: undefined,
  ...extra,
})
const typedArgument = (reprType: string) =>
  ({
    [ArgumentInfoKey]: { appKind: 0, info: { name: 'path', reprType } },
  }) as Partial<WidgetInput>

describe('the file browser widget scores', () => {
  test('a union containing File, without the configuration, Mismatch', () => {
    expect(
      score(
        placeholder(typedArgument('Standard.Base.Data.Text.Text | Standard.Base.System.File.File')),
      ),
    ).toBe(Score.Mismatch)
  })

  test('a File_Browse configuration Perfect', () => {
    expect(
      score(
        placeholder({
          ...typedArgument('Standard.Base.Data.Text.Text | Standard.Base.System.File.File'),
          /* eslint-disable-next-line camelcase */
          dynamicConfig: { kind: 'File_Browse', file_types: [] },
        }),
      ),
    ).toBe(Score.Perfect)
  })

  const fileUnion = 'Standard.Base.Data.Text.Text | Standard.Base.System.File.File'
  const options = {
    kind: 'Single_Choice',
    values: [{ value: "'a'", label: 'A', parameters: [] }],
  } as const

  test("an annotation's options on a declared File Perfect: the browse items join them", () => {
    expect(score(placeholder({ ...typedArgument(fileUnion), dynamicConfig: options }))).toBe(
      Score.Perfect,
    )
  })

  test("an annotation's options on a declared type that cannot be browsed, Mismatch", () => {
    expect(
      score(
        placeholder({
          ...typedArgument('Standard.Base.Data.Text.Text'),
          dynamicConfig: options,
        }),
      ),
    ).toBe(Score.Mismatch)
  })

  test("the kind picker's inner input, Mismatch even with options", () => {
    expect(
      score(
        placeholder({
          ...typedArgument(fileUnion),
          dynamicConfig: options,
          [UnderKindPickerKey]: true,
        }),
      ),
    ).toBe(Score.Mismatch)
  })
})
