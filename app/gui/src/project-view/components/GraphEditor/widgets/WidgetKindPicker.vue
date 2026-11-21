<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { requiredImportsByProjectPath } from '$/providers/openedProjects/module/imports'
import {
  Score,
  WidgetInput,
  defineWidget,
  widgetProps,
} from '$/providers/openedProjects/widgetRegistry'
import type {
  UnionKind,
  WidgetConfiguration,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import { kindIcon } from '@/components/GraphEditor/widgets/WidgetKindPicker/kindIcon'
import {
  kindDefaultCode,
  matchKind,
} from '@/components/GraphEditor/widgets/WidgetKindPicker/kindMatch'
import { pickerMenuStyles } from '@/components/GraphEditor/widgets/WidgetSelection/styles'
import {
  ExpressionTag,
  NestedChoiceTag,
  useExpressionTags,
} from '@/components/GraphEditor/widgets/WidgetSelection/tags'
import { underKindPicker } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import DropdownWidget, { type DropdownEntry } from '@/components/widgets/DropdownWidget.vue'
import { unrefElement, useEvent } from '@/composables/events'
import { usePopoverRoot } from '@/providers/popoverRoot'
import { injectWidgetTree } from '@/providers/widgetTree'
import { Ast } from '@/util/ast'
import { targetIsOutside } from '@/util/autoBlur'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'

const props = defineProps(widgetProps(widgetDefinition))
const { module, projectNames, suggestionDb } = useCurrentProject()
const tree = injectWidgetTree()
const popoverRoot = usePopoverRoot()

const kinds = computed(() => unionKinds(props.input))
const chosenIndex = computed(() => matchKind(kinds.value, valueAst(props.input)))
const chosen = computed<UnionKind | undefined>(() =>
  chosenIndex.value == null ? undefined : kinds.value[chosenIndex.value],
)
const selected = computed(() => tree.showDetails)
const isNothing = computed(() => chosen.value?.config === null)
const icon = computed(() => (chosen.value ? kindIcon(chosen.value) : undefined))

/** The argument's own widget for the chosen kind. The picker is excluded on the same port, so it is not chosen again. */
const innerInput = computed<WidgetInput>(() =>
  underKindPicker({ ...props.input, dynamicConfig: chosen.value?.config ?? undefined }),
)
const nothingInput = computed<WidgetInput>(() =>
  underKindPicker({ ...props.input, dynamicConfig: undefined }),
)

const open = ref(false)
const buttonElement = useTemplateRef<HTMLElement>('buttonElement')
const menuElement = useTemplateRef<HTMLElement>('menuElement')
const { floatingStyles } = pickerMenuStyles(buttonElement, menuElement)

watch(selected, (isSelected) => {
  if (!isSelected) open.value = false
})

type KindEntry = DropdownEntry & { kind: UnionKind }
const entries = computed<KindEntry[]>(() =>
  kinds.value.flatMap((kind, index) =>
    kindDefaultCode(kind.config) == null ?
      []
    : [
        {
          value: kind.label,
          key: String(index),
          selected: index === chosenIndex.value,
          icon: kindIcon(kind),
          kind,
        },
      ],
  ),
)

function closeMenu(refocus: boolean) {
  open.value = false
  if (refocus) void nextTick(() => buttonElement.value?.focus())
}

useEvent(
  window,
  'pointerdown',
  (e) => {
    if (
      open.value &&
      targetIsOutside(e, unrefElement(menuElement)) &&
      targetIsOutside(e, unrefElement(buttonElement))
    )
      closeMenu(false)
  },
  { capture: true },
)
useEvent(
  window,
  'keydown',
  (e) => {
    if (open.value && e.key === 'Escape') {
      e.stopPropagation()
      closeMenu(true)
    }
  },
  { capture: true },
)

/**
 * The configuration whose options `choiceTags` lists. `useExpressionTags` is how the dropdown turns a
 * `Single_Choice`'s options into tags that carry their `requires` imports, but it reads a
 * configuration reactively: `switchTo` points it at the kind being switched to and reads the
 * tags straight away (the computed re-evaluates on read), so the dropdown's own resolution is reused.
 */
const switchTarget = shallowRef<WidgetConfiguration | null>(null)
const choiceTags = useExpressionTags({
  dynamicConfig: switchTarget,
  staticTags: undefined,
  suggestionDb: () => suggestionDb.value.entries,
  projectNames,
  libraryPublicTypes: () => suggestionDb.value.libraryPublicTypes,
})

const ENSO_SECRET_TYPE = ProjectPath.create(
  'Standard.Base' as QualifiedName,
  'Enso_Cloud.Enso_Secret.Enso_Secret' as QualifiedName,
)
/** The type whose import a kind's default code needs, besides Enso_Secret's. */
function timeType(kind: WidgetConfiguration['kind']): string | undefined {
  switch (kind) {
    case 'Date_Input':
      return 'Data.Time.Date.Date'
    case 'Time_Input':
      return 'Data.Time.Time_Of_Day.Time_Of_Day'
    case 'Date_Time_Input':
      return 'Data.Time.Date_Time.Date_Time'
    default:
      return undefined
  }
}

/** Add the imports the kind's default code needs. */
function addKindImports(
  edit: Parameters<typeof module.value.addMissingImports>[0],
  kind: UnionKind,
) {
  const config = kind.config
  if (config == null) return
  const typePath = timeType(config.kind)
  const type =
    config.kind === 'Secret_Browse' ? ENSO_SECRET_TYPE
    : typePath ? ProjectPath.create('Standard.Base' as QualifiedName, typePath as QualifiedName)
    : undefined
  if (type) {
    module.value.addMissingImports(
      edit,
      requiredImportsByProjectPath(suggestionDb.value.entries, type),
    )
  } else if (config.kind === 'Single_Choice') {
    switchTarget.value = config
    // The option whose code is written (kindDefaultCode's first, nested options flattened).
    const code = kindDefaultCode(config)
    const written = choiceTags.value
      .flatMap((tag) => (tag instanceof NestedChoiceTag ? tag.flatten() : [tag]))
      .find((tag) => tag instanceof ExpressionTag && tag.expression === code)
    if (written instanceof ExpressionTag) written.resolveExpression(edit, module.value)
  }
}

/** Write the kind's default code, with its imports, as one edit (one undo step). */
function switchTo(kind: UnionKind) {
  const code = kindDefaultCode(kind.config)
  if (code == null) return
  module.value.edit((edit) => {
    addKindImports(edit, kind)
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value: code },
      directInteraction: true,
    })
  })
}

