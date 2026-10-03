<script setup lang="ts">
/**
 * @file The invitation dialog's last step: who was invited, the invitation link to copy, and the
 * buttons to go to the Members settings tab (unless it is open already) and to close. The Vue port
 * of the React `InviteUsersSuccess`.
 */
import { SEARCH_PARAMS_PREFIX } from '$/appUtils'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import CopyBlock from '$/components/CopyBlock/CopyBlock.vue'
import Result from '$/components/Result/Result.vue'
import SettingsTabType from '$/configurations/settingsTabs'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * The number of addresses listed in the title. With more, it says how many were invited instead.
 */
const MAX_EMAILS_DISPLAYED = 4

const SETTINGS_TAB_PARAM = `${SEARCH_PARAMS_PREFIX}SettingsTab`
const MEMBERS_TAB_VALUE = JSON.stringify(SettingsTabType.members)

const { emails, invitationLink, onClose } = defineProps<{
  emails: readonly string[]
  invitationLink: string
  onClose?: (() => void) | undefined
}>()

const { getText, locale } = useText()
const route = useRoute()
const router = useRouter()

const title = computed(() =>
  emails.length > MAX_EMAILS_DISPLAYED ?
    getText('inviteManyUsersSuccess', emails.length)
  : getText(
      'inviteSuccess',
      new Intl.ListFormat(locale, { type: 'conjunction', style: 'long' }).format(emails),
    ),
)

const isUserOnMembersPage = computed(
  () => route.name === 'settings' && route.query[SETTINGS_TAB_PARAM] === MEMBERS_TAB_VALUE,
)

function goToMembersPage() {
  onClose?.()
  void router.push({
    name: 'settings',
    query: { ...route.query, [SETTINGS_TAB_PARAM]: MEMBERS_TAB_VALUE },
  })
}
</script>

<template>
  <Result status="success" :subtitle="getText('inviteUserLinkCopyDescription')" :title="title">
    <CopyBlock :copyText="invitationLink" class="mb-6 mt-1" />
    <ButtonGroup v-if="onClose" gap="medium" :align="isUserOnMembersPage ? 'center' : 'end'">
      <Button
        v-if="!isUserOnMembersPage"
        variant="outline"
        icon="arrow_right"
        size="medium"
        iconPosition="end"
        @press="goToMembersPage"
      >
        {{ getText('goToMembersPage') }}
      </Button>
      <Button variant="primary" size="medium" @press="onClose">
        {{ getText('closeModalShortcut') }}
      </Button>
    </ButtonGroup>
  </Result>
</template>
