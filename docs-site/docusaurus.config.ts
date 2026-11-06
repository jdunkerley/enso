import type * as Preset from '@docusaurus/preset-classic'
import type { Config } from '@docusaurus/types'
import { existsSync } from 'node:fs'

/** Written by the generator (`generator/src/output.ts`); absent before the first `generate`. */
const GROUP_COLOURS = './src/css/groups.generated.css'

const config: Config = {
  title: 'Enso',
  tagline: 'Visual data preparation and analysis',
  url: 'https://jdunkerley.github.io',
  baseUrl: '/enso/',
  // Every page is `<path>/index.html`: a segment like `Table.filter` never looks like a file
  // extension to GitHub Pages, and `…/Table.filter` (no slash) redirects to it.
  trailingSlash: true,
  organizationName: 'jdunkerley',
  projectName: 'enso',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: { routeBasePath: 'docs', sidebarPath: './sidebars.ts' },
        blog: false,
        theme: {
          customCss: [
            './src/css/custom.css',
            ...(existsSync(GROUP_COLOURS) ? [GROUP_COLOURS] : []),
          ],
        },
      } satisfies Preset.Options,
    ],
  ],
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: 'docs',
        language: ['en'],
      },
    ],
  ],
  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
    navbar: {
      title: 'Enso',
      items: [
        { type: 'docSidebar', sidebarId: 'guides', label: 'Guides', position: 'left' },
        { type: 'docSidebar', sidebarId: 'api', label: 'Components', position: 'left' },
        { href: 'https://github.com/jdunkerley/enso/wiki', label: 'Developer', position: 'left' },
      ],
    },
  } satisfies Preset.ThemeConfig,
}

export default config