/** When the list opens, the focus goes to the current kind; the arrow keys then move it (Enter clicks). */
watch(open, (isOpen) => {
  if (!isOpen) return
  void nextTick(() => {
    const items = menuItems()
    ;(items.find((item) => item.classList.contains('selected')) ?? items[0])?.focus({
      preventScroll: true,
    })
  })
})

function menuItems(): HTMLElement[] {
  return Array.from(menuElement.value?.querySelectorAll<HTMLElement>('button.item') ?? [])
}

function onMenuKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  e.stopPropagation()
  const items = menuItems()
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  const step = e.key === 'ArrowDown' ? 1 : -1
  items[(current + step + items.length) % items.length]?.focus({ preventScroll: true })
}

watch(buttonElement, (element) => {
  // The picker may be a new instance by then (the edit changes the widget tree), hence the module-level flag.
  if (element == null || !focusAfterSwitch) return
  focusAfterSwitch = false
  element.focus()
})

function onEntry(entry: KindEntry) {
  closeMenu(true)
  if (entry.selected) return
  focusAfterSwitch = true
  // The button stays the same element when both kinds have an icon: nothing is left to wait for.
  setTimeout(() => (focusAfterSwitch = false), 1000)
  switchTo(entry.kind)
}
</script>

<script lang="ts">
/**
 * Whether the next button to appear takes the focus: a kind was just chosen, and the Nothing button
 * and the icon button are different elements (of a picker that may itself be new, its port being
 * the new value's), which appear only once the edit has been applied.
 */
