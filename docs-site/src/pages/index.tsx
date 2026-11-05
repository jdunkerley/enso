import { Redirect } from '@docusaurus/router'
import useBaseUrl from '@docusaurus/useBaseUrl'
import type { JSX } from 'react'

/** The site's root sends readers to the guides. */
export default function Home(): JSX.Element {
  return <Redirect to={useBaseUrl('/docs/intro/')} />
}
