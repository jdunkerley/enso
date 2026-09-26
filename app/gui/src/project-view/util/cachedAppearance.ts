import { isIconName, type Icon } from '@/util/iconMetadata/iconName'
import { modeOklch, modeRgb, parse, useMode } from 'culori/fn'

// `culori/fn` parses only the colour spaces registered with it; these cover every colour the
// IDE produces (hex and `rgb()` group colours, `oklch()` type colours). Registering is idempotent.
useMode(modeRgb)
useMode(modeOklch)

/**
 * The longest colour or icon name the file format accepts (`.max(64)` in `app/ydoc-server/src/fileFormat.ts`).
 * Anything longer would be written here, then make the whole `cachedAppearance` invalid on reload.
 */
export const MAX_CACHED_APPEARANCE_FIELD_LENGTH = 64

/** A node's cached appearance, after validation: safe to use as a CSS colour and an icon name. */
export interface ValidCachedAppearance {
  color?: string
  icon?: Icon
}

/**
 * Validate a cached appearance read from the file (which may have been edited by hand). Invalid
 * parts, including any longer than the file format allows, are dropped individually; `undefined` if nothing valid remains.
 */
export function sanitizeCachedAppearance(
  raw: { readonly color?: unknown; readonly icon?: unknown } | null | undefined,
): ValidCachedAppearance | undefined {
  if (raw == null) return undefined
  const color = isShortString(raw.color) && parse(raw.color) != null ? raw.color : undefined
  const icon = isShortString(raw.icon) && isIconName(raw.icon) ? raw.icon : undefined
  if (color == null && icon == null) return undefined
  return {
    ...(color != null ? { color } : {}),
    ...(icon != null ? { icon } : {}),
  }
}

/** Whether `value` is a string short enough for the file format to accept. */
function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_CACHED_APPEARANCE_FIELD_LENGTH
}
