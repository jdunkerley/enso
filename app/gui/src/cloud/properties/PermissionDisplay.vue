<script setup lang="ts">
/**
 * @file A user's name in a coloured pill showing their permission on an asset, as the Properties
 * tab uses it (never pressable, so always a disabled button).
 */
import Button from '$/components/Button/Button.vue'
import Text from '$/components/Text/Text.vue'
import { PERMISSION_CLASS_NAME } from '$/cloud/permissionsClasses'
import { twMerge } from '$/utils/style/tailwindMerge'
import {
  FROM_PERMISSION_ACTION,
  Permission,
  type PermissionAction,
} from 'enso-common/src/utilities/permissions'
import { computed } from 'vue'

const { action } = defineProps<{ action: PermissionAction }>()

const permission = computed(() => FROM_PERMISSION_ACTION[action])
const docs = computed(() => 'docs' in permission.value && permission.value.docs)
const execute = computed(() => 'execute' in permission.value && permission.value.execute)
const isPill = computed(
  () =>
    permission.value.type === Permission.owner ||
    permission.value.type === Permission.admin ||
    permission.value.type === Permission.edit,
)
</script>

<template>
  <Button
    v-if="isPill"
    size="custom"
    variant="custom"
    isDisabled
    :class="
      twMerge(
        'inline-block h-6 whitespace-nowrap rounded-full px-[7px]',
        PERMISSION_CLASS_NAME[permission.type],
      )
    "
  >
    <Text truncate="1" class="max-w-24 text-inherit"><slot /></Text>
  </Button>
  <Button
    v-else
    size="custom"
    variant="custom"
    isDisabled
    class="relative inline-block whitespace-nowrap rounded-full"
  >
    <div
      v-if="docs"
      class="absolute size-full rounded-full border-2 border-permission-docs clip-path-top"
    />
    <div
      v-if="execute"
      class="absolute size-full rounded-full border-2 border-permission-exec clip-path-bottom"
    />
    <div
      :class="
        twMerge(
          'm-1 flex h-6 items-center rounded-full px-[7px]',
          PERMISSION_CLASS_NAME[permission.type],
          (docs || execute) && 'm-1',
        )
      "
    >
      <Text truncate="1" class="max-w-24 text-inherit"><slot /></Text>
    </div>
  </Button>
</template>
