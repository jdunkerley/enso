<script setup lang="ts">
/**
 * @file The sign-in page.
 *
 * Step one offers the identity providers and the email and password form; when Cognito answers
 * with a challenge, step two asks for the one-time code of the user's authenticator app. An
 * unconfirmed account is sent to the registration page's confirmation step. The email typed here
 * is carried to the registration and forgot-password pages in their links.
 */
import Button from '$/components/Button/Button.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import { useForm } from '$/components/Form/useForm'
import Input from '$/components/Inputs/Input.vue'
import OTPInput from '$/components/Inputs/OTPInput.vue'
import Password from '$/components/Inputs/Password.vue'
import Link from '$/components/Link/Link.vue'
import StepContent from '$/components/Stepper/StepContent.vue'
import Stepper from '$/components/Stepper/Stepper.vue'
import { useStepperState } from '$/components/Stepper/useStepperState'
import Text from '$/components/Text/Text.vue'
import { DASHBOARD_PATH, FORGOT_PASSWORD_PATH, REGISTRATION_PATH } from '$/appUtils'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { isOnElectron } from 'enso-common/src/utilities/detect'
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import AuthenticationPage from './AuthenticationPage.vue'
import { queryParam } from './queryParam'
import { passwordSchema } from './schemas'

declare global {
  interface Window {
    /** Set by the Electron end-to-end tests: see `app/electron-client/tests/electronTest.ts`. */
    passwordOverride?: string
  }
}

const OTP_LENGTH = 6

const router = useRouter()
const session = useSession()
const { getText } = useText()
const toasts = useToasts()
const route = useRoute()
const initialEmail = queryParam(route, 'email')

const { stepperState, nextStep, previousStep } = useStepperState({ steps: 2, defaultStep: 0 })

const form = useForm({
  schema: z.object({
    email: z
      .string()
      .min(1, getText('arbitraryFieldRequired'))
      .email(getText('invalidEmailValidationError')),
    password: passwordSchema(getText),
  }),
  defaultValues: { email: initialEmail ?? '', password: '' },
  onSubmit: async ({ email, password }, loginForm) => {
    // A special case for the Electron end-to-end tests: see `electronTest.ts`.
    const passwordOverride = window.passwordOverride
    try {
      const { challenge } = await session.signInWithPassword(
        email,
        passwordOverride ? passwordOverride : password,
      )
      if (challenge) {
        nextStep()
      } else {
        await router.push(DASHBOARD_PATH)
      }
    } catch (error) {
      const isUserNotConfirmed = error instanceof Error && /User not confirmed/.test(error.message)
      if (isUserNotConfirmed) {
        await router.push(
          `${REGISTRATION_PATH}?${new URLSearchParams({
            created: String(true),
            email: String(loginForm.getValues('email')),
          }).toString()}`,
        )
        return
      }
      throw error
    }
  },
})

const email = computed(() => String(form.watch('email') ?? ''))
const registrationLink = computed(
  () => `${REGISTRATION_PATH}?${new URLSearchParams({ email: email.value }).toString()}`,
)
const forgotPasswordLink = computed(
  () => `${FORGOT_PASSWORD_PATH}?${new URLSearchParams({ email: email.value }).toString()}`,
)

function handleFederatedSignInError(error: unknown) {
  const message =
    error instanceof Error && error.message.includes('Missing required user email value') ?
      getText('missingEmailError')
    : getText('registrationError')
  toasts.show(message, { type: 'error' })
}

/** A handler for an identity provider's button: the button shows as loading meanwhile. */
const signInWith = (signIn: () => Promise<void>) => () => signIn().catch(handleFederatedSignInError)
const signInWithGoogle = signInWith(() => session.signInWithGoogle())
const signInWithGitHub = signInWith(() => session.signInWithGitHub())
const signInWithMicrosoft = signInWith(() => session.signInWithMicrosoft())
const signInWithApple = signInWith(() => session.signInWithApple())

