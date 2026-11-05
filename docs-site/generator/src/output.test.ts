import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { FIXTURES_LIB, readLibraries } from './catalogue'
import { buildModel } from './model'
import { groupsCss, readFallbackColour, writeSite } from './output'
import { renderPage } from './pages'

const model = buildModel(readLibraries([FIXTURES_LIB]))

test('the fallback colour is read from the IDE', () => {
  expect(readFallbackColour(':root {\n  --group-color-fallback: #006b8a;\n}')).toBe('#006b8a')
  expect(() => readFallbackColour(':root {}')).toThrow()
})

test('one variable per group, named and valued as WithCurrentProject.vue sets them', () => {
  const css = groupsCss(model, '#006b8a')
  expect(css).toContain('--group-color-Standard-Fixture-Selections: oklch(0.464 0.14 325);')
  expect(css).toMatch(/--group-color-Standard-Fixture-Shaping: (rgb|oklch)\(/)
  expect(css).toContain('--group-color-fallback: #006b8a;')
})

test('writes pages, sidebars, the stylesheet and the sprite, and keeps the intro', () => {
  const site = mkdtempSync(join(tmpdir(), 'docs-site-'))
  mkdirSync(join(site, 'docs/api/stale'), { recursive: true })
  writeFileSync(join(site, 'docs/api/index.md'), 'intro')
  writeFileSync(join(site, 'docs/api/stale/index.mdx'), 'old')
  writeSite(model, site)
  expect(readFileSync(join(site, 'docs/api/index.md'), 'utf8')).toBe('intro')
  expect(existsSync(join(site, 'docs/api/stale'))).toBe(false)
  expect(existsSync(join(site, 'docs/api/Standard.Fixture/Shapes/Shape.area/index.mdx'))).toBe(true)
  expect(existsSync(join(site, 'generated/apiSidebars.json'))).toBe(true)
  expect(existsSync(join(site, 'src/css/groups.generated.css'))).toBe(true)
  const sprite = readFileSync(join(site, 'static/img/icons.svg'), 'utf8')
  expect(sprite).toContain('<symbol id="preparation"')
})

test('every icon a node uses is a symbol of the sprite', () => {
  const site = mkdtempSync(join(tmpdir(), 'docs-site-'))
  writeSite(model, site)
  const sprite = readFileSync(join(site, 'static/img/icons.svg'), 'utf8')
  const used = new Set<string>()
  for (const file of model.pages.map((page) => join(site, 'docs/api', page.dir, 'index.mdx'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/icon=\{"([^"]+)"\}/g))
      used.add(match[1]!)
  }
  for (const icon of used) expect(sprite).toContain(`<symbol id="${icon}"`)
})

test('a page whose path differs from another only in case gets its own folder; links follow it', () => {
  const libraries = readLibraries([FIXTURES_LIB])
  const fixture = libraries[0]!
  const side = fixture.catalogue!.entries.find(
    (entry) => entry.type === 'method' && entry.name === 'side',
  )!
  const upperSide = { ...side, name: 'Side' }
  const withUpper = buildModel([
    {
      ...fixture,
      catalogue: {
        ...fixture.catalogue!,
        entries: [...fixture.catalogue!.entries, upperSide],
      },
    },
    libraries[1]!,
  ])
  const upper = withUpper.byPath.get('Standard.Fixture/Shapes/Square.Side')!
  expect(upper.dir).toBe('Standard.Fixture/Shapes/Square.Side~1')
  expect(withUpper.byPath.get('Standard.Fixture/Shapes/Square.side')!.dir).toBe(
    'Standard.Fixture/Shapes/Square.side',
  )
  const site = mkdtempSync(join(tmpdir(), 'docs-site-'))
  writeSite(withUpper, site)
  const moved = readFileSync(
    join(site, 'docs/api/Standard.Fixture/Shapes/Square.Side~1/index.mdx'),
    'utf8',
  )
  expect(moved).toContain('slug: "/api/Standard.Fixture/Shapes/Square.Side/"')
  expect(
    readFileSync(join(site, 'docs/api/Standard.Fixture/Shapes/Square.side/index.mdx'), 'utf8'),
  ).toContain('slug: "/api/Standard.Fixture/Shapes/Square.side/"')
  // The type page links to the moved file.
  expect(renderPage(withUpper.byPath.get('Standard.Fixture/Shapes/Square')!, withUpper)).toContain(
    '(../Square.Side~1/index.mdx)',
  )
})
