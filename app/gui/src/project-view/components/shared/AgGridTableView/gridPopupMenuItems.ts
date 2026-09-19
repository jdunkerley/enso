import { svgUseHref } from '@/util/icons'
import type { Column, GridApi, IRowNode, MenuItemDef } from 'ag-grid-enterprise'

/**
 * Build the `icon` HTML for a menu item from an Enso sprite icon name.
 *
 * AG Grid's own `<span class="ag-icon ag-icon-*">` icons must not be used here. Their glyphs come
 * from the AG Grid theme stylesheet, which `AgGridTableView.vue` loads through its own style blocks —
 * and because that component lives under `components/shared/` it compiles in custom-element mode,
 * so those styles exist only inside the grid's shadow root. `GridPopupMenu.vue` renders in the
 * light DOM, where `.ag-icon` has no styling at all and the span collapses to nothing.
 *
 * Enso's sprite is referenced by URL, so it resolves from either tree.
 */
export function menuIconHtml(icon: string): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16"><use xlink:href="${svgUseHref(icon)}"/></svg>`
}

/** Enso sprite icon to use in place of each AG Grid `ag-icon-*` glyph we actually encounter. */
const AG_ICON_SPRITES: Record<string, string> = {
  copy: 'copy',
  cut: 'scissors',
  paste: 'paste',
}

/**
 * Swap an AG Grid icon-font span for the equivalent Enso sprite icon, leaving anything else as-is.
 *
 * `commonContextMenuActions` supplies its icons as `<span class="ag-icon ag-icon-copy">`, which is
 * right for the licensed path: AG Grid renders its own menu inside the grid, where the theme
 * stylesheet is in scope. It is wrong here — `GridPopupMenu.vue` renders in the light DOM, and
 * because `AgGridTableView.vue` lives under `components/shared/` its style blocks compile in
 * custom-element mode and exist only inside the grid's shadow root. There, `.ag-icon` has no
 * styling at all and the span collapses to an empty box, so the icon silently vanishes.
 *
 * Substituting at this boundary rather than at the definitions keeps the licensed menu byte-for-byte
 * unchanged, and covers any `ag-icon` span added later without it having to know about this.
 */
function substituteAgIcon(icon: string): string {
  const glyph = /\bag-icon-([a-z0-9-]+)/.exec(icon)?.[1]
  const sprite = glyph != null ? AG_ICON_SPRITES[glyph] : undefined
  return sprite != null ? menuIconHtml(sprite) : icon
}

/** A single entry `GridPopupMenu.vue` renders, or a visual divider between entries. */
export type GridMenuItem =
  | { type: 'separator' }
  | {
      type: 'item'
      name: string
      icon?: string
      disabled?: boolean
      shortcut?: string
      action: () => void
    }

/** What's needed to resolve AG Grid's built-in string menu-item tokens into concrete actions. */
export interface GridMenuContext {
  api: GridApi
  column: Column | null
  node: IRowNode | null
}

type RawMenuItem =
  | string
  | (MenuItemDef & {
      action?: (params: { node: IRowNode | null; api: GridApi }) => void
    })

const KNOWN_BUILTIN_ITEMS: Record<string, (ctx: GridMenuContext) => GridMenuItem | undefined> = {
  separator: () => ({ type: 'separator' }),
  autoSizeThis: (ctx) =>
    ctx.column == null ?
      undefined
    : {
        type: 'item',
        name: 'Autosize This Column',
        action: () => ctx.api.autoSizeColumns([ctx.column!.getColId()]),
      },
  autoSizeAll: (ctx) => ({
    type: 'item',
    name: 'Autosize All Columns',
    action: () => ctx.api.autoSizeAllColumns(),
  }),
  // Excel export is explicitly out of scope for the Community fallback (see the design spec's
  // non-goals) — this built-in token only offers CSV export, which ag-grid-community supports.
  export: (ctx) => ({
    type: 'item',
    name: 'Export to CSV',
    icon: menuIconHtml('data_download'),
    action: () => ctx.api.exportDataAsCsv(),
  }),
}

function resolveOne(rawItem: RawMenuItem, ctx: GridMenuContext): GridMenuItem | undefined {
  if (typeof rawItem === 'string') {
    const resolver = KNOWN_BUILTIN_ITEMS[rawItem]
    if (!resolver) {
      console.warn(`GridPopupMenu: unsupported built-in AG Grid menu item "${rawItem}" — dropped.`)
      return undefined
    }
    return resolver(ctx)
  }
  // DOM-Element icons aren't supported: nothing in this codebase produces one today (verified by
  // search — every `icon` in `commonContextMenuActions`/`TableVisualization.vue` is an HTML string).
  const icon = typeof rawItem.icon === 'string' ? substituteAgIcon(rawItem.icon) : undefined
  return {
    type: 'item',
    name: rawItem.name,
    // `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional property directly —
    // spread it in only when present instead.
    ...(icon != null ? { icon } : {}),
    ...(rawItem.disabled != null ? { disabled: rawItem.disabled } : {}),
    ...(rawItem.shortcut != null ? { shortcut: rawItem.shortcut } : {}),
    action: () => rawItem.action?.({ node: ctx.node, api: ctx.api }),
  }
}

/**
 * Normalize an AG Grid `(MenuItemDef | string)[]` item list — as produced by
 * `getContextMenuItems`, `ColDef.contextMenuItems`, or `ColDef.mainMenuItems` — into the flat
 * shape `GridPopupMenu.vue` renders. Built-in AG Grid string tokens are interpreted here because
 * AG Grid's own renderer — the thing that normally understands them — isn't present when running
 * on `ag-grid-community`. `subMenu` is not supported: nothing in this codebase uses it today.
 */
export function resolveGridMenuItems(
  rawItems: RawMenuItem[],
  ctx: GridMenuContext,
): GridMenuItem[] {
  const resolved: GridMenuItem[] = []
  for (const rawItem of rawItems) {
    const item = resolveOne(rawItem, ctx)
    if (item) resolved.push(item)
  }
  return resolved
}
