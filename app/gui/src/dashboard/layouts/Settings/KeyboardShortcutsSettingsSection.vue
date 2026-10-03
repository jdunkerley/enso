<script setup lang="ts">
/**
 * @file The Keyboard shortcuts settings tab: the Vue port of the React
 * `KeyboardShortcutsSettingsSection`. It lists the dashboard's rebindable actions with their
 * shortcuts, which can be removed, added (`CaptureKeyboardShortcutModal`) and reset, one action or
 * all at once. The changes go to the window's bindings (`$/providers/dashboardInputBindings`), so
 * they apply at once, and are saved.
 */
import CaptureKeyboardShortcutModal from '#/modals/CaptureKeyboardShortcutModal.vue'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Icon from '$/components/Icon/Icon.vue'
import KeyboardShortcut from '$/components/KeyboardShortcut/KeyboardShortcut.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import { actionToTextId, type DashboardBindingKey } from '$/configurations/inputBindings'
import { getDashboardInputBindings } from '$/providers/dashboardInputBindings'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { unsafeEntries, unsafeKeys } from 'enso-common/src/utilities/data/object'
import { computed } from 'vue'

const inputBindings = getDashboardInputBindings()
const modals = useModals()
const { getText } = useText()

const allShortcuts = computed(
  () => new Set(Object.values(inputBindings.metadata).flatMap((value) => value.bindings)),
)
const visibleBindings = computed(() =>
  unsafeEntries(inputBindings.metadata).flatMap(([action, info]) =>
    info.rebindable === false ? [] : [{ action, info, name: getText(actionToTextId(action)) }],
  ),
)

function resetAll() {
  void modals.ask(ConfirmDeleteModal, {
    actionText: getText('resetAllKeyboardShortcuts'),
    actionButtonLabel: getText('resetAll'),
    onConfirm: () => {
      for (const action of unsafeKeys(inputBindings.metadata)) {
        inputBindings.reset(action)
      }
    },
  })
}

function addShortcut(action: DashboardBindingKey, name: string) {
  modals.open(CaptureKeyboardShortcutModal, {
    description: `'${name}'`,
    existingShortcuts: allShortcuts.value,
    onSubmit: (shortcut: string) => inputBindings.add(action, shortcut),
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
      <tbody>
        <tr
          v-for="{ action, info, name } in visibleBindings"
          :key="action"
          class="rounded-rows-child"
        >
          <td
            class="flex h-row items-center rounded-l-full bg-clip-padding pl-cell-x pr-1.5"
            :style="{ color: info.color }"
          >
            <Icon :icon="info.icon" class="size-4"><span /></Icon>
          </td>
          <td class="border-l-2 border-r-2 border-transparent bg-clip-padding px-cell-x">
            {{ name }}
          </td>
          <td
            class="group min-w-max border-l-2 border-r-2 border-transparent bg-clip-padding px-cell-x"
          >
            <div class="gap-buttons flex items-center pr-4">
              <div
                v-for="(binding, j) in info.bindings"
                :key="j"
                class="inline-flex shrink-0 items-center gap-1"
              >
                <KeyboardShortcut
                  :shortcut="binding"
                  class="rounded-lg border-0.5 border-primary/10 px-1"
                />
                <Button
                  variant="icon"
                  size="medium"
                  :aria-label="getText('removeShortcut')"
                  tooltipPlacement="top-start"
                  icon="close"
                  showIconOnHover
                  @press="inputBindings.delete(action, binding)"
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
                  @press="addShortcut(action, name)"
                />
                <Button
                  variant="icon"
                  size="medium"
                  :aria-label="getText('resetShortcut')"
                  tooltipPlacement="top-start"
                  icon="refresh"
                  showIconOnHover
                  @press="inputBindings.reset(action)"
                />
              </div>
            </div>
          </td>
          <td
            class="cell-x rounded-r-full border-l-2 border-r-2 border-transparent bg-clip-padding"
          >
            {{ info.description }}
          </td>
        </tr>
      </tbody>
    </table>
  </Scroller>
</template>
