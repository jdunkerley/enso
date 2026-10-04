<script setup lang="ts">
/**
 * @file An editor for a value described by a JSON schema, built from the schema: the Vue port of the
 * React `JSONSchemaInput`, with the same markup and classes. The datalink editor
 * (`DatalinkInput.vue`) is this over the datalink schema.
 *
 * - A `const` schema shows nothing: the value cannot change.
 * - `string` is a text field; `format: "enso-secret"` a combo box of the user's secrets,
 *   `format: "enso-file"` a path with the cloud file browser (`FilePathInput.vue`).
 * - `number` and `integer` are number fields; `boolean` a checkbox.
 * - `object` lists its properties that are not constant, each under a button that adds or removes
 *   an optional one.
 * - `$ref` shows the referenced schema; `anyOf` a list choosing one of its members (the one the
 *   value matches), and that member's editor; `allOf` every member's editor.
 *
 * A part whose value fails its validator (`getValidator(path)`) gets a red border, and the
 * schema's description under it. The parts are wrapped in a column only when there are several,
 * as React returned a lone child unwrapped.
 *
 * Kept as React had it: a secret's description shows twice when it is invalid (inside the combo
 * box's column and after it), and the `boolean` case is a plain checkbox. No datalink schema
 * reaches it (every boolean there is a `const`); React's was a form field named `input`, whose
 * state replaced the value it was given.
 */
import Button from '$/components/Button/Button.vue'
import Checkbox from '$/components/Checkbox/Checkbox.vue'
import Form from '$/components/Form/Form.vue'
import ComboBox from '$/components/Inputs/ComboBox.vue'
import Dropdown from '$/components/Inputs/Dropdown.vue'
import Text from '$/components/Text/Text.vue'
import { useAuth } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { backendBaseOptions, backendQueryKey } from '$/utils/backendQuery'
import { constantValueOfSchema, getSchemaName, lookupDef } from '$/utils/jsonSchema'
import { twJoin, twMerge } from '$/utils/style/tailwindMerge'
import { useQuery } from '@tanstack/vue-query'
import { asObject, singletonObjectOrNull } from 'enso-common/src/utilities/data/object'
import { computed, h, ref, watch, type FunctionalComponent } from 'vue'
import FilePathInput from './FilePathInput.vue'
import SchemaTextInput from './SchemaTextInput.vue'

const props = withDefaults(
  defineProps<{
    dropdownTitle?: string | undefined
    defs: Record<string, object>
    readOnly?: boolean | undefined
    schema: object
    path: string
    getValidator: (path: string) => (value: unknown) => boolean
    noBorder?: boolean | undefined
    isAbsent?: boolean | undefined
    value: unknown
    onChange: (value: unknown) => void
  }>(),
  { readOnly: false, noBorder: false, isAbsent: false },
)

const { getText } = useText()
const auth = useAuth()
const { remoteBackend } = useBackends()

/** Wraps its content in a column when `wrap`, or renders it as it is. */
const Parts: FunctionalComponent<{ wrap: boolean }> = (wrapProps, { slots }) =>
  wrapProps.wrap ? h('div', { class: 'flex flex-col gap-1' }, slots.default?.()) : slots.default?.()

const noChildBorder = computed(() => props.dropdownTitle != null)
const schemaType = computed(() => ('type' in props.schema ? props.schema.type : undefined))
const schemaFormat = computed(() => ('format' in props.schema ? props.schema.format : undefined))
const isSecret = computed(
  () => schemaType.value === 'string' && schemaFormat.value === 'enso-secret',
)

// The functionality for inputting `enso-secret`s SHOULD be injected using a plugin, but it is more
// convenient to avoid having plugin infrastructure. Keys and options as React's
// `backendQueryOptions(remoteBackend, 'listSecrets', [])`.
const secretsQuery = useQuery(
  computed(() => ({
    ...backendBaseOptions(remoteBackend),
    queryKey: backendQueryKey(remoteBackend, 'listSecrets', []),
    queryFn: () => remoteBackend.listSecrets(),
    staleTime: 0,
    meta: { persist: true },
    enabled: isSecret.value,
  })),
)
const userPathPrefix = computed(() => `enso://Users/${auth.session?.user.name}/`)
const secretAutocompleteItems = computed(() =>
  (secretsQuery.data.value ?? []).map((secret) =>
    secret.path.startsWith(userPathPrefix.value) ?
      secret.path.replace(userPathPrefix.value, 'enso://~/')
    : secret.path,
  ),
)

const isInvalid = computed(() => !props.isAbsent && !props.getValidator(props.path)(props.value))
const validationErrorClass = computed(() =>
  isInvalid.value ? 'border border-danger focus:border-danger focus:outline-danger' : undefined,
)
const error = computed(() =>
  isInvalid.value && 'description' in props.schema && typeof props.schema.description === 'string' ?
    props.schema.description
  : undefined,
)

const isConst = computed(() => 'const' in props.schema)

// === object ===

