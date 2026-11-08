<script setup lang="ts">
import type { Signature } from '@/components/ComponentHelp/signature'
import SvgIcon from '@/components/SvgIcon.vue'
import type { Icon } from '@/util/iconMetadata/iconName'

const { signature, icon, color } = defineProps<{
  signature: Signature
  icon: Icon
  color: string
}>()
</script>

<template>
  <div
    class="DocsSignature"
    role="group"
    :aria-label="signature.label"
    :title="signature.label"
    :style="{ backgroundColor: color }"
  >
    <SvgIcon :name="icon" class="icon" />
    <span class="name" v-text="signature.name" />
    <span
      v-for="param in signature.params"
      :key="param.name"
      class="param"
      :class="{ optional: param.optional }"
      :title="param.detail"
      v-text="param.name"
    />
  </div>
</template>

<style scoped>
/* The docs site's component node (`docs-site/src/components/ComponentNode.module.css`): white on
 * the group colour, its arguments wrapping onto more lines rather than widening the panel. */
.DocsSignature {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  max-width: 100%;
  min-height: 28px;
  border-radius: 14px;
  padding: 2px 8px 2px 2px;
  row-gap: 2px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
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

.param {
  padding: 0 2px 0 4px;
  margin-left: 4px;
  border-left: 2px solid #0003;
  font-weight: 400;
}

.optional {
  font-style: italic;
}
</style>
