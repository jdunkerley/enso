<script setup lang="ts">
/**
 * @file The content of `ManageLabelsModal.vue`: a search field, every label as a strip of pills, and
 * the list of labels with a checkbox each (checked when every chosen asset has the label, a dash
 * when some have it), filtered by the search. Checking or unchecking one sets the assets' labels at
 * once; "Create Label" opens a form for a new one, with its colour; each label has a delete button
 * that asks first. When nothing matches the search, it offers to create a label of that name.
 *
 * The Vue port of the React `ManageLabelsForm`. react-aria's `TagGroup` (a `grid` of focusable
 * rows) is a plain `role="list"`: nothing acts on a pill, so it needs no keyboard focus (decision 1
 * of the foundations record). The pills show the labels that at least one of the assets has.
 *
 * Each change writes the assets' labels as this popover last wrote them, so that changes in a row
 * (creating two labels, checking one and then creating another) all stay. Enter in the search field
 * does nothing: the form only holds the popover's state, and submitting it would reset it.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Check from '$/components/Checkbox/Check.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Field from '$/components/Form/Field.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import type { SchemaBuilder } from '$/components/Form/types'
import { useForm } from '$/components/Form/useForm'
import Input from '$/components/Inputs/Input.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import Separator from '$/components/Separator/Separator.vue'
import Text from '$/components/Text/Text.vue'
import type { SelectedAssetInfo } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { tv } from '$/utils/style/tailwindVariants'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { until } from '@vueuse/core'
import type { Backend } from 'enso-common/src/services/Backend'
import {
  findLeastUsedColor,
  LabelName,
  lChColorToCssColor,
  type Label,
  type LChColor,
} from 'enso-common/src/services/Backend'
import { useFilter } from 'reka-ui'
import { computed, ref } from 'vue'
import { labelsQueryOptions } from '../properties/queries'
import ColorPicker from './ColorPicker.vue'
import { labelsAfterChange, type LabelInfo, type LabelState } from './labelChanges'
import NotFoundLabel from './NotFoundLabel.vue'

const MANAGE_LABELS_MODAL_STYLES = tv({
  base: 'flex flex-wrap gap-4 max-w-full flex-1 basis-0 min-h-0',
  slots: {
    allLabels: 'flex flex-col w-full px-1.5 pr-0 min-h-0',
    labels: 'flex flex-col',
    label:
      'flex flex-none items-center justify-center max-w-full min-w-10 px-1.5 py-0 rounded-3xl bg-primary',
    itemLabels: 'inline-flex flex-none max-w-full w-full flex-wrap gap-0.5 px-2',
    itemLabelsList: 'inline-flex max-w-full flex-wrap gap-0.5',
    input: 'w-full flex-1 px-1 py-1',
  },
})

const { backend, items } = defineProps<{
  backend: Backend
  items: readonly SelectedAssetInfo[]
}>()

const { getText } = useText()
const modals = useModals()
const styles = MANAGE_LABELS_MODAL_STYLES()
const { contains } = useFilter({ sensitivity: 'base' })

// React's `useSuspenseQuery`: wait for the labels only when none are cached.
const labelsQuery = useQuery(labelsQueryOptions(backend))
if (labelsQuery.data.value == null) await labelsQuery.suspense()
const allLabels = computed(() => labelsQuery.data.value ?? [])
const leastUsedColor = computed(() => findLeastUsedColor(allLabels.value))

/** Each label, and whether every, some or none of the assets have it. */
const labelsPresence = computed(() =>
  allLabels.value.map<LabelInfo>((label) => {
    const count = items.filter((item) => item.labels?.includes(label.value) === true).length
    const state: LabelState =
      count === items.length ? 'all'
      : count === 0 ? 'none'
      : 'some'
    return { label, state }
  }),
)

const createTag = useMutation(backendMutationOptions('createTag', backend))
const associateTag = useMutation(backendMutationOptions('associateTag', backend))
const deleteTag = useMutation(backendMutationOptions('deleteTag', backend))

