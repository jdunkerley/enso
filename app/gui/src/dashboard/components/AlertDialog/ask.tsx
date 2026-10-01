/**
 * @file
 *
 * Alert function is a helper function to create an alert dialog,
 * and return a promise that resolves when the user confirms the dialog,
 * or rejects when the user cancels the dialog.
 */

import type { AlertDialogProps, Confirmable } from './AlertDialog'

import { askModal } from '#/providers/ModalProvider'
import type { Resolution } from '$/providers/modals'
import type { ComponentType } from 'react'

/**
 * Options for the {@link alert} function.
 */
export interface AlertOptions extends Omit<AlertDialogProps, 'onCancel' | 'onConfirm'> {}

export type { Resolution }

/**
 * Create an alert dialog and return a promise that resolves with the user's answer.
 *
 * It forwards to the Vue modal stack's `ask` (`$/providers/modals`), through the React `setModal`
 * shim's frame: the dialog replaces every open modal, and every modal is closed once it has
 * answered, as before.
 */
export function ask<Component extends ComponentType<Confirmable & P>, P extends object>(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ConfirmableComponent: Component,
  additionalProps?: P,
) {
  // @ts-expect-error For some reason `<ComponentType />` can't be used as an argument to `setModal`.
  return askModal(<ConfirmableComponent {...additionalProps} />)
}
