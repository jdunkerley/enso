/** @file Which inputs the file browser widget takes: a browse configuration, or an annotation's options on a declared browsable type; never a declared type alone. */
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { widgetDefinition as fileBrowserWidget } from '@/components/GraphEditor/widgets/WidgetFileBrowser.vue'
import { UnderKindPickerKey } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import { Ast } from '@/util/ast'
import { ArgumentInfoKey } from '@/util/callTree'
import { describe, expect, test } from 'vitest'
import { typeDefaultConfig } from '../../__tests__/typeDefaultFixture'

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

  test('a declared type names a browsable type only as a whole union member', () => {
    const withOptions = (reprType: string) =>
      score(placeholder({ ...typedArgument(reprType), dynamicConfig: options }))
    expect(withOptions('Standard.Base.System.File.File')).toBe(Score.Perfect)
    expect(withOptions('(Standard.Base.Data.Text.Text | Standard.Base.System.File.File)')).toBe(
      Score.Perfect,
    )
    expect(withOptions('Standard.Base.Data.Vector.Vector Standard.Base.System.File.File')).toBe(
      Score.Mismatch,
    )
    expect(withOptions('My.Lib.Standard.Base.System.File.File_Like')).toBe(Score.Mismatch)
  })

  test("a type default's browse configuration claims a reference, as an annotation's does", async () => {
    // An un-annotated `File` argument, or an item of a `Vector File`, holding a variable keeps a ▾
    // over the variable, to pick a file in its place.
    const reference = WidgetInput.FromAst(Ast.parseExpression('my_file')!)
    for (const dynamicConfig of [
      // eslint-disable-next-line camelcase
      await typeDefaultConfig('File_Browse', { file_types: [] }),
      await typeDefaultConfig('Secret_Browse'),
    ])
      expect(score({ ...reference, dynamicConfig })).toBe(Score.Perfect)
  })
})