const form = useForm({
  schema: (z) =>
    z.object({
      labels: z
        .object({ label: z.custom<Label>(), state: z.enum(['none', 'some', 'all']) })
        .array()
        .readonly(),
      query: z.string(),
    }),
  defaultValues: () => ({ labels: labelsPresence.value, query: '' }),
  // Nothing is submitted: each change is written at once. Enter in the search field must not reset
  // the search and the checks.
  resetOnSubmit: false,
})

/** Each asset's labels, as this popover last wrote them. */
const assetLabels = new Map(items.map((item) => [item.id, item.labels ?? []]))

/** An asset, with its labels as this popover last wrote them. */
function currentItem(item: SelectedAssetInfo): SelectedAssetInfo {
  return { ...item, labels: [...(assetLabels.get(item.id) ?? [])] }
}

function writeLabels(item: SelectedAssetInfo, labels: readonly LabelName[]) {
  assetLabels.set(item.id, labels)
  return associateTag.mutateAsync([item.id, labels, item.title])
}

const selectedLabels = computed(() => form.watch('labels') as readonly LabelInfo[])
const query = computed(() => form.watch('query') as string)

/** The pills: the labels the assets have, as the labels query has them. */
const pills = computed(() =>
  selectedLabels.value
    .filter((label) => label.state !== 'none')
    .map((label) => allLabels.value.find((allLabelsItem) => allLabelsItem.id === label.label.id))
    .filter((label) => label !== undefined),
)

const filteredLabels = computed(() =>
  selectedLabels.value.filter((label) => contains(label.label.value, query.value)),
)

async function createLabel(name: string, color?: LChColor) {
  const labelName = LabelName(name)
  const newLabel = await createTag.mutateAsync([
    { value: labelName, color: color ?? leastUsedColor.value },
  ])
  await Promise.allSettled(
    items.map((item) => writeLabels(item, [...(assetLabels.get(item.id) ?? []), labelName])),
  )
  form.setValue('labels', [...selectedLabels.value, { label: newLabel, state: 'all' }])
}

function deleteLabel(label: Label) {
  form.setValue(
    'labels',
    selectedLabels.value.filter((l) => l.label.id !== label.id),
  )
  return deleteTag.mutateAsync([label.id, label.value])
}

/** Set every asset's labels to follow the changed states. */
function setLabelState(label: Label, state: LabelState) {
  const previousLabels = selectedLabels.value
  const newSelectedLabels = previousLabels.map((l) =>
    l.label.id === label.id ? { ...l, state } : l,
  )
  form.setValue('labels', newSelectedLabels)
  return Promise.allSettled(
    items.map((item) => {
      const newLabels = labelsAfterChange(currentItem(item), previousLabels, newSelectedLabels)
      return newLabels == null ? Promise.resolve() : writeLabels(item, newLabels)
    }),
  )
}

async function confirmDelete(label: Label) {
  const depth = modals.stack.value.length
  const answer = await modals.ask(ConfirmDeleteModal, {
    cannotUndo: true,
    actionText: getText('deleteLabelActionText', label.value),
    actionButtonLabel: getText('delete'),
    onConfirm: () => deleteLabel(label),
  })
  // The delete button that opened the question went with its label, so the confirmation cannot
  // return focus to it. Focus the search field, as React's focus scope did.
  if (answer === 'confirm') {
    // Once the question has left the stack (after its exit animation) and its focus handling ran.
    await until(() => modals.stack.value.length).toBe(depth)
    setTimeout(() =>
      setTimeout(() => {
        if (document.activeElement == null || document.activeElement === document.body) {
          form.setFocus('query')
        }
      }),
    )
  }
}

const isCreateOpen = ref(false)

/** The "Create Label" form's name rule: not empty once trimmed, and not an existing label's. */
const createLabelSchema = (z: SchemaBuilder) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !allLabels.value.some((label) => label.value === value), {
        message: getText('manageLabelsModal.labelAlreadyExists'),
      }),
    color: z.custom<LChColor>(),
  })
