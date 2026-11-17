import { visualizationLabel } from '@/components/GraphEditor/GraphVisualization/visualizationSelector'
import { expect, test } from 'vitest'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'

const library = (library: string, name: string): VisualizationIdentifier => ({
  module: { kind: 'Library', name: library },
  name,
})
const builtin = (name: string): VisualizationIdentifier => ({ module: { kind: 'Builtin' }, name })
const project = (name: string): VisualizationIdentifier => ({
  module: { kind: 'CurrentProject' },
  name,
})

test('a standard library visualization is labelled with its bare name', () => {
  const image = library('Standard.Image', 'Image')
  const sql = library('Standard.Database', 'SQL Query')
  const offered = [builtin('Table'), image, sql]
  expect(visualizationLabel(image, offered)).toBe('Image')
  expect(visualizationLabel(sql, offered)).toBe('SQL Query')
})

test('a builtin one is labelled with its bare name', () => {
  expect(visualizationLabel(builtin('Table'), [builtin('Table')])).toBe('Table')
})

test('a third-party library visualization keeps its library', () => {
  const chart = library('Acme.Charts', 'Chart')
  expect(visualizationLabel(chart, [chart])).toBe('Chart (from library Acme.Charts)')
})

test('a library named like a standard one, but not under Standard, keeps its library', () => {
  const chart = library('Standards.Charts', 'Chart')
  expect(visualizationLabel(chart, [chart])).toBe('Chart (from library Standards.Charts)')
})

test('a project visualization keeps "from project"', () => {
  const mine = project('Mine')
  expect(visualizationLabel(mine, [mine])).toBe('Mine (from project)')
})

test('two offered visualizations with one name both keep their library', () => {
  const standard = library('Standard.Image', 'Image')
  const other = library('Acme.Imaging', 'Image')
  const offered = [standard, other]
  expect(visualizationLabel(standard, offered)).toBe('Image (from library Standard.Image)')
  expect(visualizationLabel(other, offered)).toBe('Image (from library Acme.Imaging)')
})

test('a standard library visualization that shares its name with a builtin keeps its library', () => {
  const standard = library('Standard.Visualization', 'Table')
  const offered = [builtin('Table'), standard]
  expect(visualizationLabel(standard, offered)).toBe('Table (from library Standard.Visualization)')
  expect(visualizationLabel(builtin('Table'), offered)).toBe('Table')
})
