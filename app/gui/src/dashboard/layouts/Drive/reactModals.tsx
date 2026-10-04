/**
 * @file The React dialogs the Vue drive opens, until #198 ports them: the labels popover
 * (`ManageLabelsModal`), the new-credential dialog (`CreateCredentialModal`) and the datalink
 * dialog (`UpsertDatalinkModal`). Each opens on the modal stack, rendered by the React frame:
 *
 * - from a context-menu entry with {@link setModal}, as React's menus did (it replaces the open
 * modals);
 * - from a button that was a react-aria `Dialog.Trigger` with {@link openReactModal}, which keeps
 * the open modals and leaves the stack when the dialog closes, as the trigger's own dialog did.
 *
 * A Vue file cannot render JSX, so the elements are made here. When #198 lands, the drive opens its
 * Vue dialogs instead and this file goes.
 */
import { CreateCredentialModal } from '#/modals/CreateCredentialModal'
import ManageLabelsModal from '#/modals/ManageLabelsModal'
import UpsertDatalinkModal from '#/modals/UpsertDatalinkModal'
import { openReactModal, setModal } from '#/providers/ModalProvider'
import type { SelectedAssetInfo } from '$/providers/driveStore'
import type { Backend, CredentialConfig, SecretId } from 'enso-common/src/services/Backend'

/** How to open a React dialog: replacing the open modals, or over them. */
export type ReactModalMode = 'replace' | 'trigger'

/** Open a React dialog in the given mode; returns the stack entry for `trigger`. */
function open(element: React.JSX.Element, mode: ReactModalMode) {
  if (mode === 'replace') {
    setModal(element)
    return null
  }
  return openReactModal(element)
}

/** Open the labels popover for the given assets, anchored to `trigger` when given. */
export function openManageLabelsModal(
  mode: ReactModalMode,
  backend: Backend,
  items: readonly SelectedAssetInfo[],
  trigger?: HTMLElement | null,
) {
  return open(
    <ManageLabelsModal
      backend={backend}
      items={items}
      {...(trigger != null ? { triggerRef: { current: trigger } } : {})}
    />,
    mode,
  )
}

/** Open the new-credential dialog. */
export function openCreateCredentialModal(
  mode: ReactModalMode,
  doCreate: (name: string, value: CredentialConfig) => Promise<SecretId>,
) {
  return open(<CreateCredentialModal doCreate={doCreate} />, mode)
}

/** Open the new-datalink dialog. */
export function openUpsertDatalinkModal(
  mode: ReactModalMode,
  doCreate: (name: string, value: unknown) => Promise<void>,
) {
  return open(<UpsertDatalinkModal doCreate={doCreate} />, mode)
}
