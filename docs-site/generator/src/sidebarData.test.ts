import { expect, test } from 'vitest'
import { FIXTURES_LIB, readLibraries } from './catalogue'
import { buildModel } from './model'
import { buildSidebars } from './sidebarData'

const sidebars = buildSidebars(buildModel(readLibraries([FIXTURES_LIB])))

test('the Components intro sidebar lists the libraries', () => {
  expect(sidebars.api).toEqual([
    { type: 'doc', id: 'api/index', label: 'Components' },
    {
      type: 'ref',
      id: 'api/Standard.Fixture/index',
      label: 'Standard.Fixture',
    },
    {
      type: 'ref',
      id: 'api/Standard.Fixture_Ext/index',
      label: 'Standard.Fixture_Ext',
    },
  ])
})

test('one sidebar per library, the library above its modules (breadcrumbs Library › Module › Type › function); types with constructors and methods; a method defined in another module under that module', () => {
  expect(sidebars['api-Standard.Fixture']).toEqual([
    {
      type: 'category',
      label: 'Standard.Fixture',
      link: { type: 'doc', id: 'api/Standard.Fixture/index' },
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Shapes',
          link: { type: 'doc', id: 'api/Standard.Fixture/Shapes/index' },
          collapsed: true,
          items: [
            {
              type: 'category',
              label: 'Shape',
              link: { type: 'doc', id: 'api/Standard.Fixture/Shapes/Shape/index' },
              collapsed: true,
              items: [
                {
                  type: 'doc',
                  id: 'api/Standard.Fixture/Shapes/Shape.unit/index',
                  label: 'Shape.unit',
                },
                {
                  type: 'doc',
                  id: 'api/Standard.Fixture/Shapes/Shape.area/index',
                  label: 'area',
                },
                {
                  type: 'doc',
                  id: 'api/Standard.Fixture/Shapes/Shape.op-2b/index',
                  label: '+',
                },
                {
                  type: 'doc',
                  id: 'api/Standard.Fixture/Shapes/Shape.undocumented/index',
                  label: 'undocumented',
                },
                {
                  type: 'doc',
                  id: 'api/Standard.Fixture/Shapes/Shape.odd_icon/index',
                  label: 'odd_icon',
                },
              ],
            },
            {
              type: 'category',
              label: 'Square',
              link: { type: 'doc', id: 'api/Standard.Fixture/Shapes/Square/index' },
              collapsed: true,
              items: [
                {
                  type: 'doc',
                  id: 'api/Standard.Fixture/Shapes/Square.Value/index',
                  label: 'Square.Value',
                },
                {
                  type: 'doc',
                  id: 'api/Standard.Fixture/Shapes/Square.side/index',
                  label: 'side',
                },
              ],
            },
            {
              type: 'doc',
              id: 'api/Standard.Fixture/Shapes/make_shape/index',
              label: 'make_shape',
            },
          ],
        },
        {
          type: 'category',
          label: 'Measures',
          link: { type: 'doc', id: 'api/Standard.Fixture/Measures/index' },
          collapsed: true,
          items: [
            {
              type: 'doc',
              id: 'api/Standard.Fixture/Measures/Square.perimeter/index',
              label: 'perimeter',
            },
          ],
        },
      ],
    },
  ])
})
