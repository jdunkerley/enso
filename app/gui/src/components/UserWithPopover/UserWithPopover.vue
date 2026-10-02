<script setup lang="ts">
/**
 * @file A user's picture and name, as a button opening a popover with their email address (a
 * `mailto:` link, and a button copying it). The Vue counterpart of the React `UserWithPopover`,
 * which stays for its React callers (the drive table and the settings) until they are ported.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import CopyButton from '$/components/Button/CopyButton.vue'
import Popover from '$/components/Dialog/Popover.vue'
import { TEXT_WITH_ICON } from '$/components/patterns'
import ProfilePicture from '$/components/ProfilePicture/ProfilePicture.vue'
import Text from '$/components/Text/Text.vue'
import TextGroup from '$/components/Text/TextGroup.vue'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { OtherUser } from 'enso-common/src/services/Backend'

const { user, class: className } = defineProps<{
  user: OtherUser
  class?: string | undefined
}>()

const { getText } = useText()
const styles = TEXT_WITH_ICON()
</script>

<template>
  <Popover>
    <template #trigger>
      <Button variant="ghost" size="xxsmall" :class="twMerge('min-w-0', className)">
        <template #icon>
          <ProfilePicture
            :picture="user.profilePicture"
            :name="user.name"
            size="xxsmall"
            class="-mt-0.5"
          />
        </template>
        <Text variant="body-sm" truncate="1" nowrap>{{ user.name }}</Text>
      </Button>
    </template>
    <div :class="styles.base({ verticalAlign: 'top' })">
      <ProfilePicture :picture="user.profilePicture" :name="user.name" :class="styles.icon()" />
      <div :class="styles.text({ className: 'flex flex-col items-start' })">
        <TextGroup>
          <Text variant="body" class="leading-[1.2]" truncate="3">{{ user.name }}</Text>
          <ButtonGroup verticalAlign="center">
            <Button
              variant="link"
              size="small"
              icon="email"
              class="min-w-0"
              :tooltip="getText('sendEmail')"
              :href="`mailto:${user.email}`"
            >
              {{ user.email }}
            </Button>
            <CopyButton size="xsmall" class="min-w-0" :copyText="user.email" />
          </ButtonGroup>
        </TextGroup>
      </div>
    </div>
  </Popover>
</template>
