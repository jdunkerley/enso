<script setup lang="ts">
import { useCurrentProject } from '$/components/WithCurrentProject.vue'
import { entryMethodPointer } from '$/providers/openedProjects/suggestionDatabase/entry'
import { WidgetInput, defineWidget, widgetProps } from '$/providers/openedProjects/widgetRegistry'
import NodeWidget from '@/components/GraphEditor/NodeWidget.vue'
import SizeTransition from '@/components/SizeTransition.vue'
import { Ast } from '@/util/ast'
import { ArgumentApplication, ArgumentApplicationKey } from '@/util/callTree'
import { chainRole, type ChainRole } from '@/util/operatorChain'
import { mapOrUndefined } from 'enso-common/src/utilities/data/opt'
import { computed } from 'vue'
import { FunctionName } from './WidgetFunctionName.vue'

const props = defineProps(widgetProps(widgetDefinition))

const application = computed(() => props.input[ArgumentApplicationKey])
const { module } = useCurrentProject()

const targetMaybePort = computed(() => {
  const target = application.value.target
  if (target instanceof Ast.Ast) {
    const input = WidgetInput.FromAst(target)
    input.forcePort = true
    if (input.value instanceof Ast.PropertyAccess || input.value instanceof Ast.Ident) {
      const methodPointer = entryMethodPointer(application.value.calledFunction)
      if (!methodPointer) return input
      const definition = module.value.getMethodAst(methodPointer)
      if (definition.ok) {
        input[FunctionName] = {
          editableNameExpression: definition.value.name.externalId,
          methodPointer,
          requireUserAction: true,
        }
      }
    }

    return input
  } else {
    return {
      ...target.toWidgetInput(),
      forcePort: !(target instanceof ArgumentApplication),
    }
  }
})

/** An infix level's place in its operator chain; a `capsule` is drawn as a tinted capsule. */
const role = computed((): ChainRole | undefined => {
  const appTree = application.value.appTree
  return application.value.infixOperator != null && appTree instanceof Ast.OprApp ?
      chainRole(appTree)
    : undefined
})

const appClass = computed(() => {
  if (application.value.infixOperator == null) return 'prefix'
  return role.value === 'capsule' ? 'infix operatorCapsule widgetRounded' : 'infix'
})

const operatorStyle = computed(() => {
  const appTree = application.value.appTree
  if (appTree instanceof Ast.OprApp || appTree instanceof Ast.PropertyAccess) {
    const [_lhs, opr, rhs] = appTree.concreteChildren({
      verbatim: true,
      indent: '',
    })
    return {
      '--whitespace-pre': `${JSON.stringify(opr?.whitespace ?? '')}`,
      '--whitespace-post': `${JSON.stringify(rhs?.whitespace ?? '')}`,
    }
  }
  return {}
})

const infixWidgetInput = computed(() =>
  mapOrUndefined(application.value.infixOperator, WidgetInput.FromAst),
)
const showArgument = computed(() => !application.value.argument.hideByDefault)
const argumentWidgetInput = computed(() => {
  return application.value.argument.toWidgetInput()
})
</script>

<script lang="ts">
export const widgetDefinition = defineWidget(
  ArgumentApplicationKey,
  { priority: -20 },
  import.meta.hot,
)
</script>

<template>
  <div class="WidgetApplication widgetParent" :class="appClass" :data-chain-role="role">
    <NodeWidget :input="targetMaybePort" :nest="application.isInnermost" />
    <div v-if="infixWidgetInput" class="infixOp widgetParent" :style="operatorStyle">
      <NodeWidget :input="infixWidgetInput" />
    </div>
    <SizeTransition width leftGap>
      <NodeWidget v-if="showArgument" :input="argumentWidgetInput" nest />
    </SizeTransition>
  </div>
</template>

<style scoped>
.WidgetApplication {
  &.prefix {
    gap: var(--widget-token-pad-unit);
  }
}

.WidgetApplication.operatorCapsule {
  /* A darker tint for a chain inside another: same height as a port, padded only at the sides. */
  height: var(--node-port-height);
  padding: 0 3px;
  gap: 4px;
  align-items: center;
  border-radius: var(--node-port-border-radius);
  background: rgb(0 0 0 / 0.2);
}

.infixOp {
  display: flex;

  &:before {
    content: var(--whitespace-pre);
    display: inline;
    white-space: pre;
  }

  &:after {
    content: var(--whitespace-post);
    display: inline;
    white-space: pre;
  }
}
</style>
