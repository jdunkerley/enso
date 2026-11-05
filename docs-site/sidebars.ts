import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'
import { existsSync, readFileSync } from 'node:fs'

/** Written by the generator: `api` (the Components intro and the libraries) and one per library. */
const API_SIDEBARS = './generated/apiSidebars.json'

const apiSidebars: SidebarsConfig =
  existsSync(API_SIDEBARS) ?
    (JSON.parse(readFileSync(API_SIDEBARS, 'utf8')) as SidebarsConfig)
  : { api: [{ type: 'doc', id: 'api/index', label: 'Components' }] }

const sidebars: SidebarsConfig = {
  guides: ['intro'],
  ...apiSidebars,
}

export default sidebars
