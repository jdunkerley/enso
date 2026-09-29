/** @file Settings entry for the "Code ligatures" setting. */
import { Form } from '#/components/Form'
import { Switch } from '#/components/Switch'
import { useStore } from '#/utilities/zustand'
import { codeFontSettingsStore, setCodeLigatures } from '$/providers/codeFont'
import { useText } from '$/providers/react'

/** A switch for the "Code ligatures" setting (see `src/providers/codeFont.ts`). */
export default function CodeLigaturesSettingsSection() {
  const { getText } = useText()
  const codeLigatures = useStore(codeFontSettingsStore, (state) => state.codeLigatures)

  return (
    <Form
      schema={(schema) => schema.object({ codeLigatures: schema.boolean() })}
      defaultValues={{ codeLigatures }}
    >
      {({ form }) => (
        <Switch
          form={form}
          name="codeLigatures"
          label={getText('codeLigaturesSetting')}
          description={getText('codeLigaturesSettingDescription')}
          onChange={(value) => {
            setCodeLigatures(value)
          }}
        />
      )}
    </Form>
  )
}
