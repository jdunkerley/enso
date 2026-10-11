<script setup lang="ts">
/**
 * @file The page of a user whose account is marked for deletion. They can restore the account, or
 * sign out.
 */
import Button from '$/components/Button/Button.vue'
import Icon from '$/components/Icon/Icon.vue'
import { LOGIN_PATH } from '$/appUtils'
import { useAuth } from '$/providers/auth'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { useRouter } from 'vue-router'

const { getText } = useText()
const auth = useAuth()
const session = useSession()
const router = useRouter()

async function signOut() {
  await session.signOut()
  void router.push(LOGIN_PATH)
}
</script>

<template>
  <div class="flex h-full w-full overflow-auto">
    <div class="flex min-h-96 w-full flex-col items-center justify-center">
      <Icon icon="untrash" class="mb-4 h-12 w-12" />
      <h1 class="mb-4 text-3xl">{{ getText('restoreAccount') }}</h1>

      <p class="max-w-[36rem] text-balance text-center">
        {{ getText('restoreAccountDescription') }}
      </p>

      <div class="mt-8 flex items-center gap-8">
        <Button
          variant="icon"
          class="flex items-center justify-center gap-2 rounded-full bg-blue-600 px-4 py-auth-input-y text-white transition-all duration-auth selectable enabled:active"
          @press="() => auth.restoreUser()"
        >
          {{ getText('restoreAccountSubmit') }}
        </Button>

        <Button variant="icon" @press="signOut">
          {{ getText('signOutShortcut') }}
        </Button>
      </div>
    </div>
  </div>
</template>
