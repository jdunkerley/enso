<script lang="ts">
/**
 * @file The sign-up page: the Vue port of the React `Registration`, and of the
 * `RegistrationPage.vue` that hosted it (its data loader is here now).
 *
 * Step one creates the account, after the user agrees to the Terms of Service and the Privacy
 * Policy. Step two (straight away with `?created=true`, which the sign-in page sets for an
 * unconfirmed account) asks the user to confirm their email address: through the link in the
 * email, which signs them in here within five seconds, or by typing its code. It can send the
 * email again. A `redirect_to` parameter is kept as the `loginRedirect` for after signing in.
 */
import { useUserAgreements } from '$/composables/userAgreements'
import type { DataLoader } from '$/router'
import { useQueryClient } from '@tanstack/vue-query'
import { Ok } from 'enso-common/src/utilities/data/result'

type Props = { userAgreedFn: () => void }

export const dataLoader: DataLoader<Props> = {
  async beforeRouteEnter() {
    const queryClient = useQueryClient()
    const { userAgreed } = await useUserAgreements(queryClient)
    return Ok({ userAgreedFn: userAgreed })
  },
}
</script>

<script setup lang="ts">
import Alert from '$/components/Alert/Alert.vue'
import Button from '$/components/Button/Button.vue'
import Checkbox from '$/components/Checkbox/Checkbox.vue'
import CheckboxGroup from '$/components/Checkbox/CheckboxGroup.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import { useForm } from '$/components/Form/useForm'
import Input from '$/components/Inputs/Input.vue'
import Password from '$/components/Inputs/Password.vue'
import Link from '$/components/Link/Link.vue'
import StepContent from '$/components/Stepper/StepContent.vue'
import Stepper from '$/components/Stepper/Stepper.vue'
import { useStepperState } from '$/components/Stepper/useStepperState'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { DASHBOARD_PATH, LOGIN_PATH } from '$/appUtils'
import { useAuth } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import LocalStorage from '$/utils/LocalStorage'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import AuthenticationPage from './AuthenticationPage.vue'
import { queryParam } from './queryParam'
import { passwordWithPatternSchema } from './schemas'

const props = defineProps<Props>()

const CONFIRM_SIGN_IN_INTERVAL_MS = 5_000
const SESSION_POLL_INTERVAL_MS = 3_000

const session = useSession()
const auth = useAuth()
const router = useRouter()
const { getText } = useText()
const route = useRoute()
const backends = useBackends()
const supportsOffline = computed(() => backends.localBackend != null)

const isUserCreated = queryParam(route, 'created')
const initialEmail = queryParam(route, 'email')
const organizationId = queryParam(route, 'organization_id')
const isManualCodeEntry = ref(false)

const { stepperState } = useStepperState({ steps: 2, defaultStep: isUserCreated ? 1 : 0 })

const form = useForm({
  defaultValues: { email: initialEmail ?? '', agreedToTos: [], agreedToPrivacyPolicy: [] },
  resetOnSubmit: false,
  schema: z
    .object({
      email: z.string().email(getText('invalidEmailValidationError')),
      password: passwordWithPatternSchema(getText),
      confirmPassword: z.string(),
      agreedToTos: z
        .array(z.string())
        .min(1, { message: getText('licenseAgreementCheckboxError') }),
      agreedToPrivacyPolicy: z
        .array(z.string())
        .min(1, { message: getText('privacyPolicyCheckboxError') }),
    })
    .superRefine((object, context) => {
      if (object.password !== object.confirmPassword) {
        context.addIssue({
          path: ['confirmPassword'],
          code: 'custom',
          message: getText('passwordMismatchError'),
        })
      }
    }),
  onSubmit: async ({ email, password }) => {
    props.userAgreedFn()
    await session.signUp(email, password, organizationId ?? null)
    stepperState.nextStep()
  },
})

const email = computed(() => String(form.watch('email') ?? ''))
const password = () => String(form.getValues('password') ?? '')
const loginLink = computed(
  () => `${LOGIN_PATH}?${new URLSearchParams({ email: email.value }).toString()}`,
)