</script>

<template>
  <Form :form="form" gap="none" class="flex max-h-[inherit] w-full flex-col">
    <Input
      name="query"
      type="search"
      variant="custom"
      size="small"
      :fieldClass="styles.input()"
      :placeholder="getText('search.placeholder')"
      autoFocus
    />

    <div v-if="pills.length > 0" :class="styles.itemLabels()">
      <Scroller background="secondary">
        <div class="contents">
          <div
            role="list"
            :aria-label="getText('manageLabelsModal.selectedLabels')"
            class="flex w-full gap-1"
          >
            <div
              v-for="label in pills"
              :key="label.id"
              role="listitem"
              :class="styles.label()"
              :style="{ backgroundColor: lChColorToCssColor(label.color) }"
            >
              <Text truncate color="invert" textSelection="none">{{ label.value }}</Text>
            </div>
          </div>
        </div>
      </Scroller>
    </div>

    <Separator class="my-2" />

    <div :class="styles.allLabels()">
      <Text variant="body" color="muted" weight="semibold" class="ml-2">
        {{ getText('manageLabelsModal.allLabels') }}
      </Text>

      <div
        :aria-label="getText('manageLabelsModal.allLabels')"
        class="flex max-h-72 flex-col overflow-y-auto overflow-x-hidden scroll-offset-edge-0"
      >
        <NotFoundLabel
          v-if="filteredLabels.length === 0"
          :query="query"
          :leastUsedColor="leastUsedColor"
          :onCreateLabel="createLabel"
        />
        <!-- React's `pressed:bg-primary/5` here never applied (a react-aria modifier on a plain
        `div`), so it is not carried over. -->
        <div
          v-for="{ label, state } in filteredLabels"
          :id="label.id"
          :key="label.id"
          class="group rounded-3xl"
        >
          <div
            class="flex w-full items-center gap-2 px-2 py-0.5 hover:rounded-3xl hover:bg-primary/5"
          >
            <Button
              variant="custom"
              @press="setLabelState(label, state === 'all' ? 'none' : 'all')"
            >
              <Check :isSelected="state === 'all'" :isIndeterminate="state === 'some'" />
              <div
                class="aspect-square w-4 flex-none rounded-full"
                :style="{ backgroundColor: lChColorToCssColor(label.color) }"
              />
              <Text truncate nowrap textSelection="none">{{ label.value }}</Text>
            </Button>

            <Button
              variant="icon"
              :aria-label="getText('delete')"
              icon="trash"
              size="small"
              class="ml-auto opacity-0 transition-opacity duration-75 group-hover:opacity-100"
              @press="void confirmDelete(label)"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="flex w-full flex-col gap-2 px-2 py-2">
      <ButtonGroup width="full" align="between" gap="small">
        <!-- Escape closes only this form, as react-aria's popover stopped it. -->
        <Popover v-model:open="isCreateOpen" @keydown.esc.stop="isCreateOpen = false">
          <template #trigger>
            <Button variant="icon" size="small" fullWidth icon="add">
              {{ getText('manageLabelsModal.createLabel') }}
            </Button>
          </template>
          <Form
            v-slot="{ form: createForm }"
            :schema="createLabelSchema"
            :defaultValues="{ name: '', color: leastUsedColor }"
            method="dialog"
            @submit="({ name, color }) => createLabel(name, color)"
          >
            <Input name="name" :label="getText('name')" autoFocus />

            <Field name="color" :label="getText('manageLabelsModal.chooseColor')">
              <ColorPicker
                :aria-label="getText('manageLabelsModal.chooseColor')"
                :modelValue="createForm.watch('color') as LChColor"
                @update:modelValue="(color) => createForm.setValue('color', color)"
              />
            </Field>

            <Submit class="ml-auto min-w-12" size="small">
              {{ getText('manageLabelsModal.createLabel') }}
            </Submit>

            <FormError />
          </Form>
        </Popover>
      </ButtonGroup>

      <FormError />
    </div>
  </Form>
</template>
