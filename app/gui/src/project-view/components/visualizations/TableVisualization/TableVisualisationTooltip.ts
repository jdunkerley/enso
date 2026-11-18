import type { ITooltipComp, ITooltipParams } from 'ag-grid-community'
import type { DataQualityMetricValue } from './tableView'

/** The indicator's colour for a percentage: green below a third, orange below two thirds, then red. */
function indicatorColor(percentage: number): string {
  return (
    percentage < 33 ? 'green'
    : percentage < 66 ? 'orange'
    : 'red'
  )
}

/**
 * Custom tooltip for a table visualization's column header: the column's value type and, when
 * shown, its data quality metrics.
 *
 * AG Grid places it in `document.body` (the grid's `popupParent`), outside every app stylesheet
 * scope, so its look is set inline from the app's design tokens (`--font-sans` and friends are on
 * `:root`), matching the app's other tooltips. Text goes in through `textContent`, never as HTML:
 * type names and metric names come from the engine.
 */
export class TableVisualisationTooltip implements ITooltipComp {
  eGui!: HTMLElement

  /**
   * Initializes the tooltip with the provided parameters.
   * @param params The tooltip parameters: the data quality metrics, total row count,
   * and a flag whether to show/hide the data quality indicators.
   */
  init(
    params: ITooltipParams & {
      dataQualityMetrics: DataQualityMetricValue[]
      total: number
      showDataQuality: boolean
    },
  ) {
    this.eGui = document.createElement('div')
    this.eGui.className = 'TableVisualisationTooltip'
    Object.assign(this.eGui.style, {
      fontFamily: 'var(--font-sans)',
      fontSize: '11.5px',
      lineHeight: '18px',
      background: 'rgb(0 0 0 / 80%)',
      color: 'rgb(255 255 255 / 90%)',
      padding: '6px 10px',
      borderRadius: '12px',
      maxWidth: '360px',
    })

    const typeLine = document.createElement('div')
    const label = document.createElement('b')
    label.textContent = 'Column value type: '
    typeLine.append(label, String(params.value ?? ''))
    this.eGui.append(typeLine)

    if (params.showDataQuality) {
      for (const metric of params.dataQualityMetrics) {
        const line = document.createElement('div')
        if (metric.displayType === 'Percentage') {
          const percentage = (metric.value / params.total) * 100
          const prefix = metric.name !== '' ? `${metric.name}: ` : ''
          line.textContent = `${prefix}${percentage.toFixed(2)}%`
          const dot = document.createElement('span')
          Object.assign(dot.style, {
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            marginLeft: '6px',
            backgroundColor: indicatorColor(percentage),
          })
          line.append(dot)
        } else if (metric.name !== '') {
          line.textContent = `${metric.name}: ${metric.value}`
        } else {
          line.style.whiteSpace = 'pre-line'
          line.textContent = `${metric.value}`
        }
        this.eGui.append(line)
      }
    }
  }

  /**
   * Returns the tooltip DOM element.
   */
  getGui() {
    return this.eGui
  }
}
