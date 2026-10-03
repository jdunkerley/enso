<script setup lang="ts">
/**
 * @file The dialog asking the user to accept the updated Terms of Service and Privacy Policy: the
 * Vue port of the React `#/modals/AgreementsModal`, with the same title, text, checkboxes, links,
 * button and test ids (`agreements-modal`, `agreements-form`).
 *
 * `ProtectedLayout.vue` shows it in place of the page while either agreement is missing (through
 * the gate `./agreements.ts` contributes), and decides when. It cannot be dismissed: no close
 * button, no Escape, no outside click. Each checkbox starts ticked when its document has not
 * changed since the user last accepted it; both must be ticked to submit, which records the
 * acceptance (`userAgreed`) and closes the dialog.
 */
import Button from '$/components/Button/Button.vue'
import Checkbox from '$/components/Checkbox/Checkbox.vue'
import CheckboxGroup from '$/components/Checkbox/CheckboxGroup.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const { agreedToTos, agreedToPrivacyPolicy, userAgreed } = defineProps<{
  agreedToTos: boolean
  agreedToPrivacyPolicy: boolean
  userAgreed: () => void
}>()

const { getText } = useText()

// Opens as it mounts, as React's `defaultOpen` did.
const open = ref(true)

const defaultValues = {
  agreedToTos: agreedToTos ? ['agree'] : [],
  agreedToPrivacyPolicy: agreedToPrivacyPolicy ? ['agree'] : [],
}

const eulaUrl = `${$config.HOST}/eula`
const privacyPolicyUrl = `${$config.HOST}/privacy`
</script>

<template>
  <Dialog
    id="agreements-modal"
    v-model:open="open"
    :title="getText('licenseAgreementTitle')"
    isKeyboardDismissDisabled
    :isDismissable="false"
    hideCloseButton
    testId="agreements-modal"
  >
    <Form
      :schema="
        (schema) =>
          schema.object({
            // The user must agree to the ToS to proceed.
            agreedToTos: schema
              .array(schema.string())
              .min(1, { message: getText('licenseAgreementCheckboxError') }),
            agreedToPrivacyPolicy: schema
              .array(schema.string())
              .min(1, { message: getText('privacyPolicyCheckboxError') }),
          })
      "
      :defaultValues="defaultValues"
      testId="agreements-form"
      method="dialog"
      @submit="() => userAgreed()"
    >
      <Text>{{ getText('someAgreementsHaveBeenUpdated') }}</Text>

      <CheckboxGroup name="agreedToTos">
        <Checkbox value="agree">{{ getText('licenseAgreementCheckbox') }}</Checkbox>
        <template #description>
          <Button variant="link" target="_blank" :href="eulaUrl">
            {{ getText('viewLicenseAgreement') }}
          </Button>
        </template>
      </CheckboxGroup>

      <CheckboxGroup name="agreedToPrivacyPolicy">
        <Checkbox value="agree">{{ getText('privacyPolicyCheckbox') }}</Checkbox>
        <template #description>
          <Button variant="link" target="_blank" :href="privacyPolicyUrl">
            {{ getText('viewPrivacyPolicy') }}
          </Button>
        </template>
      </CheckboxGroup>

      <Submit fullWidth>{{ getText('accept') }}</Submit>

      <FormError />
    </Form>
  </Dialog>
</template>
