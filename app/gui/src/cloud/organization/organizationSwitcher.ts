/**
 * @file The user menu's organization switcher (#83): for a maintainer account, one entry per
 * organization the user belongs to, the current one marked. Choosing another switches to it, with
 * a toast while it does.
 *
 * The entries are made here, by the user menu as it is set up, so that they are global actions
 * (`useMenuEntries`) whether or not the menu is open, as in React; `OrganizationSwitcher.vue`
 * draws them in the menu.
 */
import { useMenuEntries, type MenuEntryAction } from '$/composables/menuEntries'
import type { UserSession } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation } from '@tanstack/vue-query'
import { NetworkError, type OrganizationInfo } from 'enso-common/src/services/Backend'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

/** An organization switcher entry. */
export interface OrganizationEntry extends MenuEntryAction {
  readonly action: 'switchOrganization'
  readonly isSelected: boolean
  readonly label: string
  readonly organization: OrganizationInfo
}

/** The organization switcher's entries, as global actions. */
export function useOrganizationSwitcherEntries(user: MaybeRefOrGetter<UserSession['user']>) {
  const { getText } = useText()
  const toasts = useToasts()
  const { remoteBackend } = useBackends()
  const updateUser = useMutation(backendMutationOptions('updateUser', remoteBackend))

  function switchTo(organization: OrganizationInfo) {
    const toastId = toasts.show(getText('switchingOrganization'), {
      isLoading: true,
      autoClose: false,
      closeOnClick: false,
      closeButton: false,
    })
    // `null` returns what the loading toast changed to the defaults.
    const settled = { isLoading: null, autoClose: null, closeOnClick: null, closeButton: null }
    updateUser.mutateAsync([{ organizationId: organization.id, switchOrganization: true }]).then(
      () => {
        toasts.update(toastId, {
          ...settled,
          type: 'success',
          render: getText('organizationSwitched'),
        })
      },
      (error: unknown) => {
        toasts.update(toastId, {
          ...settled,
          type: 'error',
          render:
            error instanceof NetworkError ? error.message : getText('switchingOrganizationError'),
        })
      },
    )
  }

  return useMenuEntries(
    computed(() => {
      const current = toValue(user)
      return (current.organizations ?? [])
        .filter((organization) => organization.name != null)
        .map((organization): OrganizationEntry => {
          const isSelected = current.organizationId === organization.id
          return {
            action: 'switchOrganization',
            isSelected,
            label: `${organization.name} (${isSelected ? 'current' : 'switch'})`,
            organization,
            doAction: () => {
              if (!isSelected) switchTo(organization)
            },
          }
        })
    }),
  )
}
