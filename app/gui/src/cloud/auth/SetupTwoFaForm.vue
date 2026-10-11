<script setup lang="ts">
/**
 * @file The two-factor authentication section of the Account settings tab. With 2FA on, it offers
 * to turn it off (after a code from the authenticator app); with 2FA off, a switch reveals the
 * setup (`TwoFaSetup.vue`).
 */
import type { MfaType } from '$/authentication/cognito'
import Alert from '$/components/Alert/Alert.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import FieldValue from '$/components/Form/FieldValue.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import OTPInput from '$/components/Inputs/OTPInput.vue'
import Switch from '$/components/Switch/Switch.vue'
import Text from '$/components/Text/Text.vue'
import TextGroup from '$/components/Text/TextGroup.vue'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'
import TwoFaSetup from './TwoFaSetup.vue'

/** The length of a one-time code. */
const OTP_LENGTH = 6

const { getText } = useText()
const session = useSession()

const preference = useQuery({
  queryKey: ['twoFaPreference'],
  queryFn: () => session.getMFAPreference(),
})
const isMfaEnabled = computed(() => preference.data.value !== 'NOMFA')

const updateMfaPreference = useMutation({
  mutationFn: (mfaType: MfaType) => session.updateMFAPreference(mfaType),
  meta: { invalidates: [['twoFaPreference']] },
})

/** Check a one-time code, then change the preference. */
async function verifyAndUpdate(otp: string, mfaType: MfaType) {
  const passed = await session.verifyTotpToken(otp)
  if (!passed) throw new Error('Invalid OTP')
  await updateMfaPreference.mutateAsync(mfaType)
}

// Shown once the preference is known.
await preference.suspense()
</script>

<template>
  <div v-if="isMfaEnabled" class="flex w-full flex-col gap-4">
    <Alert variant="neutral" icon="shield_check">
      <TextGroup>
        <Text variant="subtitle" weight="bold">{{ getText('2FAEnabled') }}</Text>
        <Text>{{ getText('2FAEnabledDescription') }}</Text>
      </TextGroup>
    </Alert>
    <div class="flex w-full flex-col">
      <Text variant="subtitle" weight="bold">{{ getText('disable2FA') }}</Text>
      <Text color="disabled" class="mb-4">{{ getText('disable2FADescription') }}</Text>
      <Dialog :title="getText('disable2FA')">
        <template #trigger>
          <Button variant="delete" class="self-start" icon="shield_crossed">
            {{ getText('disable2FA') }}
          </Button>
        </template>
        <Form
          :schema="(z) => z.object({ otp: z.string().min(OTP_LENGTH).max(OTP_LENGTH) })"
          :defaultValues="{ otp: '' }"
          :formOptions="{ mode: 'onSubmit' }"
          method="dialog"
          @submit="({ otp }) => verifyAndUpdate(otp, 'NOMFA')"
        >
          <Text>{{ getText('disable2FAWarning') }}</Text>
          <OTPInput
            autoFocus
            name="otp"
            :maxLength="OTP_LENGTH"
            :label="getText('verificationCode')"
          />
          <ButtonGroup>
            <Submit variant="delete">{{ getText('disable') }}</Submit>
            <DialogClose variant="outline">{{ getText('cancel') }}</DialogClose>
          </ButtonGroup>
          <FormError />
        </Form>
      </Dialog>
    </div>
  </div>
  <Form
    v-else
    :schema="
      (z) =>
        z.object({
          enabled: z.boolean(),
          display: z.string(),
          otp: z.string().min(OTP_LENGTH).max(OTP_LENGTH),
        })
    "
    :defaultValues="{ enabled: false, display: 'QR', otp: '' }"
    @submit="({ enabled, otp }) => (enabled ? verifyAndUpdate(otp, 'TOTP') : undefined)"
  >
    <Switch
      name="enabled"
      :description="getText('enable2FADescription')"
      :label="getText('enable2FA')"
    />
    <ErrorBoundary>
      <SuspenseLoader>
        <FieldValue v-slot="{ value: enabled }" name="enabled">
          <TwoFaSetup v-if="enabled === true" :otpLength="OTP_LENGTH" />
        </FieldValue>
      </SuspenseLoader>
    </ErrorBoundary>
  </Form>
</template>
