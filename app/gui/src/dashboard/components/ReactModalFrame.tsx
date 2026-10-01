/** @file Renders a `setModal` element as the open dialog it contains. */
import { Pressable } from '#/components/aria'
import { Dialog } from '#/components/Dialog'
import { ErrorBoundary } from '#/components/ErrorBoundary'
import Portal from '#/components/Portal'
import type { JSX } from 'react'

/** Props for a {@link ReactModalFrame}. */
export interface ReactModalFrameProps {
  readonly modal: JSX.Element
}

/**
 * A `setModal` element in a `Dialog.Trigger` that is open on mount, portalled into
 * `#enso-portal-root`. `ModalHost.vue` renders it for the React `setModal` shim.
 */
export function ReactModalFrame(props: ReactModalFrameProps) {
  return (
    <ErrorBoundary>
      <Portal>
        <div className="select-none text-xs text-primary">
          <Dialog.Trigger defaultOpen>
            {/* This component suppresses the warning about the target not being pressable element. */}
            <Pressable>
              <></>
            </Pressable>

            {props.modal}
          </Dialog.Trigger>
        </div>
      </Portal>
    </ErrorBoundary>
  )
}
