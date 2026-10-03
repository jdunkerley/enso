<script setup lang="ts">
/**
 * @file A QR code on a canvas: the Vue replacement of `qrcode.react`'s `QRCodeCanvas`, drawn the
 * same way (`./qrCode.ts`).
 */
import { onMounted, ref, watch } from 'vue'
import { drawQrCode, type QrCodeLevel } from './qrCode'

const {
  value,
  size = 128,
  level = 'L',
  bgColor = '#FFFFFF',
  fgColor = '#000000',
} = defineProps<{
  value: string
  /** Width and height, in CSS pixels. */
  size?: number | undefined
  level?: QrCodeLevel | undefined
  bgColor?: string | undefined
  fgColor?: string | undefined
}>()

const canvas = ref<HTMLCanvasElement>()

function draw() {
  if (canvas.value) drawQrCode(canvas.value, { value, size, level, bgColor, fgColor })
}
onMounted(draw)
watch(() => [value, size, level, bgColor, fgColor], draw)
</script>

<template>
  <canvas
    ref="canvas"
    :height="size"
    :width="size"
    :style="{ height: `${size}px`, width: `${size}px` }"
  />
</template>