const propertyDefinitions = computed(() => {
  const properties = 'properties' in props.schema ? (asObject(props.schema.properties) ?? {}) : {}
  return Object.entries(properties).flatMap(([key, value]: [string, unknown]) =>
    singletonObjectOrNull(value).map((childSchema) => ({ key, schema: childSchema })),
  )
})
const requiredProperties = computed(() =>
  'required' in props.schema && Array.isArray(props.schema.required) ?
    (props.schema.required as unknown[])
  : [],
)
const showsObject = computed(
  () =>
    schemaType.value === 'object' && constantValueOfSchema(props.defs, props.schema).length !== 1,
)
const isConstant = (childSchema: object) =>
  constantValueOfSchema(props.defs, childSchema).length === 1
const isOptional = (key: string) => !requiredProperties.value.includes(key) || props.isAbsent
const isPresent = (key: string) =>
  !props.isAbsent && props.value != null && typeof props.value === 'object' && key in props.value
const propertyValue = (key: string) => ((props.value ?? {}) as Record<string, unknown>)[key] ?? null

function toggleProperty(key: string, childSchema: object) {
  if (!isOptional(key)) return
  const value = props.value
  if (value != null && typeof value === 'object' && key in value) {
    const { [key]: _removed, ...newValue } = value as Record<string, unknown>
    props.onChange(newValue)
  } else {
    props.onChange({
      ...(value as object | null),
      [key]: constantValueOfSchema(props.defs, childSchema, true)[0],
    })
  }
}

function setProperty(key: string, newValue: unknown) {
  const fullObject = props.value ?? constantValueOfSchema(props.defs, props.schema, true)[0]
  props.onChange(
    (
      typeof fullObject === 'object' &&
        (fullObject as Readonly<Record<string, unknown>>)[key] === newValue
    ) ?
      fullObject
    : { ...(fullObject as object), [key]: newValue },
  )
}

// === $ref ===

const referencedSchema = computed(() =>
  '$ref' in props.schema && typeof props.schema.$ref === 'string' ?
    lookupDef(props.defs, props.schema)
  : null,
)
const ref$ = computed(() =>
  '$ref' in props.schema && typeof props.schema.$ref === 'string' ? props.schema.$ref : '',
)

// === anyOf ===

const anyOfSchemas = computed(() =>
  'anyOf' in props.schema && Array.isArray(props.schema.anyOf) ?
    props.schema.anyOf.flatMap(singletonObjectOrNull)
  : null,
)
const selectedChildIndex = ref(0)
/**
 * Follow the value: when it does not match the chosen member, choose the first that it matches (or
 * the first member, when none is chosen). React did this as it rendered.
 */
function syncSelectedChild() {
  const childSchemas = anyOfSchemas.value
  if (childSchemas == null || props.value == null) return
  const selected = childSchemas[selectedChildIndex.value]
  const selectedPath = `${props.path}/anyOf/${selectedChildIndex.value}`
  if (selected != null && props.getValidator(selectedPath)(props.value) === true) return
  const newIndexRaw = childSchemas.findIndex((_, index) =>
    props.getValidator(`${props.path}/anyOf/${index}`)(props.value),
  )
  const newIndex = selected == null && newIndexRaw === -1 ? 0 : newIndexRaw
  if (newIndex !== -1 && newIndex !== selectedChildIndex.value) selectedChildIndex.value = newIndex
}
syncSelectedChild()
watch(() => [props.value, anyOfSchemas.value], syncSelectedChild, { flush: 'sync' })

const selectedChildSchema = computed(() => anyOfSchemas.value?.[selectedChildIndex.value])
const anyOfClass = computed(() =>
  twMerge(
    'flex flex-col',
    props.dropdownTitle == null && 'gap-1',
    (selectedChildSchema.value == null ?
      []
    : constantValueOfSchema(props.defs, selectedChildSchema.value)
    ).length === 0 && 'w-full',
  ),
)

function selectChild(index: number | null) {
  const childSchema = index == null ? undefined : anyOfSchemas.value?.[index]
  if (index == null || childSchema == null) return
  selectedChildIndex.value = index
  props.onChange(constantValueOfSchema(props.defs, childSchema, true)[0] ?? null)
}

// === allOf ===

const allOfSchemas = computed(() =>
  'allOf' in props.schema && Array.isArray(props.schema.allOf) ?
    props.schema.allOf.flatMap(singletonObjectOrNull)
  : [],
)

/** How many parts it shows: a lone part is not wrapped. */
const partCount = computed(() => {
  if (isConst.value) return 0
  let count = 0
  if (schemaType.value === 'string') count += isSecret.value && error.value != null ? 2 : 1
  else if (
    schemaType.value === 'number' ||
    schemaType.value === 'integer' ||
    schemaType.value === 'boolean'
  )
    count += 1
  else if (showsObject.value) count += 1
  if (referencedSchema.value != null) count += 1
  if (anyOfSchemas.value != null) count += 1
  count += allOfSchemas.value.length
  return count
})
</script>