watch(
  () => queryParam(route, 'redirect_to'),
  (redirectTo) => {
    const localStorage = LocalStorage.getInstance()
    if (redirectTo != null) {
      localStorage.set('loginRedirect', redirectTo)
    } else {
      localStorage.delete('loginRedirect')
    }
  },
  { immediate: true },
)

// While the user is asked to confirm their email, try to sign in every few seconds: confirming it
// through the emailed link lets the sign-in succeed.
watch(
  stepperState.currentStep,
  (step, _old, onCleanup) => {
    if (step !== 1) return
    const interval = setInterval(() => {
      void session.signInWithPassword(email.value, password()).catch(() => {})
    }, CONFIRM_SIGN_IN_INTERVAL_MS)
    onCleanup(() => clearInterval(interval))
  },
  { immediate: true },
)

const codeForm = useForm({
  schema: z.object({ verificationCode: z.string().min(1) }),
  onSubmit: async ({ verificationCode }) => {
    await session.confirmSignUp(email.value, verificationCode)
    await session.signInWithPassword(email.value, password())
    while (true) {
      if ((await auth.refetchSession()).data) {
        await router.push(DASHBOARD_PATH)
        break
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, SESSION_POLL_INTERVAL_MS))
      }
    }
  },
})

const eulaUrl = `${$config.HOST}/eula`
const privacyPolicyUrl = `${$config.HOST}/privacy`
</script>

<template>
  <AuthenticationPage :supportsOffline="supportsOffline">
    <!-- The empty `step` slot keeps React's (empty) row of step markers, and so its gap. -->
    <Stepper :state="stepperState">
      <template #step />
      <StepContent :index="0">
        <Heading :level="1" balance class="mb-4 text-center">
          {{ getText('createANewAccount') }}
        </Heading>

        <Form :form="form">
          <Input
            autoFocus
            required
            testId="email-input"
            name="email"
            :label="getText('emailLabel')"
            type="email"
            autocomplete="email"
            icon="at"
            :placeholder="getText('emailPlaceholder')"
          />

          <Password
            required
            testId="password-input"
            name="password"
            :label="getText('passwordLabel')"
            autocomplete="new-password"
            icon="lock"
            :placeholder="getText('passwordPlaceholder')"
            :description="getText('passwordValidationMessage')"
          />

          <Password
            required
            testId="confirm-password-input"
            name="confirmPassword"
            :label="getText('confirmPasswordLabel')"
            autocomplete="new-password"
            icon="lock"
            :placeholder="getText('confirmPasswordPlaceholder')"
          />

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

          <Submit size="large" icon="create_account" fullWidth>
            {{ getText('register') }}
          </Submit>

          <FormError />
        </Form>
      </StepContent>

      <StepContent :index="1">
        <Heading :level="1" balance class="mb-4 text-center">
          {{ getText(isUserCreated ? 'registrationAlreadyConfirmed' : 'confirmRegistration') }}
        </Heading>

        <div class="flex flex-col gap-4 text-start">
          <div class="flex flex-col">
            <Text disableLineHeightCompensation>
              {{ getText('confirmRegistrationInstruction', email) }}
            </Text>
            <ul>
              <li>
                <Text disableLineHeightCompensation>
                  {{ getText('confirmRegistrationMethod1') }}
                </Text>
              </li>
              <li>
                <Text disableLineHeightCompensation>
                  {{ getText('confirmRegistrationMethod2') }}
                </Text>
              </li>
            </ul>
          </div>

          <Alert variant="neutral">
            <Text>{{ getText('confirmRegistrationSpam') }}</Text>
          </Alert>

          <Button v-if="!isManualCodeEntry" variant="outline" @press="isManualCodeEntry = true">
            {{ getText('enterCodeManually') }}
          </Button>

          <Form v-if="isManualCodeEntry" :form="codeForm">
            <Input
              name="verificationCode"
              :label="getText('confirmRegistrationVerificationCodeLabel')"
            />

            <Submit fullWidth />

            <FormError />
          </Form>

          <Button variant="submit" @press="() => session.resendSignUp(email)">
            {{ getText('resendConfirmRegistrationEmail') }}
          </Button>
        </div>
      </StepContent>
    </Stepper>

    <template #footer>
      <Link :to="loginLink" icon="navigate_back" :text="getText('alreadyHaveAnAccount')" />
    </template>
  </AuthenticationPage>
</template>
