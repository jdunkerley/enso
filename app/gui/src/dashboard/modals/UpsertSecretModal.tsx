/**
 * @file The React form creating or editing a secret, kept only for the React asset panel
 * (`AssetProperties.tsx`) and the parity test. The drive's dialog is Vue now,
 * `$/cloud/credentials/UpsertSecretModal.vue` (#92), around the Vue form; this file goes when the
 * Properties tab's port (#190) deletes the panel.
 */
import { Button } from '#/components/Button'
import { Dialog } from '#/components/Dialog'
import { Form } from '#/components/Form'
import { Input } from '#/components/Inputs/Input'
import { useText } from '$/providers/react'
import type { SecretId } from 'enso-common/src/services/Backend'

/** Props for a {@link UpsertSecretForm}. */
export interface UpsertSecretFormProps {
  readonly secretId?: SecretId | null
  readonly name?: string | null
  readonly doCreate: (name: string, value: string) => void
  /**
   * If provided, a cancel button will be offered.
   *
   * The value may be:
   * - A callback to run if the button is pressed.
   * - 'close': The cancel button will close the containing dialog.
   * - 'reset': The cancel button will reset the form.
   */
  readonly doCancel?: 'close' | 'reset' | (() => void) | null
}

/** A form for creating and editing a secret. */
export function UpsertSecretForm(props: UpsertSecretFormProps) {
  const { secretId, name: nameRaw, doCreate, doCancel } = props
  const { getText } = useText()

  const isCreatingSecret = secretId == null

  return (
    <Form
      schema={(z) => z.object({ title: z.string().min(1), value: z.string() })}
      defaultValues={{ title: nameRaw ?? '', value: '' }}
      onSubmit={({ title, value }) => {
        doCreate(title, value)
      }}
      method="dialog"
      testId="upsert-secret-modal"
      className="w-full"
    >
      {isCreatingSecret && (
        <Input
          name="title"
          autoFocus
          autoComplete="off"
          label={getText('name')}
          placeholder={getText('secretNamePlaceholder')}
        />
      )}

      <Input
        name="value"
        type="password"
        autoComplete="off"
        label={getText('value')}
        placeholder={
          nameRaw == null ? getText('secretValuePlaceholder') : getText('secretValueHidden')
        }
      />

      <Button.Group className="mt-2">
        <Form.Submit>{isCreatingSecret ? getText('create') : getText('update')}</Form.Submit>
        {doCancel === 'reset' ?
          <Form.Reset>{getText('cancel')}</Form.Reset>
        : doCancel === 'close' ?
          <Dialog.Close>{getText('cancel')}</Dialog.Close>
        : doCancel ?
          <Button onPress={doCancel}>{getText('cancel')}</Button>
        : null}
      </Button.Group>

      <Form.FormError />
    </Form>
  )
}
