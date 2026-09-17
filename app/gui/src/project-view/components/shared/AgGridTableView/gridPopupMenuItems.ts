import type { Column, GridApi, IRowNode, MenuItemDef } from 'ag-grid-enterprise'

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
  const icon = typeof rawItem.icon === 'string' ? rawItem.icon : undefined
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