const otpForm = useForm({
  schema: z.object({ otp: z.string().min(OTP_LENGTH).max(OTP_LENGTH) }),
  defaultValues: { otp: '' },
  // A wrong code is cleared for another try, and its error stays under the code until the next
  // submission: a reset after the submission would clear the error too, and re-validating the code
  // as it is typed again would replace it.
  resetOnSubmit: false,
  reValidateMode: 'onSubmit',
  onSubmit: async ({ otp }, codeForm) => {
    const result = await session.confirmSignIn(otp)
    if (result.ok) {
      await router.push(DASHBOARD_PATH)
    } else {
      switch (result.val.code) {
        case 'NotAuthorizedException': {
          previousStep()
          form.setFormError(result.val.message)
          break
        }
        case 'CodeMismatchException': {
          codeForm.setValue('otp', '')
          codeForm.setError('otp', { message: getText('wrongOneTimeCode') })
          break
        }
        default: {
          throw result.val
        }
      }
    }
  },
})

// The code's boxes are disabled while it is checked: back to the first once a wrong one is cleared.
watch(
  () => otpForm.formState.isSubmitting,
  (isSubmitting) => {
    if (!isSubmitting && otpForm.getFieldState('otp').error != null) otpForm.setFocus('otp')
  },
  { flush: 'post' },
)

// The code's form starts afresh each time its step is shown.
watch(stepperState.currentStep, (step) => {
  if (step === 1) otpForm.reset()
})
</script>

<template>
  <AuthenticationPage :title="getText('loginToYourAccount')" :supportsOffline="isOnElectron()">
    <!-- The empty `step` slot keeps an (empty) row of step markers, and so its gap. -->
    <Stepper :state="stepperState">
      <template #step />
      <StepContent :index="0">
        <div class="flex flex-col gap-auth">
          <Button size="large" variant="outline" icon="google_color" @press="signInWithGoogle">
            {{ getText('signUpOrLoginWithGoogle') }}
          </Button>
          <Button size="large" variant="outline" icon="github_color" @press="signInWithGitHub">
            {{ getText('signUpOrLoginWithGitHub') }}
          </Button>
          <Button
            size="large"
            variant="outline"
            icon="microsoft_color"
            @press="signInWithMicrosoft"
          >
            {{ getText('signUpOrLoginWithMicrosoft') }}
          </Button>
          <Button size="large" variant="outline" icon="apple_color" @press="signInWithApple">
            {{ getText('signUpOrLoginWithApple') }}
          </Button>

          <Form :form="form" gap="medium">
            <Input
              autoFocus
              required
              testId="email-input"
              name="email"
              :label="getText('email')"
              type="email"
              autocomplete="email"
              icon="at"
              :placeholder="getText('emailPlaceholder')"
            />

            <div class="flex w-full flex-col">
              <Password
                required
                testId="password-input"
                name="password"
                :label="getText('password')"
                autocomplete="current-password"
                icon="lock"
                :placeholder="getText('passwordPlaceholder')"
              />

              <Button variant="link" :href="forgotPasswordLink" size="small" class="self-end">
                {{ getText('forgotYourPassword') }}
              </Button>
            </div>

            <Submit size="large" icon="arrow_right" iconPosition="end" fullWidth>
              {{ getText('login') }}
            </Submit>

            <FormError />
          </Form>
        </div>
      </StepContent>

      <StepContent :index="1">
        <Form :form="otpForm">
          <Text>{{ getText('enterTotp') }}</Text>

          <OTPInput
            autoFocus
            required
            testId="otp-input"
            name="otp"
            :label="getText('totp')"
            :maxLength="OTP_LENGTH"
          />

          <Submit size="large" icon="arrow_right" iconPosition="end" fullWidth>
            {{ getText('login') }}
          </Submit>

          <FormError />
        </Form>
      </StepContent>
    </Stepper>

    <template #footer>
      <Link :to="registrationLink" icon="create_account" :text="getText('dontHaveAnAccount')" />
    </template>
  </AuthenticationPage>
</template>
