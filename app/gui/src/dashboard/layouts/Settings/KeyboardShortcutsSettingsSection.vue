<script setup lang="ts">
/**
 * @file The Keyboard shortcuts settings tab. It lists the rebindable actions of the dashboard and
 * of the graph editor (#170), grouped by category, with their shortcuts, which can be removed,
 * added (`CaptureKeyboardShortcutModal`) and reset, one action or all at once. The changes go to
 * the window's bindings (`$/providers/inputBindings`), so they apply at once, and are saved.
 *
 * A shortcut that shares its key with another action where both are active is drawn in red, and
 * the row names the other action; the capture modal will not add such a shortcut
 * (`$/configurations/keyboardShortcuts` has the scopes).
 */
import CaptureKeyboardShortcutModal from '#/modals/CaptureKeyboardShortcutModal.vue'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Icon from '$/components/Icon/Icon.vue'
import KeyboardShortcut from '$/components/KeyboardShortcut/KeyboardShortcut.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import {
  canonicalShortcut,
  categoryToTextId,
  SHORTCUT_CATEGORIES,
  type Shortcut,
  type ShortcutId,
} from '$/configurations/keyboardShortcuts'
import { getInputBindingsStore } from '$/providers/inputBindings'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { computed } from 'vue'

const inputBindings = getInputBindingsStore()
const modals = useModals()
const { getText } = useText()

const groups = computed(() =>
  SHORTCUT_CATEGORIES.flatMap((category) => {
    const shortcuts = inputBindings.shortcuts.filter(
      (shortcut) => shortcut.rebindable && shortcut.category === category,
    )
    if (shortcuts.length === 0) return []
    return [
      {
        category,
        name: getText(categoryToTextId(category)),
        rows: shortcuts.map((shortcut) => ({
          shortcut,
          name: getText(shortcut.nameTextId),
          conflicts: rowConflicts(shortcut),
        })),
      },
    ]
  }),
)

/** The names of other actions, quoted, as "Also used by" says them. */
function alsoUsedBy(others: readonly Shortcut[]) {
  const names = new Set(others.map((other) => `'${getText(other.nameTextId)}'`))
  return getText('shortcutConflictsWith', [...names].join(', '))
}

/** What else has `binding` of `shortcut`, where both are active, if anything. */
function bindingConflict(shortcut: Shortcut, binding: string) {
  const others = inputBindings.conflicts.get(shortcut.id)?.get(binding)
  return others == null ? undefined : alsoUsedBy(others)
}

/** What else has any of `shortcut`'s bindings, where both are active, if anything. */
function rowConflicts(shortcut: Shortcut) {
  const byBinding = inputBindings.conflicts.get(shortcut.id)
  return byBinding == null ? undefined : alsoUsedBy([...byBinding.values()].flat())
}

function resetAll() {
  void modals.ask(ConfirmDeleteModal, {
    actionText: getText('resetAllKeyboardShortcuts'),
    actionButtonLabel: getText('resetAll'),
    onConfirm: () => {
      inputBindings.resetAll()
    },
  })
}

/** What already has `binding`, for the capture modal. */
function conflictsWith(id: ShortcutId, binding: string): true | readonly string[] {
  const shortcut = inputBindings.shortcuts.find((candidate) => candidate.id === id)
  const key = canonicalShortcut(binding)
  if (shortcut?.bindings.some((existing) => canonicalShortcut(existing) === key)) return true
  return inputBindings.conflictsFor(id, binding).map((other) => getText(other.nameTextId))
}

function addShortcut(shortcut: Shortcut, name: string) {
  modals.open(CaptureKeyboardShortcutModal, {
    description: `'${name}'`,
    conflictsWith: (binding: string) => conflictsWith(shortcut.id, binding),
    digitsByPosition: shortcut.owner === 'graph',
    onSubmit: (binding: string) => inputBindings.add(shortcut.id, binding),
  })
}
</script>

<template>
  <ButtonGroup class="grow-0">
    <Button size="medium" variant="outline" @press="resetAll">{{ getText('resetAll') }}</Button>
  </ButtonGroup>
  <Scroller scrollbar orientation="vertical" class="min-h-0 flex-1" shadowStartClass="top-8">
    <table class="table-fixed border-collapse rounded-rows">
      <thead class="sticky top-0 z-1 bg-dashboard">
        <tr class="h-row text-left text-sm font-semibold">
          <th class="min-w-8 pl-cell-x pr-1.5"></th>
          <th class="min-w-36 px-cell-x">{{ getText('name') }}</th>
          <th class="px-cell-x">{{ getText('shortcuts') }}</th>
          <th class="w-full min-w-64 px-cell-x">{{ getText('description') }}</th>
        </tr>
      </thead>
      <tbody v-for="group in groups" :key="group.category" :data-category="group.category">
        <tr class="h-row text-left text-sm font-semibold">
          <th colspan="4" scope="colgroup" class="px-cell-x pt-2">{{ group.name }}</th>
        </tr>
        <tr
          v-for="{ shortcut, name, conflicts } in group.rows"
          :key="shortcut.id"
          class="rounded-rows-child"
          :data-shortcut-id="shortcut.id"
        >
          <td
            class="flex h-row items-center rounded-l-full bg-clip-padding pl-cell-x pr-1.5"
            :style="{ color: shortcut.color }"
          >
            <Icon :icon="shortcut.icon" class="size-4"><span /></Icon>
          </td>
          <td class="border-l-2 border-r-2 border-transparent bg-clip-padding px-cell-x">
            {{ name }}
          </td>
          <td
            class="group min-w-max border-l-2 border-r-2 border-transparent bg-clip-padding px-cell-x"
          >
            <div class="gap-buttons flex items-center pr-4">
              <div
                v-for="(binding, j) in shortcut.bindings"
                :key="j"
                class="inline-flex shrink-0 items-center gap-1"
                :title="bindingConflict(shortcut, binding)"
              >
                <KeyboardShortcut
                  :shortcut="binding"
                  :class="
                    twMerge(
                      'rounded-lg border-0.5 border-primary/10 px-1',
                      bindingConflict(shortcut, binding) != null && 'border-red-600 text-red-600',
                    )
                  "
                />
                <Button
                  variant="icon"
                  size="medium"
                  :aria-label="getText('removeShortcut')"
                  tooltipPlacement="top-start"
                  icon="close"
                  showIconOnHover
                  @press="inputBindings.delete(shortcut.id, binding)"
                />
              </div>
              <div class="grow" />
              <div class="flex shrink-0 items-center gap-1">
                <Button
                  variant="icon"
                  size="medium"
                  :aria-label="getText('addShortcut')"
                  tooltipPlacement="top-start"
                  icon="add"
                  showIconOnHover
                  @press="addShortcut(shortcut, name)"
                />
                <Button
                  variant="icon"
                  size="medium"
                  :aria-label="getText('resetShortcut')"
                  tooltipPlacement="top-start"
                  icon="refresh"
                  showIconOnHover
                  @press="inputBindings.reset(shortcut.id)"
                />
              </div>
            </div>
          </td>
          <td
            class="cell-x rounded-r-full border-l-2 border-r-2 border-transparent bg-clip-padding"
            :class="conflicts != null && 'text-red-600'"
          >
            {{ conflicts }}
          </td>
        </tr>
      </tbody>
    </table>
  </Scroller>
</template>