let focusAfterSwitch = false

function unionKinds(input: WidgetInput): readonly UnionKind[] {
  return input.dynamicConfig?.kind === 'Union' ? input.dynamicConfig.kinds : []
}

function valueAst(input: WidgetInput): Ast.Expression | undefined {
  return input.value instanceof Ast.Ast ? (input.value as Ast.Expression) : undefined
}

/** `Perfect` for a union whose kind the value is (or an unset argument); otherwise the picker steps aside. */
export function kindPickerScore(input: WidgetInput): Score {
  const kinds = unionKinds(input)
  if (kinds.length === 0) return Score.Mismatch
  return matchKind(kinds, valueAst(input)) == null ? Score.Mismatch : Score.Perfect
}

/**
 * The kind picker: in front of a union argument's value, the icon of the kind the value is, which on
 * a selected node is a button opening a list of the kinds. The value itself is drawn by the chosen
 * kind's own widget, so the node still shows its code. Priority 44: before the widgets of the
 * kinds (`WidgetFileBrowser` 49, `WidgetSelection` 50 …), which it wraps.
 */
export const widgetDefinition = defineWidget(
  WidgetInput.isAstOrPlaceholder,
  { priority: 44, score: (props) => kindPickerScore(props.input) },
  import.meta.hot,
)
</script>

<template>
  <div class="WidgetKindPicker widgetParent" @keydown.enter.stop>
    <template v-if="chosen">
      <template v-if="isNothing">
        <button
          v-if="selected"
          ref="buttonElement"
          type="button"
          class="kindButton nothingButton"
          aria-label="Nothing, change kind"
          aria-haspopup="listbox"
          :aria-expanded="open"
          @pointerdown.stop
          @click.stop="open = !open"
        >
          <span>Nothing</span>
          <SvgIcon name="arrow_right_head_only" class="kindArrow" />
        </button>
        <NodeWidget v-else :input="nothingInput" />
      </template>
      <template v-else>
        <button
          v-if="selected"
          ref="buttonElement"
          type="button"
          class="kindButton"
          :aria-label="`${chosen.label}, change kind`"
          aria-haspopup="listbox"
          :aria-expanded="open"
          @pointerdown.stop
          @click.stop="open = !open"
        >
          <SvgIcon v-if="icon" :name="icon" class="kindSymbol" />
          <span v-else>{{ chosen.label }}</span>
          <SvgIcon name="arrow_right_head_only" class="kindArrow" />
        </button>
        <span v-else class="kindIcon" :title="chosen.label">
          <SvgIcon v-if="icon" :name="icon" class="kindSymbol" />
          <span v-else>{{ chosen.label }}</span>
        </span>
        <NodeWidget :input="innerInput" />
      </template>
    </template>
    <Teleport v-if="open && selected" :to="popoverRoot">
      <div
        ref="menuElement"
        class="menuElement widgetOutOfLayout"
        :style="floatingStyles"
        @keydown="onMenuKey"
      >
        <DropdownWidget class="outlined" :entries="entries" @clickEntry="onEntry" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.WidgetKindPicker {
  display: inline-flex;
  align-items: center;
}

.kindIcon {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 4px;
  color: rgba(255 255 255 / 0.9);
  pointer-events: none;
}

.kindButton {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 3px 0 4px;
  gap: 1px;
  border: 0;
  border-radius: 9px;
  background: rgba(0 0 0 / 0.22);
  color: white;
  cursor: pointer;
  &:hover {
    background: rgba(0 0 0 / 0.34);
  }
}

.nothingButton {
  padding: 0 6px 0 8px;
  font-weight: bold;
}

.kindSymbol {
  width: 14px;
  height: 14px;
}

.kindArrow {
  width: 9px;
  height: 9px;
  transform: rotate(90deg);
  opacity: 0.9;
}

.menuElement {
  z-index: calc(var(--z-index-component-menu) + 1);
}

.outlined {
  border: 1px solid color-mix(in oklab, var(--dropdown-bg), black 5%);
}
</style>
