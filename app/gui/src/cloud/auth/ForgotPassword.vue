<script setup lang="ts">
/**
 * @file The first half of the password reset. It asks Cognito to email a reset link, then returns
 * to the sign-in page. When the account's email is not confirmed yet, it offers to send the
 * confirmation email again.
 */
import Button from '$/components/Button/Button.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import { useForm } from '$/components/Form/useForm'
import Input from '$/components/Inputs/Input.vue'
import Link from '$/components/Link/Link.vue'
import { LOGIN_PATH } from '$/appUtils'
import { useBackends } from '$/providers/backends'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { z } from 'zod'
import AuthenticationPage from './AuthenticationPage.vue'
import { queryParam } from './queryParam'

const session = useSession()
const router = useRouter()
const toasts = useToasts()
const { getText } = useText()
const backends = useBackends()
const supportsOffline = computed(() => backends.localBackend != null)

const route = useRoute()
const initialEmail = queryParam(route, 'email')
const resendConfirmationButtonVisible = ref(false)

const form = useForm({
  schema: z.object({ email: z.string().email() }),
  defaultValues: { email: initialEmail ?? '' },
  onSubmit: async ({ email }) => {
    try {
      resendConfirmationButtonVisible.value = false
      await session.forgotPassword(email)
      void router.push(LOGIN_PATH)
      // A global toast, not `useToast`'s: it must outlive this page.
      toasts.show(getText('forgotPasswordSuccess'), { type: 'success' })
    } catch (error) {
      if (error instanceof Error && /verify your email first/.test(error.message)) {
        resendConfirmationButtonVisible.value = true
      }
      throw error
    }
  },
})

const email = computed(() => String(form.watch('email') ?? ''))
const loginLink = computed(
  () => `${LOGIN_PATH}?${new URLSearchParams({ email: email.value }).toString()}`,
)
</script>

<template>
  <AuthenticationPage
    :title="getText('forgotYourPassword')"
    :form="form"
    :supportsOffline="supportsOffline"
  >
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

    <Submit size="large" icon="arrow_right" iconPosition="end" fullWidth>
      {{ getText('sendLink') }}
    </Submit>

    <FormError />

    <Button
      v-if="resendConfirmationButtonVisible"
      variant="submit"
      size="large"
      fullWidth
      @press="() => session.resendSignUp(email)"
    >
      {{ getText('resendConfirmRegistrationEmail') }}
    </Button>

    <template #footer>
      <Link :to="loginLink" icon="navigate_back" :text="getText('goBackToLogin')" />
    </template>
  </AuthenticationPage>
</template>