<template>
  <Parts v-if="!isConst && partCount > 0" :wrap="partCount > 1">
    <template v-if="schemaType === 'string'">
      <template v-if="schemaFormat === 'enso-secret'">
        <div class="flex flex-col">
          <Form
            :schema="(z) => z.object({ path: z.string() })"
            :defaultValues="{
              path:
                typeof value === 'string' ?
                  value.startsWith(userPathPrefix) ?
                    value.replace(userPathPrefix, 'enso://~/')
                  : value
                : '',
            }"
            :onChange="
              (_key: string, newValue: unknown) => {
                if (newValue !== value) onChange(newValue)
              }
            "
          >
            <ComboBox
              name="path"
              :items="secretAutocompleteItems"
              :placeholder="getText('enterSecretPath')"
              :class="twMerge('rounded-2xl', validationErrorClass)"
            />
          </Form>
          <Text v-if="error != null" class="px-2 text-danger">{{ error }}</Text>
        </div>
        <Text v-if="error != null" class="px-2 text-danger">{{ error }}</Text>
      </template>
      <FilePathInput
        v-else-if="schemaFormat === 'enso-file'"
        :readOnly="readOnly"
        :value="typeof value === 'string' ? value : ''"
        :validationErrorClass="validationErrorClass"
        :error="error"
        @change="onChange"
      />
      <SchemaTextInput
        v-else
        type="text"
        :readOnly="readOnly"
        :value="value"
        :validationErrorClass="validationErrorClass"
        :error="error"
        @change="onChange"
      />
    </template>
    <SchemaTextInput
      v-else-if="schemaType === 'number' || schemaType === 'integer'"
      :type="schemaType"
      :readOnly="readOnly"
      :value="value"
      :validationErrorClass="validationErrorClass"
      :error="error"
      @change="onChange"
    />
    <div v-else-if="schemaType === 'boolean'" class="flex flex-col">
      <Checkbox
        :isReadOnly="readOnly"
        :isSelected="typeof value === 'boolean' && value"
        @update:isSelected="onChange"
      />
      <Text v-if="error != null" class="px-2 text-danger">{{ error }}</Text>
    </div>
    <div
      v-else-if="showsObject"
      :class="twJoin('rounded-default', !noBorder && 'border-0.5 border-primary/20 p-2')"
    >
      <template v-for="definition in propertyDefinitions" :key="definition.key">
        <template v-if="!isConstant(definition.schema)">
          <Button
            size="custom"
            variant="custom"
            :isDisabled="!isOptional(definition.key)"
            :isActive="!isOptional(definition.key) || isPresent(definition.key)"
            :class="
              twMerge(
                'my-0.5 inline-block justify-self-start whitespace-nowrap rounded-full px-2 text-2xs',
                isOptional(definition.key) && 'hover:bg-hover-bg',
              )
            "
            @press="toggleProperty(definition.key, definition.schema)"
          >
            {{ 'title' in definition.schema ? String(definition.schema.title) : definition.key }}
          </Button>

          <div>
            <JSONSchemaInput
              :readOnly="readOnly"
              :defs="defs"
              :schema="definition.schema"
              :path="`${path}/properties/${definition.key}`"
              :getValidator="getValidator"
              :isAbsent="!isPresent(definition.key)"
              :noBorder="noChildBorder"
              :value="propertyValue(definition.key)"
              :onChange="(newValue: unknown) => setProperty(definition.key, newValue)"
            />
          </div>
        </template>
      </template>
    </div>

    <JSONSchemaInput
      v-if="referencedSchema != null"
      :key="ref$"
      :dropdownTitle="dropdownTitle"
      :defs="defs"
      :readOnly="readOnly"
      :schema="referencedSchema"
      :path="ref$"
      :getValidator="getValidator"
      :noBorder="noBorder"
      :isAbsent="isAbsent"
      :value="value"
      :onChange="onChange"
    />

    <div v-if="anyOfSchemas != null" :class="anyOfClass">
      <Text v-if="dropdownTitle != null" variant="body-sm" class="px-2">{{ dropdownTitle }}</Text>
      <Dropdown
        :ariaLabel="getText('options')"
        :readOnly="readOnly"
        :items="anyOfSchemas"
        :selectedIndex="selectedChildIndex"
        class="w-full self-start"
        @update:selectedIndex="selectChild"
      >
        <template #default="{ item }">
          <Text>{{ getSchemaName(defs, item) }}</Text>
        </template>
      </Dropdown>
      <JSONSchemaInput
        v-if="selectedChildSchema != null"
        :key="selectedChildIndex"
        :defs="defs"
        :readOnly="readOnly"
        :schema="selectedChildSchema"
        :path="`${path}/anyOf/${selectedChildIndex}`"
        :getValidator="getValidator"
        :noBorder="noChildBorder"
        :isAbsent="isAbsent"
        :value="value"
        :onChange="onChange"
      />
    </div>

    <JSONSchemaInput
      v-for="(childSchema, i) in allOfSchemas"
      :key="i"
      :defs="defs"
      :readOnly="readOnly"
      :schema="childSchema"
      :path="`${path}/allOf/${i}`"
      :getValidator="getValidator"
      :noBorder="noChildBorder"
      :isAbsent="isAbsent"
      :value="value"
      :onChange="onChange"
    />
  </Parts>
</template>
