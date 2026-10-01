<script setup lang="ts">
/**
 * @file The second half of the password reset: the Vue port of the React `ResetPassword`, reached
 * from the emailed link with the `email` and `verification_code` parameters. It sets the new
 * password, then sends the user to `redirect_url` (by default the desktop app's sign-in deep link)
 * after three seconds, or at once with the "open in desktop" button. Without either parameter it
 * returns to the sign-in page with an error.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Button from '$/components/Button/Button.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import { useForm } from '$/components/Form/useForm'
import Input from '$/components/Inputs/Input.vue'
import Password from '$/components/Inputs/Password.vue'
import Link from '$/components/Link/Link.vue'
import Result from '$/components/Result/Result.vue'
import StepContent from '$/components/Stepper/StepContent.vue'
import Stepper from '$/components/Stepper/Stepper.vue'
import { useStepperState } from '$/components/Stepper/useStepperState'
import { LOGIN_PATH } from '$/appUtils'
import { PASSWORD_REGEX } from '$/cloud/validation'
import { useBackends } from '$/providers/backends'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { computed, onMounted, onScopeDispose } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import AuthenticationPage from './AuthenticationPage.vue'
import { queryParam } from './queryParam'
import { passwordWithPatternSchema } from './schemas'

const REDIRECT_TIMEOUT_MS = 3_000

const session = useSession()
const router = useRouter()
const toasts = useToasts()
const { getText } = useText()
const backends = useBackends()
const supportsOffline = computed(() => backends.localBackend != null)

const route = useRoute()
const defaultEmail = queryParam(route, 'email')
const defaultVerificationCode = queryParam(route, 'verification_code')
const redirectUrl = queryParam(route, 'redirect_url') ?? 'enso://auth/login'

/** An error toast, logged too: React's `toastAndLog`. */
function toastAndLog(textId: 'missingEmailError' | 'missingVerificationCodeError') {
  const message = `${getText(textId)}.`
  toasts.show(message, { type: 'error' })
  console.error(message)
}

onMounted(() => {
  if (defaultEmail == null) {
    toastAndLog('missingEmailError')
    void router.push(LOGIN_PATH)
  }
  if (defaultVerificationCode == null) {
    toastAndLog('missingVerificationCodeError')
    void router.push(LOGIN_PATH)
  }
})

const { stepperState } = useStepperState({ steps: 2, defaultStep: 0 })

let redirectTimer: ReturnType<typeof setTimeout> | undefined
onScopeDispose(() => clearTimeout(redirectTimer))

const form = useForm({
  schema: z
    .object({
      email: z.string().email(getText('invalidEmailValidationError')),
      verificationCode: z.string(),
      newPassword: passwordWithPatternSchema(getText),
      confirmNewPassword: z.string().trim(),
    })
    .superRefine((object, context) => {
      if (
        PASSWORD_REGEX.test(object.newPassword) &&
        object.newPassword !== object.confirmNewPassword
      ) {
        context.addIssue({
          path: ['confirmNewPassword'],
          code: 'custom',
          message: getText('passwordMismatchError'),
        })
      }
    }),
  defaultValues: {
    email: defaultEmail ?? '',
    verificationCode: defaultVerificationCode ?? '',
    newPassword: '',
    confirmNewPassword: '',
  },
  onSubmit: async ({ email, verificationCode, newPassword }) => {
    await session.resetPassword(email, verificationCode, newPassword)
    toasts.show(getText('resetPasswordSuccess'), { type: 'success' })
    stepperState.nextStep()
    redirectTimer = setTimeout(() => {
      window.location.href = redirectUrl
    }, REDIRECT_TIMEOUT_MS)
  },
})

const loginLink = `${LOGIN_PATH}?${new URLSearchParams({ email: defaultEmail ?? '' }).toString()}`
</script>

<template>
  <AuthenticationPage
    :title="getText('resetYourPassword')"
    :form="form"
    :supportsOffline="supportsOffline"
  >
    <Stepper :state="stepperState">
      <StepContent :index="0">
        <Input
          required
          readOnly
          hidden
          testId="email-input"
          name="email"
          type="email"
          autocomplete="email"
          :placeholder="getText('emailPlaceholder')"
        />

        <Input
          required
          readOnly
          hidden
          testId="verification-code-input"
          name="verificationCode"
          type="text"
          autocomplete="one-time-code"
          :placeholder="getText('confirmationCodePlaceholder')"
        />

        <Password
          autoFocus
          required
          testId="new-password-input"
          name="newPassword"
          :label="getText('newPasswordLabel')"
          autocomplete="new-password"
          icon="lock"
          :placeholder="getText('newPasswordPlaceholder')"
          :description="getText('passwordValidationMessage')"
        />

        <Password
          required
          testId="confirm-new-password-input"
          name="confirmNewPassword"
          :label="getText('confirmNewPasswordLabel')"
          autocomplete="new-password"
          icon="lock"
          :placeholder="getText('confirmNewPasswordPlaceholder')"
        />

        <Submit size="large" icon="arrow_right" fullWidth>
          {{ getText('reset') }}
        </Submit>

        <FormError />
      </StepContent>

      <StepContent :index="1">
        <Result
          :title="getText('resetPasswordSuccess')"
          status="success"
          :subtitle="getText('resetPasswordSuccessSubtitle')"
        >
          <ButtonGroup align="center">
            <Button :href="redirectUrl" size="large" variant="submit" icon="arrow_right" fullWidth>
              {{ getText('openInDesktop') }}
            </Button>
          </ButtonGroup>
        </Result>
      </StepContent>
    </Stepper>

    <template #footer>
      <Link :to="loginLink" icon="navigate_back" :text="getText('goBackToLogin')" />
    </template>
  </AuthenticationPage>
</template>
