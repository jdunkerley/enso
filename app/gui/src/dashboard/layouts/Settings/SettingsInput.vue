<script setup lang="ts">
/**
 * @file An input of a settings form: the Vue port of the React `Input` and `AriaInput`. Text,
 * email and password fields have their label beside them (`SETTINGS_FIELD_STYLES`); a combo box
 * keeps the default layout, as in React.
 */
import { SETTINGS_FIELD_STYLES } from '$/components/Form/variants'
import ComboBox from '$/components/Inputs/ComboBox.vue'
import Input from '$/components/Inputs/Input.vue'
import Password from '$/components/Inputs/Password.vue'
import Text from '$/components/Text/Text.vue'
import { settingsValue, type SettingsInputData } from '$/configurations/settings'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { computed } from 'vue'

const { data } = defineProps<{
  data: SettingsInputData<any>
}>()

const context = useSettingsContext()
const { getText } = useText()

const isEditable = computed(() => settingsValue(data.editable ?? true, context.value))
const hidden = computed(() => settingsValue(data.hidden ?? false, context.value))
const description = computed(() =>
  data.descriptionId != null ? getText(data.descriptionId) : undefined,
)
const comboBox = computed(() =>
  data.type === 'comboBox' ? settingsValue(data.comboBox, context.value) : undefined,
)
</script>

<template>
  <ComboBox
    v-if="comboBox != null"
    :name="data.name"
    :label="getText(data.nameId)"
    :description="description"
    :items="comboBox.items"
    :toOptionText="comboBox.optionText"
  >
    <template v-if="comboBox.addonStartText" #addonStart="{ item }">
      <Text class="w-20">{{ comboBox.addonStartText(item) }}</Text>
    </template>
  </ComboBox>
  <Password
    v-else-if="data.type === 'password'"
    :name="data.name"
    :fieldVariants="SETTINGS_FIELD_STYLES"
    :readOnly="!isEditable"
    :label="getText(data.nameId)"
    :hidden="hidden"
    :autocomplete="data.autoComplete"
    :description="description"
  />
  <Input
    v-else
    :name="data.name"
    :type="data.type ?? 'text'"
    :fieldVariants="SETTINGS_FIELD_STYLES"
    :readOnly="!isEditable"
    :label="getText(data.nameId)"
    :hidden="hidden"
    :autocomplete="data.autoComplete"
    :description="description"
  />
</template>
