/** @file Settings entry for the "Handwritten comments" setting. */
import { Form } from '#/components/Form'
import { Switch } from '#/components/Switch'
import { useStore } from '#/utilities/zustand'
import { codeFontSettingsStore, setHandwrittenComments } from '$/providers/codeFont'
import { useText } from '$/providers/react'

/** A switch for the "Handwritten comments" setting (see `src/providers/codeFont.ts`). */
export default function HandwrittenCommentsSettingsSection() {
  const { getText } = useText()
  const handwrittenComments = useStore(codeFontSettingsStore, (state) => state.handwrittenComments)

  return (
    <Form
      schema={(schema) => schema.object({ handwrittenComments: schema.boolean() })}
      defaultValues={{ handwrittenComments }}
    >
      {({ form }) => (
        <Switch
          form={form}
          name="handwrittenComments"
          label={getText('handwrittenCommentsSetting')}
          description={getText('handwrittenCommentsSettingDescription')}
          onChange={(value) => {
            setHandwrittenComments(value)
          }}
        />
      )}
    </Form>
  )
}
