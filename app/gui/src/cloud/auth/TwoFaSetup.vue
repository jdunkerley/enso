<script setup lang="ts">
/**
 * @file The setup of two-factor authentication, inside `SetupTwoFaForm.vue`'s form: the
 * authenticator app's link, as a QR code or as text to copy, and the field for the first code.
 */
import Alert from '$/components/Alert/Alert.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import CopyBlock from '$/components/CopyBlock/CopyBlock.vue'
import FieldValue from '$/components/Form/FieldValue.vue'
import FormError from '$/components/Form/FormError.vue'
import Reset from '$/components/Form/Reset.vue'
import Submit from '$/components/Form/Submit.vue'
import OTPInput from '$/components/Inputs/OTPInput.vue'
import Selector from '$/components/Inputs/Selector.vue'
import QrCode from '$/components/QrCode/QrCode.vue'
import Text from '$/components/Text/Text.vue'
import TextGroup from '$/components/Text/TextGroup.vue'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'

const { otpLength } = defineProps<{ otpLength: number }>()

const { getText } = useText()
const session = useSession()

const totp = useQuery({ queryKey: ['setupTOTP'], queryFn: () => session.setupTOTP() })
const url = computed(() => totp.data.value?.url ?? '')

// Shown once the link is known.
await totp.suspense()
</script>

<template>
  <div class="flex w-full flex-col gap-4">
    <Selector name="display" :items="['QR', 'Text']" :aria-label="getText('display')" />
    <FieldValue v-slot="{ value: display }" name="display">
      <template v-if="display === 'QR'">
        <Alert variant="neutral" icon="shield_check">
          <TextGroup>
            <Text variant="subtitle" weight="bold">{{ getText('scanQR') }}</Text>
            <Text>{{ getText('scanQRDescription') }}</Text>
          </TextGroup>
        </Alert>
        <div class="self-center">
          <QrCode
            :value="url"
            bgColor="transparent"
            fgColor="rgb(0 0 0 / 60%)"
            :size="192"
            class="rounded-2xl border-0.5 border-primary p-4"
          />
        </div>
      </template>
      <template v-else-if="display === 'Text'">
        <Alert variant="neutral" icon="shield_check">
          <TextGroup>
            <Text variant="subtitle" weight="bold">{{ getText('copyLink') }}</Text>
            <Text>{{ getText('copyLinkDescription') }}</Text>
          </TextGroup>
        </Alert>
        <CopyBlock :copyText="url" />
      </template>
    </FieldValue>
    <OTPInput
      :label="getText('verificationCode')"
      name="otp"
      :maxLength="otpLength"
      :description="getText('verificationCodePlaceholder')"
    />
  </div>
  <ButtonGroup>
    <Submit>{{ getText('enable') }}</Submit>
    <Reset>{{ getText('cancel') }}</Reset>
  </ButtonGroup>
  <FormError />
</template>
