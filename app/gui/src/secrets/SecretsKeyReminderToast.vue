<script setup lang="ts">
/**
 * @file The content of the toast that says the secrets key is over a year old: Rotate (which
 * opens Settings) or Remind me in a month. What each does is up to the caller.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'

const { onRotate, onSnooze } = defineProps<{
  onRotate: () => unknown
  onSnooze: () => unknown
}>()

const { getText } = useText()
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="secrets-key-reminder">
    <Text>{{ getText('secretsKeyOld') }}</Text>
    <ButtonGroup class="grow-0">
      <Button size="small" variant="outline" @press="onRotate">
        {{ getText('secretsRotateNow') }}
      </Button>
      <Button size="small" variant="outline" @press="onSnooze">
        {{ getText('secretsRemindInAMonth') }}
      </Button>
    </ButtonGroup>
  </div>
</template>
