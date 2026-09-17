import type {
  IDoesFilterPassParams,
  IFilterComp,
  IFilterParams,
  SetFilterValuesFuncParams,
} from '@ag-grid-community/core'

/** `filterParams` shape this filter expects, in addition to the standard `IFilterParams`. */
export interface CommunitySetFilterParams extends IFilterParams {
  /** Same shape as `ISetFilterParams.values` when given a function: sources the distinct values
   * to show in the checkbox list. Reused unchanged from the existing Set Filter wiring — see
   * `getFilterValues` in `TableVisualization.vue`. */
  values: (params: SetFilterValuesFuncParams) => void
}

interface CommunitySetFilterModel {
  filterType: 'set'
  values: string[]
}

/**
 * Community-only replacement for AG Grid Enterprise's Set Filter / Multi Filter, used when no AG
 * Grid Enterprise license is configured (see `AG_GRID_ENTERPRISE_AVAILABLE` in
 * `components/shared/AgGridTableView/agGridLicense.ts`). Shows a search box that narrows a
 * checkbox list of distinct column values — the search box only narrows which checkboxes are
 * shown, it is not a separate filter condition — and produces the same
 * `{ filterType: 'set', values: string[] }` model AG Grid's own Set Filter produces, so existing
 * filter-model parsing (`tableVizFilterUtils.ts`) needs no changes.
 */
export class CommunitySetFilter implements IFilterComp {
  private params!: CommunitySetFilterParams
  private eGui!: HTMLElement
  private searchInput!: HTMLInputElement
  private listEl!: HTMLElement
  private allValues: string[] = []
  private selected = new Set<string>()

  init(params: CommunitySetFilterParams) {
    this.params = params
    this.eGui = document.createElement('div')
    Object.assign(this.eGui.style, { padding: '8px', minWidth: '200px' })

    this.searchInput = document.createElement('input')
    this.searchInput.type = 'text'
    this.searchInput.placeholder = 'Search values...'
    this.searchInput.className = 'community-set-filter-search'
    Object.assign(this.searchInput.style, {
      width: '100%',
      marginBottom: '6px',
    })
    this.searchInput.addEventListener('input', () => this.renderList())

    this.listEl = document.createElement('div')
    this.listEl.className = 'community-set-filter-list'
    Object.assign(this.listEl.style, { maxHeight: '200px', overflowY: 'auto' })

    this.eGui.append(this.searchInput, this.listEl)

    this.params.values({
      colDef: this.params.colDef,
      column: this.params.column,
      api: this.params.api,
      context: this.params.context,
      success: (values: (string | null)[]) => {
        this.allValues = values.filter((value): value is string => value != null)
        this.selected = new Set(this.allValues)
        this.renderList()
      },
    } as SetFilterValuesFuncParams)
  }

  private renderList() {
    const search = this.searchInput.value.trim().toLowerCase()
    const visibleValues =
      search ?
        this.allValues.filter((value) => value.toLowerCase().includes(search))
      : this.allValues

    this.listEl.replaceChildren(
      ...visibleValues.map((value) => {
        const label = document.createElement('label')
        label.className = 'community-set-filter-option'
        Object.assign(label.style, { display: 'block' })

        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = this.selected.has(value)
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) this.selected.add(value)
          else this.selected.delete(value)
          this.params.filterChangedCallback()
        })

        label.append(checkbox, document.createTextNode(value))
        return label
      }),
    )
  }

  getGui() {
    return this.eGui
  }

  doesFilterPass(params: IDoesFilterPassParams) {
    // Filtering itself is always performed server-side (Infinite Row Model) in this application —
    // this only matters if the filter is ever paired with a client-side row model, so it mirrors
    // the real Set Filter's own semantics for parity rather than being unreachable dead code.
    const value = this.params.getValue(params.node)
    return this.selected.has(String(value))
  }

  isFilterActive() {
    return this.selected.size !== this.allValues.length
  }

  getModel(): CommunitySetFilterModel | null {
    if (!this.isFilterActive()) return null
    return { filterType: 'set', values: Array.from(this.selected) }
  }

  setModel(model: CommunitySetFilterModel | null) {
    this.selected = model ? new Set(model.values) : new Set(this.allValues)
    this.renderList()
  }
}
