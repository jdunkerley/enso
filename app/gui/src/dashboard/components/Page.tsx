/** @file A page. */
import { ErrorBoundary } from '#/components/ErrorBoundary'
import InfoBar from '#/layouts/InfoBar'
import { vueComponent } from '#/utilities/vue'
import ModalHostVue from '$/components/ModalHost/ModalHost.vue'
import * as React from 'react'

// This is a component, not a mere constant
// eslint-disable-next-line no-restricted-syntax
const ModalHost = vueComponent(ModalHostVue).default

/** Props for a {@link Page}. */
export interface PageProps extends Readonly<React.PropsWithChildren> {
  readonly hideInfoBar?: true
  /** Set by a page that mounts the modal host itself (the dashboard, in `AppContainer.vue`). */
  readonly hideModalHost?: true
}

/** A page. */
export default function Page(props: PageProps) {
  const { hideInfoBar = false, hideModalHost = false, children } = props

  return (
    <>
      <ErrorBoundary>{children}</ErrorBoundary>
      {!hideInfoBar && (
        <div className="fixed right top z-1 m-2.5 text-primary">
          <InfoBar />
        </div>
      )}
      {!hideModalHost && <ModalHost />}
    </>
  )
}
