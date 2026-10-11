<script setup lang="ts">
/**
 * @file The user bar's "Upgrade" button (#83), shown to an organization's admin on the free plan:
 * a link to the subscription page, followed in the app.
 */
import Button from '$/components/Button/Button.vue'
import { SUBSCRIBE_PATH } from '$/appUtils'
import { useText } from '$/providers/text'
import { useRouter } from 'vue-router'

const { getText } = useText()
const router = useRouter()

function navigate(event: MouseEvent) {
  // A client-side navigation, through the router.
  event.preventDefault()
  void router.push(SUBSCRIBE_PATH)
}
</script>

<template>
  <Button variant="primary" size="medium" :href="SUBSCRIBE_PATH" @press="navigate">
    {{ getText('upgrade') }}
  </Button>
</template>
