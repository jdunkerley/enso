import { isIconName, type Icon } from '@/util/iconMetadata/iconName'
import { modeOklch, modeRgb, parse, useMode } from 'culori/fn'

// `culori/fn` parses only the colour spaces registered with it; these cover every colour the
// IDE produces (hex and `rgb()` group colours, `oklch()` type colours). Registering is idempotent.
useMode(modeRgb)
useMode(modeOklch)

/** A node's cached appearance, after validation: safe to use as a CSS colour and an icon name. */
export interface ValidCachedAppearance {
  color?: string
  icon?: Icon
}

/**
 * Validate a cached appearance read from the file (which may have been edited by hand). Invalid
 * parts are dropped individually; `undefined` if nothing valid remains.
 */
export function sanitizeCachedAppearance(
  raw: { readonly color?: unknown; readonly icon?: unknown } | null | undefined,
): ValidCachedAppearance | undefined {
  if (raw == null) return undefined
  const color = typeof raw.color === 'string' && parse(raw.color) != null ? raw.color : undefined
  const icon = typeof raw.icon === 'string' && isIconName(raw.icon) ? raw.icon : undefined
  if (color == null && icon == null) return undefined
  return {
    ...(color != null ? { color } : {}),
    ...(icon != null ? { icon } : {}),
  }
}
