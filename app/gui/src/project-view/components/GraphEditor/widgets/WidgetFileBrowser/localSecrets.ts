/**
 * @file The file browser widget's local secret items: for an argument that takes an `Enso_Secret`,
 * one item per local secret, which sets the argument to `Enso_Secret.get` of its `secret://` path,
 * and **New secret…**, which opens the create dialog and then sets the path of what it made.
 *
 * Only names and paths are listed; nothing here reads a secret's value. With no local backend (the
 * browser build) there are no items.
 */
import { useBackends } from '$/providers/backends'
import { useCreateLocalSecret, useLocalSecretsQuery } from '$/providers/localSecrets'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import UpsertSecretModal from '$/secrets/UpsertSecretModal.vue'
import type { ToValue } from '$/utils/reactivity'
import type { BrowserItem } from '@/components/GraphEditor/widgets/WidgetFileBrowser/browsableTypes'
import type { CustomDropdownItem } from '@/components/GraphEditor/widgets/WidgetSelection/tags'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed, toValue, type ComputedRef } from 'vue'

/** @returns Dropdown items for picking or creating a local secret. */
export function useLocalSecretItems({
  dialogKind,
  setPath,
}: {
  dialogKind: ToValue<BrowserItem>
  setPath: (type: 'secret', path: string) => void
}): ComputedRef<CustomDropdownItem[]> {
  const { getText } = useText()
  const modals = useModals()
  const toasts = useToasts()
  const backends = useBackends()
  // Only an argument that takes a secret lists them.
  const backend = () => (toValue(dialogKind) === 'secret' ? backends.localBackend : null)
  const secretsQuery = useLocalSecretsQuery(backend)
  const createSecret = useCreateLocalSecret(backend)

  function openCreateDialog() {
    modals.open(UpsertSecretModal, {
      onCreate: (name: string, value: string) =>
        createSecret.mutate(
          { name, value },
          {
            onSuccess: (path: string) => setPath('secret', path),
            onError: (error: unknown) =>
              toasts.show(getMessageOrToString(error), { type: 'error' }),
          },
        ),
    })
  }

  return computed(() => {
    if (backend() == null) return []
    const secrets = (secretsQuery.data.value ?? []).map((secret): CustomDropdownItem => ({
      label: secret.name,
      onClick: () => setPath('secret', secret.path),
    }))
    return [
      ...secrets,
      { label: getText('datalinkNewSecret'), icon: 'key_add', onClick: openCreateDialog },
    ]
  })
}
