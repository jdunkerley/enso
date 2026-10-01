<script setup lang="ts">
/**
 * @file The layout of the authentication pages: the Vue port of the React `AuthenticationPage`
 * (and of the `Page` around it), with the same classes.
 *
 * The page is a centred card holding the default slot, under an optional `title`, and the `footer`
 * slot below it. With a `form` (from `useForm`), the card is that form's `<form>` element, as in
 * React. While offline, a notice above the card says that signing in is unavailable, and, with
 * `supportsOffline`, that the local projects still are.
 *
 * Like the React `Page`, it shows the info bar at the top right (still React, mounted through
 * `reactComponent`) and mounts the modal host, loaded on first use.
 */
import { InfoBar as InfoBarReact } from '#/layouts/InfoBar'
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import Form from '$/components/Form/Form.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import { reactComponent } from '@/util/react'
import { defineAsyncComponent } from 'vue'

const {
  title,
  supportsOffline = false,
  form,
  testId,
} = defineProps<{
  title?: string | undefined
  supportsOffline?: boolean | undefined
  /** Makes the card this form's `<form>` element. */
  form?: AnyFormInstance | undefined
  testId?: string | undefined
}>()

const InfoBar = reactComponent(InfoBarReact)
/** Loaded on demand, as the React `Page` loads it: its error boundary pulls in Reka. */
const ModalHost = defineAsyncComponent(() => import('$/components/ModalHost/ModalHost.vue'))

const CONTAINER_CLASSES = DIALOG_BACKGROUND({
  className: 'flex w-full flex-col gap-4 rounded-4xl p-12',
})

const OFFLINE_ALERT_CLASSES = DIALOG_BACKGROUND({
  className: 'flex mt-auto rounded-sm items-center justify-center p-4 px-12 rounded-4xl',
})

const { getText } = useText()
const isOnline = useIsOnline()
</script>

<template>
  <div class="flex h-full w-full flex-col overflow-y-auto">
    <div
      class="relative m-auto grid h-auto w-full max-w-md flex-none grid-cols-1 grid-rows-[1fr_auto_1fr] flex-col items-center justify-center gap-auth text-sm text-primary"
      :data-testid="testId"
    >
      <div v-if="!isOnline" :class="OFFLINE_ALERT_CLASSES">
        <Text class="text-center" balance elementType="p">
          {{ getText('loginUnavailableOffline') }}
          {{ supportsOffline ? getText('loginUnavailableOfflineLocal') : '' }}
        </Text>
      </div>

      <div class="row-start-2 row-end-3 flex w-full flex-col items-center gap-auth">
        <Form v-if="form != null" :form="form" :class="CONTAINER_CLASSES">
          <Heading v-if="title != null" :level="1" class="self-center" weight="medium">
            {{ title }}
          </Heading>
          <slot />
        </Form>
        <div v-else :class="CONTAINER_CLASSES">
          <Heading v-if="title != null" :level="1" class="self-center" weight="medium">
            {{ title }}
          </Heading>
          <slot />
        </div>
        <slot name="footer" />
      </div>
    </div>
  </div>
  <div class="fixed right top z-1 m-2.5 text-primary">
    <InfoBar />
  </div>
  <ModalHost />
</template>
