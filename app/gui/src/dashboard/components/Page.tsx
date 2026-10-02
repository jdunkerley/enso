/** @file A page. */
import { ErrorBoundary } from '#/components/ErrorBoundary'
import { vueComponent } from '#/utilities/vue'
import * as React from 'react'
import { defineAsyncComponent } from 'vue'

/**
 * The modal host for the pages outside the dashboard (which mounts its own). Loaded on demand: its
 * error boundary pulls in Reka, which the initial chunk otherwise does without.
 */
const ModalHost = vueComponent(
  defineAsyncComponent(() => import('$/components/ModalHost/ModalHost.vue')),
).default

/**
 * The bar with the info menu, at the top right of each page (#83). Loaded on demand, like the modal
 * host: its popover brings Reka, and the login page is on every session's critical path.
 */
const InfoBar = vueComponent(
  defineAsyncComponent(() => import('$/components/InfoBar/InfoBar.vue')),
).default

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
