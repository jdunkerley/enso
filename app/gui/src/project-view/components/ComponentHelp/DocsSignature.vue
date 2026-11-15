<script setup lang="ts">
import DocsParamPill from '@/components/ComponentHelp/DocsParamPill.vue'
import { WIDGET_LABELS } from '@/components/ComponentHelp/arguments'
import type { Signature } from '@/components/ComponentHelp/signature'
import SvgIcon from '@/components/SvgIcon.vue'
import type { Icon } from '@/util/iconMetadata/iconName'

const { signature, icon, color, expanded } = defineProps<{
  signature: Signature
  icon: Icon
  color: string
  expanded: boolean
}>()
const emit = defineEmits<{ 'update:expanded': [value: boolean] }>()
</script>

<template>
  <div
    class="DocsSignature"
    :class="{ expanded }"
    role="group"
    :aria-label="signature.label"
    :style="{ backgroundColor: color }"
  >
    <div class="head">
      <SvgIcon :name="icon" class="icon" />
      <span class="name" v-text="signature.name" />
      <template v-if="!expanded">
        <DocsParamPill v-for="param in signature.params" :key="param.name" :param="param" />
      </template>
      <button
        v-if="signature.params.length > 0"
        type="button"
        class="toggle"
        :aria-expanded="expanded"
        @click="emit('update:expanded', !expanded)"
        v-text="expanded ? '▾ hide' : '▸ details'"
      />
    </div>
    <div v-if="expanded" class="rows">
      <div v-for="param in signature.params" :key="param.name" class="row">
        <span class="argName" :class="{ optional: param.optional }" v-text="param.name" />
        <span class="argDetail">
          <span class="meta">
            <code class="type" v-text="param.type" />
            <span v-if="param.default != null" class="default" v-text="`= ${param.default}`" />
            <span
              class="widget"
              :class="{ inferred: param.widgetInferred }"
              v-text="WIDGET_LABELS[param.widget]"
            />
          </span>
          <span v-if="param.description" class="description" v-text="param.description" />
        </span>
      </div>
      <div class="returnsRow">→ <code class="type" v-text="signature.returns" /></div>
    </div>
  </div>
  <div v-if="!expanded" class="returnsLine">→ {{ signature.returns }}</div>
</template>

<style scoped>
/* The docs site's component node (`docs-site/src/components/ComponentNode.module.css`): white on
 * the group colour, its arguments wrapping onto more lines rather than widening the panel. */
.DocsSignature {
  display: block;
  width: fit-content;
  max-width: 100%;
  border-radius: 14px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.DocsSignature.expanded {
  width: 100%;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  min-height: 28px;
  padding: 2px 8px 2px 2px;
  row-gap: 2px;
}

.icon {
  width: 16px;
  height: 16px;
  margin: 4px;
  flex: none;
}

.name {
  font-weight: 600;
  padding: 0 2px;
  margin-left: 2px;
}

.toggle {
  margin-left: auto;
  padding: 0 0 0 8px;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 11px;
  opacity: 0.85;
  cursor: pointer;
}

.rows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 10px;
  margin: 0 6px 6px;
  padding: 8px 9px;
  border-radius: 10px;
  background: #0002;
  font-size: 11.5px;
  line-height: 1.45;
}

.row {
  display: contents;
}

.argName {
  font-weight: 600;
}

.argName.optional {
  font-weight: 500;
  font-style: italic;
}

.argDetail {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.type {
  padding: 0 4px;
  border-radius: var(--docs-code-radius);
  background: #fff;
  color: #333;
  font-size: var(--docs-code-font-size);
}

.widget {
  padding: 0 5px;
  border: 1px dashed currentColor;
  border-radius: 6px;
  font-size: 10.5px;
}

.widget.inferred {
  opacity: 0.8;
}

.description {
  font-weight: 400;
}

.returnsRow {
  grid-column: 1 / -1;
  padding-top: 6px;
  border-top: 1px solid #fff3;
}

.returnsLine {
  margin: 4px 0 0 4px;
  color: #666;
  font-size: 11px;
}
</style>
