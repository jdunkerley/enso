<script setup lang="ts">
/**
 * @file The content of the dialog confirming the deletion of the user's account: its form. A
 * successful deletion closes the dialog.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Form from '$/components/Form/Form.vue'
import Submit from '$/components/Form/Submit.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { onMounted, ref, type ComponentPublicInstance } from 'vue'

const { doDelete } = defineProps<{ doDelete: () => Promise<void> }>()

const { getText } = useText()
const formComponent = ref<ComponentPublicInstance>()

// The form takes the focus once the dialog has placed it.
onMounted(() =>
  requestAnimationFrame(() => {
    const element: unknown = formComponent.value?.$el
    if (element instanceof HTMLFormElement) element.focus({ preventScroll: true })
  }),
)
</script>

<template>
  <Form
    ref="formComponent"
    :schema="(z) => z.object({})"
    method="dialog"
    testId="confirm-delete-modal"
    tabindex="-1"
    @click.stop
    @submit="doDelete"
  >
    <Text class="text-balance text-center">
      {{ getText('confirmDeleteUserAccountWarning') }}
    </Text>
    <ButtonGroup class="w-min self-center">
      <Submit variant="delete">{{ getText('confirmDeleteUserAccountButtonLabel') }}</Submit>
    </ButtonGroup>
  </Form>
</template>
