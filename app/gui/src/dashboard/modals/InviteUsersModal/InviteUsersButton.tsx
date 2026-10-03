/**
 * @file The user bar's "Invite" button and the invitation dialog it opens. It stays React with the
 * dialog, which the organization port (#87) moves to `src/cloud/organization/`; the Vue user bar
 * (#83) mounts it through `reactComponent`.
 */
import { Button } from '#/components/Button'
import { Dialog } from '#/components/Dialog'
import { useText } from '$/providers/react'
import InviteUsersModal from './InviteUsersModal'

/** The "Invite" button, opening the invitation dialog. */
export function InviteUsersButton() {
  const { getText } = useText()
  return (
    <Dialog.Trigger>
      <Button size="medium" variant="outline">
        {getText('invite')}
      </Button>

      <InviteUsersModal />
    </Dialog.Trigger>
  )
}
