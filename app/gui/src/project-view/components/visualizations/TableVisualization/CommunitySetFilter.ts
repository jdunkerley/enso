import type {
  IDoesFilterPassParams,
  IFilterComp,
  IFilterParams,
  SetFilterValuesFuncParams,
} from '@ag-grid-community/core'

/** `filterParams` shape this filter expects, in addition to the standard `IFilterParams`. */
export interface CommunitySetFilterParams extends IFilterParams {
  /**
   * Same shape as `ISetFilterParams.values` when given a function: sources the distinct values
   * to show in the checkbox list. Reused unchanged from the existing Set Filter wiring — see
   * `getFilterValues` in `TableVisualization.vue`. Omitted (as it is for the client-side row
   * model, which has no server round-trip) means "derive the distinct values directly from the
   * grid's own row data", matching AG Grid's own Set Filter's behavior when no `values` callback
   * is configured.
   */
  values?: (params: SetFilterValuesFuncParams) => void
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
 * filter-model parsing (`tableVizFilterUtils.ts`) needs no changes. When `filterParams.values` is
 * not provided (the client-side row model has no server-side value source), distinct values are
 * derived directly from the grid's own row data instead. Values are re-fetched every time the
 * popup reopens (`afterGuiAttached`), preserving explicit deselections across the refresh — AG
 * Grid caches one filter instance per column for its lifetime, so without this the checklist would
 * go stale after the first open. Provides its own Select All / Clear controls, since a custom
 * `IFilterComp`'s GUI gets none of AG Grid's built-in filter-menu chrome.
 */
export class CommunitySetFilter implements IFilterComp {
  private params!: CommunitySetFilterParams
  private eGui!: HTMLElement
  private searchInput!: HTMLInputElement
  private listEl!: HTMLElement
  private emptyMessageEl!: HTMLElement
  private allValues: string[] = []
  private selected = new Set<string>()

  /**
   *
   */
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

    const buttonsRow = document.createElement('div')
    Object.assign(buttonsRow.style, { display: 'flex', gap: '6px', marginBottom: '6px' })

    const selectAllButton = document.createElement('button')
    selectAllButton.type = 'button'
    selectAllButton.textContent = 'Select All'
    selectAllButton.className = 'community-set-filter-select-all'
    selectAllButton.addEventListener('click', () => {
      this.selected = new Set(this.allValues)
      this.renderList()
      this.params.filterChangedCallback()
    })

    const clearButton = document.createElement('button')
    clearButton.type = 'button'
    clearButton.textContent = 'Clear'
    clearButton.className = 'community-set-filter-clear'
    clearButton.addEventListener('click', () => {
      this.selected = new Set()
      this.renderList()
      this.params.filterChangedCallback()
    })

    buttonsRow.append(selectAllButton, clearButton)

    this.listEl = document.createElement('div')
    this.listEl.className = 'community-set-filter-list'
    Object.assign(this.listEl.style, { maxHeight: '200px', overflowY: 'auto' })

    this.emptyMessageEl = document.createElement('div')
    this.emptyMessageEl.className = 'community-set-filter-empty'
    this.emptyMessageEl.textContent = 'No values'
    Object.assign(this.emptyMessageEl.style, { opacity: '0.7', padding: '4px 0' })
    this.emptyMessageEl.hidden = true

    this.eGui.append(this.searchInput, buttonsRow, this.listEl, this.emptyMessageEl)

    this.loadValues()
  }

  /**
   *
   */
  afterGuiAttached() {
    this.loadValues()
  }

  private loadValues() {
    const previouslyDeselected = new Set(
      this.allValues.filter((value) => !this.selected.has(value)),
    )

    const applyValues = (values: (string | null)[]) => {
      this.allValues = Array.from(
        new Set(values.filter((value): value is string => value != null)),
      ).sort()
      this.selected = new Set(this.allValues.filter((value) => !previouslyDeselected.has(value)))
      this.renderList()
    }

    if (typeof this.params.values === 'function') {
      this.params.values({
        colDef: this.params.colDef,
        column: this.params.column,
        api: this.params.api,
        context: this.params.context,
        success: applyValues,
      } as SetFilterValuesFuncParams)
    } else {
      const values: (string | null)[] = []
      this.params.api.forEachNode((node) => {
        const value = this.params.getValue(node)
        values.push(value == null ? null : String(value))
      })
      applyValues(values)
    }
  }

  private renderList() {
    const search = this.searchInput.value.trim().toLowerCase()
    const visibleValues =
      search ?
        this.allValues.filter((value) => value.toLowerCase().includes(search))
      : this.allValues

    // Keyed off what is actually being rendered, not the unfiltered set: a search matching nothing
    // leaves `visibleValues` empty while `allValues` is still non-empty, which showed a blank list
    // with no explanation. The wording follows AG Grid's own locale, which separates the
    // nothing-to-show case from the search-found-nothing case.
    this.emptyMessageEl.textContent = search ? 'No matches' : 'No values'
    this.emptyMessageEl.hidden = visibleValues.length > 0

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

  /**
   *
   */
  getGui() {
    return this.eGui
  }

  /**
   *
   */
  doesFilterPass(params: IDoesFilterPassParams) {
    // For the client-side row model (no `values` callback — filtering happens in the browser),
    // this is what AG Grid actually calls to filter rows. For server-driven row models, filtering
    // happens on the backend and this method is unreachable in practice — kept for parity with
    // the real Set Filter's own semantics.
    const value = this.params.getValue(params.node)
    return this.selected.has(String(value))
  }

  /**
   *
   */
  isFilterActive() {
    return this.selected.size !== this.allValues.length
  }

  /**
   *
   */
  getModel(): CommunitySetFilterModel | null {
    if (!this.isFilterActive()) return null
    return { filterType: 'set', values: Array.from(this.selected) }
  }

  /**
   *
   */
  setModel(model: CommunitySetFilterModel | null) {
    this.selected = model ? new Set(model.values) : new Set(this.allValues)
    this.renderList()
  }
}
