<script setup lang="ts">
/**
 * @file The page the email-confirmation link opens: the Vue port of the React
 * `ConfirmRegistration`. It confirms the account with the link's `email` and `verification_code`
 * at once, then sends the user to `redirect_url` (by default the dashboard) after five seconds.
 * Without either parameter it returns to the sign-in page.
 *
 * The result's title (confirming, confirmed, failed) is the page's only, level-1, heading. The React
 * page had an empty `h1` above it instead (#178).
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Button from '$/components/Button/Button.vue'
import Result from '$/components/Result/Result.vue'
import Heading from '$/components/Text/Heading.vue'
import { DASHBOARD_PATH, LOGIN_PATH } from '$/appUtils'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useMutation } from '@tanstack/vue-query'
import { computed, onMounted, onScopeDispose } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthenticationPage from './AuthenticationPage.vue'
import { queryParam } from './queryParam'

const REDIRECT_TIMEOUT_MS = 5_000

const session = useSession()
const router = useRouter()
const { getText } = useText()

const route = useRoute()
const email = queryParam(route, 'email')
const verificationCode = queryParam(route, 'verification_code')
const url = queryParam(route, 'redirect_url') ?? DASHBOARD_PATH

let redirectTimer: ReturnType<typeof setTimeout> | undefined
onScopeDispose(() => clearTimeout(redirectTimer))

const confirmRegistration = useMutation({
  mutationKey: ['confirmRegistration'],
  mutationFn: (params: { email: string; verificationCode: string }) =>
    session.confirmSignUp(params.email, params.verificationCode),
  onSuccess: () => {
    redirectTimer = setTimeout(() => {
      window.location.href = url
    }, REDIRECT_TIMEOUT_MS)
  },
})

const hasParams = email != null && verificationCode != null
if (!hasParams) void router.replace(LOGIN_PATH)

/** Confirm the account. A failure shows as the mutation's error state. */
async function confirm() {
  if (email == null || verificationCode == null) return
  await confirmRegistration.mutateAsync({ email, verificationCode }).catch(() => {})
}

onMounted(() => {
  if (hasParams && confirmRegistration.status.value === 'idle') void confirm()
})

const texts = computed(() => {
  const status = confirmRegistration.status.value
  const textsByStatus = {
    pending: ['confirmRegistrationTitlePending', 'confirmRegistrationSubtitlePending'],
    error: ['confirmRegistrationTitleError', 'confirmRegistrationSubtitleError'],
    success: ['confirmRegistrationTitleSuccess', 'confirmRegistrationSubtitleSuccess'],
    idle: ['confirmRegistrationTitleIdle', 'confirmRegistrationSubtitleIdle'],
  } as const satisfies Record<typeof status, readonly [string, string]>
  const [title, subtitle] = textsByStatus[status]
  return { title: getText(title), subtitle: getText(subtitle) }
})
</script>

<template>
  <!-- No page title: the result's title is the page's heading, at level 1 but in its own style. -->
  <AuthenticationPage v-if="hasParams">
    <Result :status="confirmRegistration.status.value" :subtitle="texts.subtitle">
      <template #title>
        <Heading :level="1" variant="subtitle">{{ texts.title }}</Heading>
      </template>
      <ButtonGroup align="center" :buttonVariants="{ variant: 'submit' }">
        <Button v-if="confirmRegistration.isIdle.value" @press="confirm">
          {{ getText('confirm') }}
        </Button>
        <Button v-if="confirmRegistration.isError.value" @press="confirm">
          {{ getText('retry') }}
        </Button>
        <Button v-if="confirmRegistration.isSuccess.value" :href="url">
          {{ getText('openInDesktop') }}
        </Button>
      </ButtonGroup>
    </Result>
  </AuthenticationPage>
</template>
